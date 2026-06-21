import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import type { Job } from './JobList';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { JobWorkLogs } from '../components/JobWorkLogs';
import { JobPnL } from '../components/JobPnL';
import { JobMediaUpload } from '../components/JobMedia';
import { JobCommunications } from '../components/JobCommunications';
import { JobAuditLogs } from '../components/JobAuditLogs';
import { JobDocuments } from '../components/JobDocuments';
import { JobEditDetails } from '../components/JobEditDetails';

// Maps current status to legal next statuses
const allowedTransitions: Record<string, string[]> = {
  TO_BE_CHECKED: ['CHECKED', 'CANCELLED'],
  CHECKED: ['QUOTED', 'CANCELLED'],
  QUOTED: ['AUTHORISED', 'CANCELLED'],
  AUTHORISED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: []
};

export function JobDetail() {
  const { id } = useParams();
  const { socket } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Transition State
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [conflictError, setConflictError] = useState(false);

  useEffect(() => {
    loadJob();
  }, [id]);

  // Socket.io Realtime Updates
  useEffect(() => {
    if (!socket || !id) return;

    const handleStatusChanged = (payload: { jobId: string }) => {
      if (payload.jobId === id) {
        // If this specific job changed, prompt a refresh or auto-refresh
        // Auto-refresh is cleaner for read-only observers, but if we are editing, we might want to warn.
        // We'll just auto-refresh the data.
        loadJob();
      }
    };

    socket.on('job:statusChanged', handleStatusChanged);
    
    return () => {
      socket.off('job:statusChanged', handleStatusChanged);
    };
  }, [socket, id]);

  const loadJob = async () => {
    setIsLoading(true);
    setConflictError(false);
    setError('');
    try {
      const data = await apiFetch(`/jobs/${id}`);
      setJob(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load job');
    } finally {
      setIsLoading(false);
    }
  };

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
          version: job.version // Send the current version for optimistic locking
        }),
      });
      setJob(updatedJob);
    } catch (err: any) {
      if (err.status === 409) {
        // Optimistic locking failure!
        setConflictError(true);
      } else {
        setError(err.message || 'Failed to update status');
      }
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  if (isLoading) return <p>Loading job details...</p>;
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
            <button onClick={loadJob} className="button secondary">
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

      {/* Header */}
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
        
        {/* Status Transition Controls */}
        {availableTransitions.length > 0 && (
          <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
            {availableTransitions.map(nextStatus => {
              // Hide AUTHORISED button if not Admin/Owner and lacking canAuthorizeJobs
              if (nextStatus === 'AUTHORISED') {
                const token = localStorage.getItem('affinity_token');
                let hasAuthPerm = false;
                if (token) {
                  try {
                    const payload = JSON.parse(atob(token.split('.')[1]));
                    if (payload.role === 'ADMIN' || payload.role === 'OWNER' || payload.canAuthorizeJobs) {
                      hasAuthPerm = true;
                    }
                  } catch (e) {}
                }
                if (!hasAuthPerm) return null;
              }

              return (
                <button 
                  key={nextStatus}
                  onClick={() => handleStatusChange(nextStatus)}
                  disabled={isUpdatingStatus || conflictError}
                  className={`button ${nextStatus === 'CANCELLED' ? 'danger' : 'primary'}`}
                >
                  Mark as {nextStatus.replace(/_/g, ' ')}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Job Timeline (Audit Logs) */}
      <JobAuditLogs jobId={job.id} />

      {/* Detail Grid */}
      <div className="detail-grid" style={{ marginBottom: 'var(--space-xl)' }}>
        <div className="section-card" style={{ marginBottom: 0 }}>
          <div className="section-card-header">
            <h3 style={{ fontSize: '1rem', margin: 0 }}>Client Information</h3>
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
          <div className="section-card-header">
            <h3 style={{ fontSize: '1rem', margin: 0 }}>Tenant Information (Snapshot)</h3>
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
      
      <JobEditDetails job={job} onUpdated={loadJob} />

      <JobPnL jobId={job.id} />
      <JobWorkLogs jobId={job.id} />
      <JobCommunications jobId={job.id} />
      <JobMediaUpload jobId={job.id} />
      <JobDocuments jobId={job.id} jobStatus={job.status} />

    </div>
  );
}
