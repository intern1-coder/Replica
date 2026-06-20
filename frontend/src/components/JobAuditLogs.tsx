import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';

interface AuditLog {
  id: string;
  entityType: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  performedById: string;
  before: any | null;
  after: any | null;
  createdAt: string;
  performedBy?: { name: string };
}

export function JobAuditLogs({ jobId }: { jobId: string }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState(true);

  useEffect(() => {
    // Check permission from token before fetching to prevent 403 console errors
    const token = localStorage.getItem('affinity_token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.role !== 'ADMIN' && payload.role !== 'OWNER') {
          setHasPermission(false);
          setIsLoading(false);
          return;
        }
      } catch (e) {
        console.error('Failed to parse token', e);
      }
    }
    
    loadLogs();
  }, [jobId]);

  const loadLogs = async () => {
    try {
      const response = await apiFetch(`/audit-logs?jobId=${jobId}`);
      setLogs(response.data || []);
    } catch (err: any) {
      if (err.status === 403) {
        setError('You do not have permission to view audit logs.');
      } else {
        setError('Failed to load audit logs.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedLogId(expandedLogId === id ? null : id);
  };

  if (!hasPermission) return null;

  return (
    <div style={{ background: 'var(--surface-color)', padding: 'var(--spacing-md)', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)', marginTop: 'var(--spacing-md)' }}>
      <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)' }}>Audit Trail (Immutable)</h3>
      
      {error && <div style={{ color: 'var(--status-cancelled-text)', marginBottom: 'var(--spacing-sm)' }}>{error}</div>}

      {isLoading && !error ? <p>Loading audit trail...</p> : !error && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-sm)' }}>
          {logs.map(log => (
            <div key={log.id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', padding: 'var(--spacing-sm)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.85rem' }}>
                  <span className={`status-badge ${log.action === 'DELETE' ? 'cancelled' : log.action === 'CREATE' ? 'authorised' : 'quoted'}`}>
                    {log.action}
                  </span>
                  <strong style={{ marginLeft: 'var(--spacing-sm)' }}>{log.entityType}</strong> (ID: {log.entityId.slice(0, 8)}...)
                  <span style={{ color: 'var(--text-secondary)', marginLeft: 'var(--spacing-sm)' }}>
                    by {log.performedBy?.name || 'Unknown'} at {new Date(log.createdAt).toLocaleString()}
                  </span>
                </div>
                <button onClick={() => toggleExpand(log.id)} className="secondary" style={{ padding: '0.1rem 0.4rem', fontSize: '0.75rem' }}>
                  {expandedLogId === log.id ? 'Hide Diffs' : 'View Diffs'}
                </button>
              </div>
              
              {expandedLogId === log.id && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)', marginTop: 'var(--spacing-sm)', fontSize: '0.8rem' }}>
                  <div style={{ background: 'var(--bg-color)', padding: 'var(--spacing-sm)', borderRadius: 'var(--border-radius)', overflowX: 'auto' }}>
                    <strong>Before:</strong>
                    <pre style={{ margin: 0, marginTop: 'var(--spacing-xs)', color: 'var(--status-cancelled-text)' }}>
                      {log.before ? JSON.stringify(log.before, null, 2) : 'null'}
                    </pre>
                  </div>
                  <div style={{ background: 'var(--bg-color)', padding: 'var(--spacing-sm)', borderRadius: 'var(--border-radius)', overflowX: 'auto' }}>
                    <strong>After:</strong>
                    <pre style={{ margin: 0, marginTop: 'var(--spacing-xs)', color: 'var(--status-authorised-text)' }}>
                      {log.after ? JSON.stringify(log.after, null, 2) : 'null'}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))}
          {logs.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>No audit events found.</p>}
        </div>
      )}
    </div>
  );
}
