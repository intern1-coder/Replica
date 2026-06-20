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

// Maps current status to legal next statuses
const allowedTransitions: Record<string, string[]> = {
  TO_BE_CHECKED: ['CHECKED', 'CANCELLED'],
  CHECKED: ['QUOTED', 'AUTHORISED', 'CANCELLED'],
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

    const handleStatusChanged = (payload: { jobId: number }) => {
      if (payload.jobId === Number(id)) {
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
  if (error && !job) return <p style={{ color: 'var(--status-cancelled-text)' }}>{error}</p>;
  if (!job) return <p>Job not found</p>;

  const availableTransitions = allowedTransitions[job.status] || [];

  return (
    <div>
      <div style={{ marginBottom: 'var(--spacing-md)' }}>
        <Link to="/jobs" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-secondary)' }}>
          <ArrowLeft size={16} /> Back to Jobs
        </Link>
      </div>

      {conflictError && (
        <div style={{ padding: 'var(--spacing-md)', marginBottom: 'var(--spacing-md)', backgroundColor: 'var(--status-quoted-bg)', color: 'var(--status-quoted-text)', border: '1px solid #ffeeba', borderRadius: 'var(--border-radius)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <strong>Update Conflict:</strong> Another user has modified this job since you opened it.
          </div>
          <button onClick={loadJob} className="secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', backgroundColor: 'white' }}>
            <RefreshCw size={16} /> Refresh Data
          </button>
        </div>
      )}

      {error && !conflictError && (
        <div style={{ padding: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)', backgroundColor: 'var(--status-cancelled-bg)', color: 'var(--status-cancelled-text)', borderRadius: 'var(--border-radius)' }}>
          {error}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: 'var(--surface-color)', padding: 'var(--spacing-lg)', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)', marginBottom: 'var(--spacing-lg)' }}>
        <div>
          <h2 style={{ marginBottom: 'var(--spacing-xs)', display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
            {job.sequence}
            <span className={`status-badge ${job.status.toLowerCase()}`} style={{ fontSize: '0.85rem' }}>
              {job.status.replace(/_/g, ' ')}
            </span>
          </h2>
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
            {job.property?.addressLine1}, {job.property?.city}
          </p>
        </div>
        
        {/* Status Transition Controls */}
        {availableTransitions.length > 0 && (
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
            {availableTransitions.map(nextStatus => (
              <button 
                key={nextStatus}
                onClick={() => handleStatusChange(nextStatus)}
                disabled={isUpdatingStatus || conflictError}
                className={nextStatus === 'CANCELLED' ? 'secondary' : 'primary'}
                style={{
                  backgroundColor: nextStatus === 'CANCELLED' ? 'var(--bg-color)' : `var(--status-${nextStatus.toLowerCase().replace(/_/g, '-')}-bg)`,
                  color: nextStatus === 'CANCELLED' ? 'inherit' : `var(--status-${nextStatus.toLowerCase().replace(/_/g, '-')}-text)`,
                  border: nextStatus === 'CANCELLED' ? '1px solid var(--border-color)' : 'none'
                }}
              >
                Mark as {nextStatus.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detail Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--spacing-md)' }}>
        <div style={{ background: 'var(--surface-color)', padding: 'var(--spacing-md)', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)' }}>
          <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: 'var(--spacing-sm)' }}>Client Information</h3>
          <p><strong>Name:</strong> {job.client?.name}</p>
          <p><strong>Email:</strong> {job.client?.email || 'N/A'}</p>
          <p><strong>Phone:</strong> {job.client?.phone || 'N/A'}</p>
        </div>

        <div style={{ background: 'var(--surface-color)', padding: 'var(--spacing-md)', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)' }}>
          <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: 'var(--spacing-sm)' }}>Tenant Information (Snapshot)</h3>
          <p><strong>Name:</strong> {job.tenantSnapshotName || 'N/A'}</p>
          <p><strong>Phone:</strong> {job.tenantSnapshotPhone || 'N/A'}</p>
        </div>
      </div>
      
      <div style={{ background: 'var(--surface-color)', padding: 'var(--spacing-md)', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)', marginTop: 'var(--spacing-md)' }}>
        <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: 'var(--spacing-sm)' }}>Job Description</h3>
        <p style={{ whiteSpace: 'pre-wrap' }}>{job.description || 'No description provided.'}</p>
      </div>

      <JobPnL jobId={job.id} />
      <JobWorkLogs jobId={job.id} />
      <JobCommunications jobId={job.id} />
      <JobMediaUpload jobId={job.id} />
      <JobDocuments jobId={job.id} />
      <JobAuditLogs jobId={job.id} />

    </div>
  );
}
