import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';

interface WorkLog {
  id: string;
  jobId: string;
  contractorId: string;
  loggedById: string;
  workDate: string;
  hoursWorked: string;
  rateApplied: string;
  notes: string | null;
  createdAt: string;
  contractor?: { id: string; name: string };
  loggedBy?: { id: string; name: string };
}

export function JobWorkLogs({ jobId }: { jobId: string }) {
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [contractors, setContractors] = useState<{id:string, name:string}[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Form state
  const [workDate, setWorkDate] = useState(new Date().toISOString().split('T')[0]);
  const [hoursWorked, setHoursWorked] = useState<number | ''>('');
  const [contractorId, setContractorId] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadWorkLogs();
    loadContractors();
  }, [jobId]);

  const loadContractors = async () => {
    try {
      const response = await apiFetch('/users?role=CONTRACTOR');
      setContractors(response || []);
    } catch (err) {
      console.error('Failed to load contractors', err);
    }
  };

  const loadWorkLogs = async () => {
    try {
      const response = await apiFetch(`/work-logs?jobId=${jobId}`);
      setWorkLogs(response.data || []);
    } catch (err: any) {
      setError('Failed to load work logs.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const newLog = await apiFetch(`/work-logs`, {
        method: 'POST',
        body: JSON.stringify({ 
          jobId,
          contractorId,
          workDate: new Date(workDate).toISOString(), 
          hoursWorked: String(hoursWorked), 
          notes: notes || null 
        }),
      });
      setWorkLogs([newLog, ...workLogs]);
      setHoursWorked('');
      setNotes('');
    } catch (err: any) {
      setError(err.message || 'Failed to add work log');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ background: 'var(--surface-color)', padding: 'var(--spacing-md)', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)', marginTop: 'var(--spacing-md)' }}>
      <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)' }}>Work Logs (Labor)</h3>
      
      {error && <div style={{ color: 'var(--status-cancelled-text)', marginBottom: 'var(--spacing-sm)' }}>{error}</div>}

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'flex-end', marginBottom: 'var(--spacing-md)', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 120px' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 'var(--spacing-xs)' }}>Date *</label>
          <input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} required style={{ width: '100%' }} />
        </div>
        <div style={{ flex: '1 1 80px' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 'var(--spacing-xs)' }}>Hours *</label>
          <input type="number" step="0.5" min="0.5" value={hoursWorked} onChange={e => setHoursWorked(Number(e.target.value))} required style={{ width: '100%' }} />
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 'var(--spacing-xs)' }}>Contractor *</label>
          <select value={contractorId} onChange={e => setContractorId(e.target.value)} required style={{ width: '100%' }}>
            <option value="">Select a Contractor</option>
            {contractors.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 'var(--spacing-xs)' }}>Notes</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%' }} />
        </div>
        <button type="submit" className="primary" disabled={isSubmitting}>
          {isSubmitting ? '...' : 'Add Log'}
        </button>
      </form>

      {isLoading ? <p>Loading...</p> : (
        <table className="dense-table" style={{ fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Contractor</th>
              <th>Logged By</th>
              <th>Hours</th>
              <th>Rate (£)</th>
              <th>Total (£)</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {workLogs.map(wl => (
              <tr key={wl.id}>
                <td className="tabular-nums">{new Date(wl.workDate).toLocaleDateString()}</td>
                <td>{wl.contractor?.name || wl.contractorId}</td>
                <td>{wl.loggedBy?.name || wl.loggedById}</td>
                <td className="tabular-nums">{wl.hoursWorked}</td>
                <td className="tabular-nums">£{wl.rateApplied}</td>
                <td className="tabular-nums">£{(Number(wl.hoursWorked) * Number(wl.rateApplied)).toFixed(2)}</td>
                <td>{wl.notes || '-'}</td>
              </tr>
            ))}
            {workLogs.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center' }}>No labor recorded.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
