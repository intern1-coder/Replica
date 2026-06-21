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
        if (payload.role !== 'ADMIN' && payload.role !== 'OWNER' && payload.role !== 'PM') {
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

  const generateHumanReadableDiff = (log: any) => {
    if (log.action === 'CREATE') return `Created new ${log.entityType}.`;
    if (log.action === 'DELETE') return `Deleted ${log.entityType}.`;
    if (log.action === 'UPDATE') {
      if (!log.before || !log.after) return `Updated ${log.entityType}.`;
      const changes: string[] = [];
      for (const key in log.after) {
        if (log.before[key] !== log.after[key] && key !== 'updatedAt') {
          let beforeVal = log.before[key];
          let afterVal = log.after[key];
          if (typeof beforeVal === 'object' && beforeVal !== null) beforeVal = beforeVal.name || beforeVal.id || JSON.stringify(beforeVal);
          if (typeof afterVal === 'object' && afterVal !== null) afterVal = afterVal.name || afterVal.id || JSON.stringify(afterVal);
          
          // Format long UUIDs to be more readable or hide them
          const isUuid = (val: string) => typeof val === 'string' && val.length === 36 && val.split('-').length === 5;
          if (isUuid(beforeVal)) beforeVal = 'assigned';
          if (isUuid(afterVal)) afterVal = 'assigned';
          if (key === 'version') continue; // Hide optimistic locking version
          
          changes.push(`changed ${key} to '${afterVal || 'empty'}'`);
        }
      }
      if (changes.length === 0) return `Updated ${log.entityType} (no significant changes).`;
      return `Updated ${log.entityType}: ${changes.join(', ')}.`;
    }
    return `${log.action} performed on ${log.entityType}.`;
  };

  if (!hasPermission) return null;

  return (
    <div className="section-card">
      <div className="section-card-header">
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Audit Trail (Immutable)</h3>
      </div>
      
      {error && <div className="page-error">{error}</div>}

      {isLoading && !error ? <p>Loading audit trail...</p> : !error && (
        <div className="flex" style={{ flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {logs.map(log => (
            <div key={log.id} className="section-card" style={{ marginBottom: 0, padding: 'var(--space-sm)' }}>
              <div className="flex justify-between items-center">
                <div style={{ fontSize: '0.85rem' }}>
                  <span className={`status-badge ${log.action === 'DELETE' ? 'cancelled' : log.action === 'CREATE' ? 'authorised' : 'quoted'}`}>
                    {log.action}
                  </span>
                  <strong style={{ marginLeft: 'var(--space-sm)' }}>{log.entityType}</strong> <span className="text-muted">(ID: {log.entityId.slice(0, 8)}...)</span>
                  <span className="text-secondary" style={{ marginLeft: 'var(--space-sm)' }}>
                    by {log.performedBy?.name || 'Unknown'} at {new Date(log.createdAt).toLocaleString()}
                  </span>
                  <div className="text-primary" style={{ marginTop: 'var(--space-xs)', fontStyle: 'italic' }}>
                    {generateHumanReadableDiff(log)}
                  </div>
                </div>
                <button onClick={() => toggleExpand(log.id)} className="button secondary small">
                  {expandedLogId === log.id ? 'Hide Raw JSON' : 'View Raw JSON'}
                </button>
              </div>
              
              {expandedLogId === log.id && (
                <div className="detail-grid" style={{ marginTop: 'var(--space-sm)', fontSize: '0.8rem' }}>
                  <div className="section-card" style={{ marginBottom: 0, padding: 'var(--space-sm)', backgroundColor: 'var(--color-bg)', overflowX: 'auto' }}>
                    <strong>Before:</strong>
                    <pre style={{ margin: 0, marginTop: 'var(--space-xs)', color: 'var(--color-danger)' }}>
                      {log.before ? JSON.stringify(log.before, null, 2) : 'null'}
                    </pre>
                  </div>
                  <div className="section-card" style={{ marginBottom: 0, padding: 'var(--space-sm)', backgroundColor: 'var(--color-bg)', overflowX: 'auto' }}>
                    <strong>After:</strong>
                    <pre style={{ margin: 0, marginTop: 'var(--space-xs)', color: 'var(--color-success)' }}>
                      {log.after ? JSON.stringify(log.after, null, 2) : 'null'}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))}
          {logs.length === 0 && <p className="text-secondary empty-state" style={{ border: 'none' }}>No audit events found.</p>}
        </div>
      )}
    </div>
  );
}
