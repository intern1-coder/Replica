import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../utils/api';
import CreatableSelect from 'react-select/creatable';

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
  const [contractors, setContractors] = useState<{id:string, name:string, hourlyRate?: string | number}[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Form state
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [workDate, setWorkDate] = useState(new Date().toISOString().split('T')[0]);
  const [hoursWorked, setHoursWorked] = useState<number | ''>('');
  const [contractorId, setContractorId] = useState('');
  const [hourlyRate, setHourlyRate] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const groupedLogs = useMemo(() => {
    const groups: Record<string, { logs: WorkLog[], totalHours: number, totalCost: number }> = {};
    
    workLogs.forEach(log => {
      const dateKey = new Date(log.workDate).toISOString().split('T')[0];
      if (!groups[dateKey]) {
        groups[dateKey] = { logs: [], totalHours: 0, totalCost: 0 };
      }
      groups[dateKey].logs.push(log);
      groups[dateKey].totalHours += Number(log.hoursWorked);
      groups[dateKey].totalCost += Number(log.hoursWorked) * Number(log.rateApplied);
    });
    
    // Sort dates descending
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [workLogs]);

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
      if (editingLogId) {
        // Update existing log
        await apiFetch(`/work-logs/${editingLogId}`, {
          method: 'PATCH',
          body: JSON.stringify({ 
            workDate: new Date(workDate).toISOString(), 
            hoursWorked: String(hoursWorked), 
            rateApplied: hourlyRate !== '' ? String(hourlyRate) : undefined,
            notes: notes || null 
          }),
        });
        setEditingLogId(null);
      } else {
        // Create new log
        await apiFetch(`/work-logs`, {
          method: 'POST',
          body: JSON.stringify({ 
            jobId,
            contractorId,
            workDate: new Date(workDate).toISOString(), 
            hoursWorked: String(hoursWorked), 
            hourlyRate: hourlyRate !== '' ? String(hourlyRate) : undefined,
            notes: notes || null 
          }),
        });
      }
      
      setNotes('');
      setHoursWorked('');
      setHourlyRate('');
      setContractorId('');
      // Update local contractor list if rate changed
      if (hourlyRate !== '') {
        setContractors(prev => prev.map(c => c.id === contractorId ? { ...c, hourlyRate } : c));
      }
      loadWorkLogs();
    } catch (err: any) {
      setError(err.message || 'Failed to add work log');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateContractor = async (inputValue: string) => {
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify({ name: inputValue, role: 'CONTRACTOR' })
      });
      setContractors(prev => [...prev, res]);
      setContractorId(res.id);
      setHourlyRate(0);
    } catch (err: any) {
      setError('Failed to create contractor: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (log: WorkLog) => {
    setEditingLogId(log.id);
    setWorkDate(log.workDate.split('T')[0]);
    setHoursWorked(Number(log.hoursWorked));
    setContractorId(log.contractorId);
    setHourlyRate(Number(log.rateApplied));
    setNotes(log.notes || '');
  };

  const handleDelete = async (logId: string) => {
    if (!window.confirm('Are you sure you want to delete this log?')) return;
    try {
      await apiFetch(`/work-logs/${logId}`, { method: 'DELETE' });
      loadWorkLogs();
    } catch (err: any) {
      setError(err.message || 'Failed to delete log');
    }
  };

  return (
    <div className="section-card">
      <div className="section-card-header">
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Work Logs (Labor)</h3>
      </div>
      
      {error && <div className="page-error">{error}</div>}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'row', gap: 'var(--space-md)', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 'var(--space-xl)' }}>
        <div className="form-row" style={{ flex: '1 1 120px' }}>
          <label className="form-label">Date *</label>
          <input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} required style={{ width: '100%' }} />
        </div>
        <div className="form-row" style={{ flex: '1 1 80px' }}>
          <label className="form-label">Hours *</label>
          <input type="number" step="0.5" min="0.5" value={hoursWorked} onChange={e => setHoursWorked(Number(e.target.value))} required style={{ width: '100%' }} />
        </div>
        <div className="form-row" style={{ flex: '1 1 200px' }}>
          <label className="form-label">Contractor *</label>
          <CreatableSelect
            isClearable
            isDisabled={isSubmitting || editingLogId !== null} // Cannot change contractor when editing (backend restriction)
            isLoading={isSubmitting}
            onChange={(newValue: any) => {
              setContractorId(newValue ? newValue.value : '');
              if (newValue) {
                const c = contractors.find(ct => ct.id === newValue.value);
                setHourlyRate(c?.hourlyRate !== undefined && c?.hourlyRate !== null ? Number(c.hourlyRate) : '');
              } else {
                setHourlyRate('');
              }
            }}
            onCreateOption={handleCreateContractor}
            options={contractors.map(c => ({ label: c.name, value: c.id }))}
            value={contractorId ? { label: contractors.find(c => c.id === contractorId)?.name || 'Unknown', value: contractorId } : null}
            placeholder="Select or type to create..."
            styles={{ container: (base) => ({ ...base, width: '100%' }) }}
          />
        </div>
        <div className="form-row" style={{ flex: '1 1 80px' }}>
          <label className="form-label">Rate (£)</label>
          <input type="number" step="0.01" min="0" value={hourlyRate} onChange={e => setHourlyRate(e.target.value ? Number(e.target.value) : '')} style={{ width: '100%' }} placeholder="Auto" />
        </div>
        <div className="form-row" style={{ flex: '1 1 200px' }}>
          <label className="form-label">Notes</label>
          <input type="text" value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="button primary" disabled={isSubmitting}>
            {isSubmitting ? '...' : (editingLogId ? 'Update Log' : 'Add Log')}
          </button>
          {editingLogId && (
            <button type="button" className="button secondary" onClick={() => {
              setEditingLogId(null);
              setHoursWorked('');
              setHourlyRate('');
              setNotes('');
              setContractorId('');
            }}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {isLoading ? <p>Loading...</p> : (
        <table className="dense-table" style={{ fontSize: '0.85rem' }}>
          <thead>
            <tr>
              <th>Contractor</th>
              <th>Logged By</th>
              <th>Hours</th>
              <th>Rate (£)</th>
              <th>Total (£)</th>
              <th>Notes</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          {groupedLogs.map(([dateKey, group]) => (
            <tbody key={dateKey}>
              <tr style={{ backgroundColor: 'var(--color-bg)' }}>
                <td colSpan={7} style={{ padding: '0.5rem', borderTop: '2px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                  <div className="flex justify-between" style={{ fontWeight: 500 }}>
                    <span className="text-secondary" style={{ fontSize: '0.9rem' }}>
                      {new Date(dateKey).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                    <span className="font-medium">
                      Daily Totals: {group.totalHours.toFixed(1)} hrs | £{group.totalCost.toFixed(2)}
                    </span>
                  </div>
                </td>
              </tr>
              {group.logs.map(log => (
                <tr key={log.id} style={{ backgroundColor: editingLogId === log.id ? 'var(--status-quoted-bg)' : 'transparent' }}>
                  <td>{log.contractor?.name || 'Unknown'}</td>
                  <td className="text-secondary">{log.loggedBy?.name || 'Unknown'}</td>
                  <td className="tabular-nums font-medium">{Number(log.hoursWorked)}</td>
                  <td className="tabular-nums text-secondary">£{Number(log.rateApplied).toFixed(2)}</td>
                  <td className="tabular-nums font-medium text-primary">£{(Number(log.hoursWorked) * Number(log.rateApplied)).toFixed(2)}</td>
                  <td style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={log.notes || ''}>
                    {log.notes}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="flex justify-end gap-2">
                      <button type="button" className="button secondary small" onClick={() => handleEdit(log)}>Edit</button>
                      <button type="button" className="button danger small" onClick={() => handleDelete(log.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
          {groupedLogs.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={7} className="empty-state">No labor recorded.</td>
              </tr>
            </tbody>
          )}
        </table>
      )}
    </div>
  );
}
