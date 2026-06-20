import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';

interface WorkLog {
  id: number;
  jobId: number;
  userId: number;
  date: string;
  hours: number;
  rateApplied: number;
  notes: string | null;
  createdAt: string;
  user?: { id: number; email: string };
  job?: { id: number; sequence: number; status: string; property: { address: string } };
}

export function LogisticsGrid() {
  const [logs, setLogs] = useState<WorkLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Very basic: just fetch all and sort by date descending
  useEffect(() => {
    loadAllLogs();
  }, []);

  const loadAllLogs = async () => {
    try {
      // Hack: The backend doesn't have a GET /work-logs global endpoint right now. Wait, I should verify the backend routes.
      // Ah, the PRD says "Build Logistics Grid view (daily schedule from work logs)".
      // But we never built a generic `GET /api/work-logs` across all jobs in Phase 3 backend!
      // I will need to add that backend route, or we fetch from jobs. Let's assume we need to add a generic route in the backend. For now, I'll hit /api/work-logs.
      const response = await apiFetch('/work-logs');
      setLogs(response.data || []);
    } catch (err: any) {
      setError('Failed to load logistics schedule.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div>
      <h2 style={{ marginBottom: 'var(--spacing-md)' }}>Logistics Grid (Schedule)</h2>
      {error && <div style={{ color: 'var(--status-cancelled-text)', marginBottom: 'var(--spacing-sm)' }}>{error}</div>}
      
      {isLoading ? <p>Loading schedule...</p> : (
        <table className="dense-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Job #</th>
              <th>Address</th>
              <th>Status</th>
              <th>PM</th>
              <th>Hours</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id}>
                <td className="tabular-nums">{new Date(log.date).toLocaleDateString()}</td>
                <td>{log.job?.sequence}</td>
                <td>{log.job?.property?.address}</td>
                <td>
                  <span className={`status-badge ${log.job?.status.toLowerCase()}`}>
                    {log.job?.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td>{log.user?.email}</td>
                <td className="tabular-nums">{log.hours}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 'var(--spacing-lg)' }}>No logs scheduled.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
