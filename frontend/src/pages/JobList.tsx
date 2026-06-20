import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import type { Client } from './ClientList';
import type { Property } from './PropertyList';
import { useAuth } from '../contexts/AuthContext';

export interface Job {
  id: number;
  sequence: number;
  status: 'TO_BE_CHECKED' | 'CHECKED' | 'QUOTED' | 'AUTHORISED' | 'COMPLETED' | 'CANCELLED';
  clientId: number;
  propertyId: number;
  description: string | null;
  tenantSnapshotName: string | null;
  tenantSnapshotPhone: string | null;
  version: number;
  createdAt: string;
  client?: Client;
  property?: Property;
}

export function JobList() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const { socket } = useAuth();
  
  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>('');

  useEffect(() => {
    loadJobs();
  }, [statusFilter]);

  // Socket.io Realtime Updates
  useEffect(() => {
    if (!socket) return;
    
    const handleStatusChanged = () => {
      // Re-fetch jobs to reflect the status change
      // Alternatively, we could patch the local state, but a refetch is safer for list sorting/filtering
      loadJobs();
    };

    socket.on('job:statusChanged', handleStatusChanged);
    
    return () => {
      socket.off('job:statusChanged', handleStatusChanged);
    };
  }, [socket, statusFilter]);

  const loadJobs = async () => {
    setIsLoading(true);
    try {
      // Build query string
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
      const response = await apiFetch(`/jobs${qs}`);
      setJobs(response.data || []);
    } catch (err: any) {
      setError('Failed to load jobs: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
        <h2>Jobs</h2>
        <Link to="/jobs/new" className="button primary" style={{ display: 'inline-block', padding: 'var(--spacing-sm) var(--spacing-md)', background: '#0d6efd', color: 'white', textDecoration: 'none', borderRadius: '4px', fontSize: '0.9rem', fontWeight: 500 }}>
          Create Job
        </Link>
      </div>

      {error && (
        <div style={{ padding: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)', backgroundColor: 'var(--status-cancelled-bg)', color: 'var(--status-cancelled-text)', borderRadius: 'var(--border-radius)' }}>
          {error}
        </div>
      )}

      {/* Filters */}
      <div style={{ marginBottom: 'var(--spacing-md)', display: 'flex', gap: 'var(--spacing-md)', alignItems: 'center' }}>
        <label style={{ fontSize: '0.9rem', fontWeight: 500 }}>Filter by Status:</label>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ minWidth: '150px' }}>
          <option value="">All Statuses</option>
          <option value="TO_BE_CHECKED">To Be Checked</option>
          <option value="CHECKED">Checked</option>
          <option value="QUOTED">Quoted</option>
          <option value="AUTHORISED">Authorised</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {/* List Table */}
      {isLoading ? (
        <p>Loading jobs...</p>
      ) : (
        <table className="dense-table">
          <thead>
            <tr>
              <th>Job #</th>
              <th>Status</th>
              <th>Address</th>
              <th>Client</th>
              <th>Date Created</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map(j => (
              <tr key={j.id}>
                <td className="tabular-nums">
                  <Link to={`/jobs/${j.id}`} style={{ fontWeight: 600 }}>{j.sequence}</Link>
                </td>
                <td>
                  <span className={`status-badge ${j.status.toLowerCase()}`}>
                    {j.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td>{j.property?.address || `Property #${j.propertyId.toString().substring(0,8)}`}</td>
                <td>{j.client?.name || `Client #${j.clientId.toString().substring(0,8)}`}</td>
                <td className="tabular-nums">{new Date(j.createdAt).toLocaleDateString()}</td>
                <td>
                  <Link to={`/jobs/${j.id}`} className="button secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', textDecoration: 'none' }}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: 'var(--spacing-lg)' }}>No jobs found.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
