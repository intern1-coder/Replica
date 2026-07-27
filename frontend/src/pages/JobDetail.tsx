import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import { mergeJobPatch, type FetchOptions } from '../utils/refetch';
import type { Job } from './JobList';
import { ArrowLeft, RefreshCw, Trash2, Edit } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { JobWorkLogs } from '../components/JobWorkLogs';
import { JobPnL } from '../components/JobPnL';
import { JobMediaUpload } from '../components/JobMedia';
import { JobCommunications } from '../components/JobCommunications';
import { JobAuditLogs } from '../components/JobAuditLogs';
import { JobDocuments } from '../components/JobDocuments';
import { JobEditDetails } from '../components/JobEditDetails';
import { EditClientModal } from '../components/EditClientModal';
import { EditTenantModal } from '../components/EditTenantModal';

const allowedTransitions: Record<string, string[]> = {
  TO_BE_CHECKED: ['CHECKED', 'CANCELLED'],
  CHECKED: ['QUOTED', 'CANCELLED'],
  QUOTED: ['AUTHORISED', 'CANCELLED'],
  AUTHORISED: ['PENDING_INVOICE', 'CANCELLED'],
  PENDING_INVOICE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: []
};

type JobUpdatedPayload = {
  jobId: string;
  actorId?: string;
  job?: Partial<Job>;
  ts?: string;
};

export function JobDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { socket, can, user } = useAuth();
  const { showToast } = useToast();
  const [job, setJob] = useState<Job | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [conflictError, setConflictError] = useState(false);
  const [isEditingClient, setIsEditingClient] = useState(false);
  const [isEditingTenant, setIsEditingTenant] = useState(false);
  const conflictErrorRef = useRef(conflictError);
  conflictErrorRef.current = conflictError;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmTransition, setConfirmTransition] = useState<{ status: string; label: string } | null>(null);

  const loadJob = useCallback(async (options?: FetchOptions) => {
    const background = options?.background ?? false;
    if (!background) {
      setIsInitialLoading(true);
      setConflictError(false);
      setError('');
    }
    try {
      const data = await apiFetch(`/jobs/${id}`);
      if (background) {
        setJob((prev) => mergeJobPatch(prev, data as Partial<Job>));
      } else {
        setJob(data);
      }
    } catch (err: any) {
      if (!background) {
        setError(err.message || 'Failed to load job');
      }
    } finally {
      if (!background) {
        setIsInitialLoading(false);
      }
    }
  }, [id]);

  const loadJobRef = useRef(loadJob);
  loadJobRef.current = loadJob;

  useEffect(() => {
    setJob(null);
    loadJobRef.current();
  }, [id]);

  useEffect(() => {
    if (!socket || !id) return;

    socket.emit('job:join', id);

    const handleStatusChanged = (payload: { jobId: string; status: Job['status']; version: number }) => {
      if (payload.jobId !== id) return;
      if (conflictErrorRef.current) {
        loadJobRef.current({ background: true });
        return;
      }
      setJob((prev) =>
        prev
          ? mergeJobPatch(prev, { status: payload.status, version: payload.version })
          : prev
      );
    };

    const handleJobUpdated = (payload: JobUpdatedPayload) => {
      if (payload.jobId !== id || payload.actorId === user?.id) return;
      if (payload.job) {
        setJob((prev) => mergeJobPatch(prev, payload.job!));
        return;
      }
      loadJobRef.current({ background: true });
    };

    socket.on('job:statusChanged', handleStatusChanged);
    socket.on('job:updated', handleJobUpdated);

    return () => {
      socket.off('job:statusChanged', handleStatusChanged);
      socket.off('job:updated', handleJobUpdated);
      socket.emit('job:leave', id);
    };
  }, [socket, id, user?.id]);

  const handleStatusChange = async (newStatus: string) => {
    if (!job) return;
    setIsUpdatingStatus(true);
    setError('');
    setConflictError(false);

    try {
      const updatedJob = await apiFetch(`/jobs/${job.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: newStatus,
          version: job.version,
        }),
      });
      setJob(updatedJob);
    } catch (err: any) {
      if (err.status === 409) {
        setConflictError(true);
      } else {
        setError(err.message || 'Failed to update status');
      }
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleDelete = async () => {
    if (!job) return;
    setIsDeleting(true);
    try {
      await apiFetch(`/jobs/${job.id}`, { method: 'DELETE' });
      showToast('Job deleted', 'success');
      navigate('/jobs');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete job', 'error');
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleClientSaved = (updatedClient: { id: string; name: string; email: string | null; phone: string | null }) => {
    setJob((prev) => {
      if (!prev || !prev.client) return prev;
      return { ...prev, client: { ...prev.client, ...updatedClient } };
    });
    setIsEditingClient(false);
    showToast('Client updated', 'success');
  };

  const handleTenantSaved = async (updatedTenant: { id: string; name: string; phone: string | null; email: string | null }) => {
    setIsEditingTenant(false);
    setJob((prev) => (prev ? { ...prev, tenant: { ...prev.tenant, ...updatedTenant } } : prev));
    showToast('Tenant updated', 'success');

    // Scoped exception to the "snapshot is frozen forever" rule (Rules.md):
    // refresh only THIS job's copy so a typo fix is visible immediately.
    // Other jobs for the same tenant keep their original snapshot.
    if (!job) return;
    try {
      const updatedJob = await apiFetch(`/jobs/${job.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          tenantSnapshotName: updatedTenant.name,
          tenantSnapshotPhone: updatedTenant.phone,
        }),
      });
      setJob((prev) => (prev ? { ...prev, ...updatedJob } : prev));
    } catch (err: any) {
      showToast('Tenant saved, but failed to refresh this job\'s snapshot: ' + err.message, 'error');
    }
  };

  if (isInitialLoading && !job) return <p>Loading job details...</p>;
  if (error && !job) return <p className="text-secondary">{error}</p>;
  if (!job) return <p>Job not found</p>;

  const availableTransitions = allowedTransitions[job.status] || [];

  return (
    <div className="page-enter">
      <div style={{ marginBottom: 'var(--space-md)' }}>
        <Link to="/jobs" className="flex items-center gap-2 text-secondary font-medium">
          <ArrowLeft size={16} /> Back to Jobs
        </Link>
      </div>

      {conflictError && (
        <div className="page-error">
          <div className="flex justify-between items-center" style={{ width: '100%' }}>
            <div>
              <strong>Update Conflict:</strong> Another user has modified this job since you opened it.
            </div>
            <button onClick={() => loadJob()} className="button secondary">
              <RefreshCw size={16} /> Refresh Data
            </button>
          </div>
        </div>
      )}

      {error && !conflictError && (
        <div className="page-error">
          {error}
        </div>
      )}

      <div className="section-card flex justify-between items-center" style={{ flexWrap: 'wrap', gap: 'var(--space-md)' }}>
        <div>
          <h2 className="flex items-center gap-2" style={{ margin: 0, marginBottom: 'var(--space-xs)' }}>
            {job.sequence}
            <span className={`status-badge ${job.status.toLowerCase()}`}>
              {job.status.replace(/_/g, ' ')}
            </span>
          </h2>
          <p className="text-secondary" style={{ margin: 0 }}>
            {job.property?.address}
          </p>
        </div>

        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          {availableTransitions.map(nextStatus => {
            if (nextStatus === 'AUTHORISED' && !can('jobs:authorize')) {
              return null;
            }
            // Final sign-off is reserved for Accounts (jobs:complete) after
            // the invoice has been sent.
            if (nextStatus === 'COMPLETED' && !can('jobs:complete')) {
              return null;
            }
            // Cancelling ("Not Proceeding") is a normal edit, same permission
            // as every other transition button here — matches the backend's
            // PATCH /jobs/:id/status guard.
            if (nextStatus === 'CANCELLED' && !can('jobs:edit')) {
              return null;
            }

            const label = nextStatus === 'PENDING_INVOICE'
              ? 'Send to Accounts (Pending Invoice)'
              : nextStatus === 'CANCELLED'
              ? 'Not Proceeding'
              : `Mark as ${nextStatus.replace(/_/g, ' ')}`;

            return (
              <button
                key={nextStatus}
                onClick={() => setConfirmTransition({ status: nextStatus, label })}
                disabled={isUpdatingStatus || conflictError}
                className={`button ${nextStatus === 'CANCELLED' ? 'danger' : 'primary'}`}
              >
                {label}
              </button>
            );
          })}

          {can('jobs:delete') && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isUpdatingStatus || conflictError}
              className="button danger flex items-center gap-2"
            >
              <Trash2 size={16} /> Delete
            </button>
          )}
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="modal-backdrop entering" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-panel entering section-card" style={{ width: '400px', maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 var(--space-sm) 0', fontSize: '1rem' }}>Delete Job?</h3>
            <p className="text-secondary" style={{ margin: '0 0 var(--space-md) 0', fontSize: '0.85rem', lineHeight: '1.4' }}>
              This moves job #{job.sequence} to the Archived tab. It is not permanently deleted and can be restored later.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteConfirm(false)} className="button secondary" disabled={isDeleting}>Cancel</button>
              <button onClick={handleDelete} className="button danger" disabled={isDeleting}>
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmTransition && (
        <div className="modal-backdrop entering" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-panel entering section-card" style={{ width: '400px', maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 var(--space-sm) 0', fontSize: '1rem' }}>{confirmTransition.label}?</h3>
            <p className="text-secondary" style={{ margin: '0 0 var(--space-md) 0', fontSize: '0.85rem', lineHeight: '1.4' }}>
              {confirmTransition.status === 'CANCELLED'
                ? `This moves job #${job.sequence} to the Not Proceeding tab. It stays intact and can be moved back at any time.`
                : `This will move job #${job.sequence} from ${job.status.replace(/_/g, ' ')} to ${confirmTransition.status.replace(/_/g, ' ')}.`}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmTransition(null)} className="button secondary" disabled={isUpdatingStatus}>Cancel</button>
              <button
                onClick={() => { const status = confirmTransition.status; setConfirmTransition(null); handleStatusChange(status); }}
                className={`button ${confirmTransition.status === 'CANCELLED' ? 'danger' : 'primary'}`}
                disabled={isUpdatingStatus}
              >
                {isUpdatingStatus ? 'Updating...' : confirmTransition.label}
              </button>
            </div>
          </div>
        </div>
      )}

      <JobAuditLogs jobId={job.id} />

      <div className="detail-grid" style={{ marginBottom: 'var(--space-xl)' }}>
        <div className="section-card" style={{ marginBottom: 0 }}>
          <div className="section-card-header flex justify-between items-center">
            <h3 style={{ fontSize: '1rem', margin: 0 }}>Client Information</h3>
            {can('clients:edit') && job.client && (
              <button onClick={() => setIsEditingClient(true)} className="button secondary small flex items-center gap-2">
                <Edit size={12} /> Edit
              </button>
            )}
          </div>
          <div className="form-row">
            <span className="text-secondary" style={{ fontSize: '0.85rem' }}>Name:</span>
            <span className="font-medium">{job.client?.name}</span>
          </div>
          <div className="form-row" style={{ marginTop: 'var(--space-xs)' }}>
            <span className="text-secondary" style={{ fontSize: '0.85rem' }}>Email:</span>
            <span className="font-medium">{job.client?.email || 'N/A'}</span>
          </div>
          <div className="form-row" style={{ marginTop: 'var(--space-xs)' }}>
            <span className="text-secondary" style={{ fontSize: '0.85rem' }}>Phone:</span>
            <span className="font-medium">{job.client?.phone || 'N/A'}</span>
          </div>
        </div>

        <div className="section-card" style={{ marginBottom: 0 }}>
          <div className="section-card-header flex justify-between items-center">
            <h3 style={{ fontSize: '1rem', margin: 0 }}>Tenant Information (Snapshot)</h3>
            {can('tenants:edit') && job.tenant && (
              <button onClick={() => setIsEditingTenant(true)} className="button secondary small flex items-center gap-2">
                <Edit size={12} /> Edit
              </button>
            )}
          </div>
          <div className="form-row">
            <span className="text-secondary" style={{ fontSize: '0.85rem' }}>Name:</span>
            <span className="font-medium">{job.tenantSnapshotName || 'N/A'}</span>
          </div>
          <div className="form-row" style={{ marginTop: 'var(--space-xs)' }}>
            <span className="text-secondary" style={{ fontSize: '0.85rem' }}>Phone:</span>
            <span className="font-medium">{job.tenantSnapshotPhone || 'N/A'}</span>
          </div>
        </div>
      </div>

      {isEditingClient && job.client && (
        <EditClientModal
          client={job.client}
          onClose={() => setIsEditingClient(false)}
          onSaved={handleClientSaved}
        />
      )}

      {isEditingTenant && job.tenant && (
        <EditTenantModal
          tenant={job.tenant}
          onClose={() => setIsEditingTenant(false)}
          onSaved={handleTenantSaved}
        />
      )}

      <JobEditDetails job={job} onUpdated={() => loadJob({ background: true })} />

      <JobPnL jobId={job.id} />
      <JobWorkLogs jobId={job.id} />
      <JobCommunications jobId={job.id} />
      <JobMediaUpload jobId={job.id} />
      <JobDocuments jobId={job.id} jobStatus={job.status} scheduledDate={job.scheduledDate} assignedContractors={job.assignedContractors} />
    </div>
  );
}
