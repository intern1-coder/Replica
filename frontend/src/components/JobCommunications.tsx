import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';

interface CommunicationLog {
  id: string;
  jobId: string;
  method: 'CALL' | 'EMAIL' | 'WHATSAPP';
  direction: 'TO_TENANT' | 'TO_CLIENT';
  outcome: 'CONFIRMED' | 'NO_RESPONSE' | 'SENT';
  notes: string | null;
  loggedAt: string;
  performedBy?: { name: string };
}

export function JobCommunications({ jobId }: { jobId: string }) {
  const [logs, setLogs] = useState<CommunicationLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Form state
  const [method, setMethod] = useState<'CALL' | 'EMAIL' | 'WHATSAPP'>('CALL');
  const [direction, setDirection] = useState<'TO_TENANT' | 'TO_CLIENT'>('TO_TENANT');
  const [outcome, setOutcome] = useState<'CONFIRMED' | 'NO_RESPONSE' | 'SENT'>('CONFIRMED');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
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

  return (
    <div style={{ background: 'var(--surface-color)', padding: 'var(--spacing-md)', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)', marginTop: 'var(--spacing-md)' }}>
      <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)' }}>Communication Log</h3>
      
      {error && <div style={{ color: 'var(--status-cancelled-text)', marginBottom: 'var(--spacing-sm)' }}>{error}</div>}

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'flex-end', marginBottom: 'var(--spacing-md)', flexWrap: 'wrap' }}>
        <div style={{ flex: '0 0 auto' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 'var(--spacing-xs)' }}>Method</label>
          <select value={method} onChange={e => setMethod(e.target.value as any)}>
            <option value="CALL">Call</option>
            <option value="EMAIL">Email</option>
            <option value="WHATSAPP">WhatsApp</option>
          </select>
        </div>
        <div style={{ flex: '0 0 auto' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 'var(--spacing-xs)' }}>Direction</label>
          <select value={direction} onChange={e => setDirection(e.target.value as any)}>
            <option value="TO_TENANT">To Tenant</option>
            <option value="TO_CLIENT">To Client</option>
          </select>
        </div>
        <div style={{ flex: '0 0 auto' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 'var(--spacing-xs)' }}>Outcome</label>
          <select value={outcome} onChange={e => setOutcome(e.target.value as any)}>
            <option value="CONFIRMED">Confirmed</option>
            <option value="NO_RESPONSE">No Response</option>
            <option value="SENT">Sent</option>
          </select>
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 'var(--spacing-xs)' }}>Notes</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%' }} />
        </div>
        <button type="submit" className="primary" disabled={isSubmitting}>
          {isSubmitting ? '...' : 'Log'}
        </button>
      </form>

      {isLoading ? <p>Loading...</p> : (
        <table className="dense-table" style={{ fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>PM</th>
              <th>Method</th>
              <th>Direction</th>
              <th>Outcome</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id}>
                <td className="tabular-nums">{new Date(log.loggedAt).toLocaleString()}</td>
                <td>{log.performedBy?.name}</td>
                <td>{log.method}</td>
                <td>{log.direction.replace('_', ' ')}</td>
                <td>{log.outcome.replace('_', ' ')}</td>
                <td>{log.notes}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center' }}>No communications logged.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
