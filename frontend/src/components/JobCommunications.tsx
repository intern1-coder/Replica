import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';

interface CommunicationLog {
  id: string;
  jobId: string;
  method: 'CALL' | 'EMAIL' | 'WHATSAPP' | 'SYSTEM_NOTE';
  direction: 'TO_TENANT' | 'TO_CLIENT' | 'INTERNAL';
  outcome: 'CONFIRMED' | 'NO_RESPONSE' | 'SENT' | 'LOGGED';
  notes: string | null;
  loggedAt: string;
  performedBy?: { name: string };
}

export function JobCommunications({ jobId }: { jobId: string }) {
  const [logs, setLogs] = useState<CommunicationLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [method, setMethod] = useState<'CALL' | 'EMAIL' | 'WHATSAPP'>('CALL');
  const [direction, setDirection] = useState<'TO_TENANT' | 'TO_CLIENT'>('TO_TENANT');
  const [outcome, setOutcome] = useState<'CONFIRMED' | 'NO_RESPONSE' | 'SENT'>('CONFIRMED');
  const [notes, setNotes] = useState('');
  
  // Internal update state
  const [internalNotes, setInternalNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeForm, setActiveForm] = useState<'internal' | 'external'>('internal');

  useEffect(() => {
    loadLogs();
  }, [jobId]);

  const loadLogs = async () => {
    try {
      const response = await apiFetch(`/communication-logs?jobId=${jobId}`);
      setLogs(response.data || []);
    } catch (err: any) {
      setError('Failed to load communications.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExternalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const newLog = await apiFetch(`/communication-logs`, {
        method: 'POST',
        body: JSON.stringify({ jobId, method, direction, outcome, notes: notes || null }),
      });
      setLogs([newLog, ...logs]);
      setNotes('');
    } catch (err: any) {
      setError(err.message || 'Failed to add log');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInternalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!internalNotes.trim()) return;
    setIsSubmitting(true);
    setError('');
    try {
      const newLog = await apiFetch(`/communication-logs`, {
        method: 'POST',
        body: JSON.stringify({ 
          jobId, 
          method: 'SYSTEM_NOTE', 
          direction: 'INTERNAL', 
          outcome: 'LOGGED', 
          notes: internalNotes 
        }),
      });
      setLogs([newLog, ...logs]);
      setInternalNotes('');
    } catch (err: any) {
      setError(err.message || 'Failed to post update');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="section-card">
      <div className="section-card-header">
        <h3 style={{ fontSize: '1.1rem', margin: 0 }}>
          Updates & Communications
        </h3>
      </div>
      
      {error && <div className="page-error">{error}</div>}

      {/* Input Section */}
      <div className="section-card form-section" style={{ backgroundColor: 'var(--color-bg)' }}>
        
        {/* Toggle between Internal and External forms */}
        <div className="segment-control" style={{ marginBottom: 'var(--space-md)' }}>
          <button 
            type="button"
            onClick={() => setActiveForm('internal')}
            className={activeForm === 'internal' ? 'active' : ''}
            style={{ flex: 1 }}
          >
            Post Internal Update
          </button>
          <button 
            type="button"
            onClick={() => setActiveForm('external')}
            className={activeForm === 'external' ? 'active' : ''}
            style={{ flex: 1 }}
          >
            Log External Comm
          </button>
        </div>

        {activeForm === 'internal' ? (
          <form onSubmit={handleInternalSubmit} className="flex" style={{ flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <textarea 
              placeholder="Type a new internal update or note here..."
              value={internalNotes}
              onChange={e => setInternalNotes(e.target.value)}
              style={{ width: '100%', minHeight: '80px', padding: 'var(--space-sm)', resize: 'vertical' }}
              required
            />
            <button type="submit" className="button primary" disabled={isSubmitting || !internalNotes.trim()} style={{ alignSelf: 'flex-start' }}>
              {isSubmitting ? 'Posting...' : 'Post Update'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleExternalSubmit} className="flex" style={{ gap: 'var(--space-md)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="form-row" style={{ flex: '0 0 auto' }}>
              <label className="form-label">Method</label>
              <select value={method} onChange={e => setMethod(e.target.value as any)}>
                <option value="CALL">Call</option>
                <option value="EMAIL">Email</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            </div>
            <div className="form-row" style={{ flex: '0 0 auto' }}>
              <label className="form-label">Direction</label>
              <select value={direction} onChange={e => setDirection(e.target.value as any)}>
                <option value="TO_TENANT">To Tenant</option>
                <option value="TO_CLIENT">To Client</option>
              </select>
            </div>
            <div className="form-row" style={{ flex: '0 0 auto' }}>
              <label className="form-label">Outcome</label>
              <select value={outcome} onChange={e => setOutcome(e.target.value as any)}>
                <option value="CONFIRMED">Confirmed</option>
                <option value="NO_RESPONSE">No Response</option>
                <option value="SENT">Sent</option>
              </select>
            </div>
            <div className="form-row" style={{ flex: '1 1 200px' }}>
              <label className="form-label">Notes</label>
              <input type="text" value={notes} placeholder="Summary of communication..." onChange={e => setNotes(e.target.value)} style={{ width: '100%' }} />
            </div>
            <button type="submit" className="button primary" disabled={isSubmitting}>
              {isSubmitting ? 'Logging...' : 'Log Comm'}
            </button>
          </form>
        )}
      </div>

      {/* Timeline Feed */}
      <h4 style={{ fontSize: '1rem', marginBottom: 'var(--space-md)' }}>Timeline History</h4>
      {isLoading ? <p>Loading timeline...</p> : (
        <div className="flex" style={{ flexDirection: 'column', gap: 'var(--space-md)' }}>
          {logs.filter(log => activeForm === 'internal' ? log.direction === 'INTERNAL' : log.direction !== 'INTERNAL').map(log => (
            <div key={log.id} className="timeline-item active" style={{ 
              borderLeftColor: log.direction === 'INTERNAL' ? 'var(--color-brand)' : 'var(--color-text-muted)',
              paddingLeft: 'var(--space-md)'
            }}>
              <div style={{ flex: 1 }}>
                <div className="flex items-center gap-2" style={{ marginBottom: '4px' }}>
                  <strong style={{ fontSize: '0.9rem' }}>{log.performedBy?.name}</strong>
                  <span className="text-muted" style={{ fontSize: '0.8rem' }}>{new Date(log.loggedAt).toLocaleString()}</span>
                  
                  <span className="status-badge" style={{ 
                    backgroundColor: log.direction === 'INTERNAL' ? 'var(--color-brand-light)' : 'var(--color-bg)',
                    color: log.direction === 'INTERNAL' ? 'var(--color-brand)' : 'var(--color-text-secondary)',
                    padding: '2px 6px'
                  }}>
                    {log.direction === 'INTERNAL' ? 'INTERNAL UPDATE' : `${log.direction.replace('_', ' ')} (${log.method})`}
                  </span>
                </div>
                <div style={{ fontSize: '0.95rem', backgroundColor: 'var(--color-bg)', padding: 'var(--space-sm) var(--space-md)', borderRadius: 'var(--radius-md)', marginTop: '4px' }}>
                  {log.notes || <em className="text-muted">No additional notes.</em>}
                </div>
              </div>
            </div>
          ))}
          {logs.filter(log => activeForm === 'internal' ? log.direction === 'INTERNAL' : log.direction !== 'INTERNAL').length === 0 && (
            <p className="empty-state" style={{ border: 'none' }}>
              No {activeForm === 'internal' ? 'internal updates' : 'external communications'} have been logged yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
