import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/api';
import { mergeById, prependById } from '../utils/refetch';
import CreatableSelect from 'react-select/creatable';
import { getReactSelectStyles, reactSelectMenuProps } from '../utils/reactSelectTheme';
import { useAuth } from '../contexts/AuthContext';
import { Paperclip, Trash2, Download } from 'lucide-react';

interface WorkLogReceipt {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface WorkLog {
  id: string;
  jobId: string;
  contractorId: string;
  loggedById: string;
  workDate: string;
  hoursWorked: string;
  rateApplied: string;
  materialCost?: string;
  notes: string | null;
  createdAt: string;
  contractor?: { id: string; name: string };
  loggedBy?: { id: string; name: string };
  receipts?: WorkLogReceipt[];
}

export function JobWorkLogs({ jobId }: { jobId: string }) {
  const { socket, user, can } = useAuth();
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [contractors, setContractors] = useState<{id:string, name:string, hourlyRate?: string | number}[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [workDate, setWorkDate] = useState(new Date().toISOString().split('T')[0]);
  const [hoursWorked, setHoursWorked] = useState<number | ''>('');
  const [contractorId, setContractorId] = useState('');
  const [hourlyRate, setHourlyRate] = useState<number | ''>('');
  const [materialCost, setMaterialCost] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingReceiptFor, setUploadingReceiptFor] = useState<string | null>(null);

  const groupedLogs = useMemo(() => {
    const groups: Record<string, { logs: WorkLog[], totalHours: number, totalCost: number, totalMaterials: number }> = {};

    workLogs.forEach(log => {
      const dateKey = new Date(log.workDate).toISOString().split('T')[0];
      if (!groups[dateKey]) {
        groups[dateKey] = { logs: [], totalHours: 0, totalCost: 0, totalMaterials: 0 };
      }
      groups[dateKey].logs.push(log);
      groups[dateKey].totalHours += Number(log.hoursWorked);
      groups[dateKey].totalCost += Number(log.hoursWorked) * Number(log.rateApplied);
      groups[dateKey].totalMaterials += Number(log.materialCost || 0);
    });

    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [workLogs]);

  const loadWorkLogs = useCallback(async (background = false) => {
    try {
      const response = await apiFetch(`/work-logs?jobId=${jobId}`);
      const data: WorkLog[] = response.data || [];
      setWorkLogs((prev) => (background ? mergeById(prev, data) : data));
    } catch {
      if (!background) {
        setError('Failed to load work logs.');
      }
    } finally {
      if (!background) {
        setIsLoading(false);
      }
    }
  }, [jobId]);

  const loadWorkLogsRef = useRef(loadWorkLogs);
  loadWorkLogsRef.current = loadWorkLogs;

  useEffect(() => {
    loadWorkLogs(false);
    loadContractors();
  }, [jobId, loadWorkLogs]);

  useEffect(() => {
    if (!socket) return;
    const handler = (payload: { jobId: string; actorId?: string; workLog?: WorkLog }) => {
      if (payload.jobId !== jobId || payload.actorId === user?.id) return;
      if (payload.workLog) {
        setWorkLogs((prev) => prependById(prev, [payload.workLog!]));
        return;
      }
      loadWorkLogsRef.current(true);
    };
    socket.on('workLog:created', handler);
    return () => { socket.off('workLog:created', handler); };
  }, [socket, jobId, user?.id]);

  const loadContractors = async () => {
    try {
      const response = await apiFetch('/engineers');
      setContractors(response || []);
    } catch (err) {
      console.error('Failed to load contractors', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      if (editingLogId) {
        await apiFetch(`/work-logs/${editingLogId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            workDate: new Date(workDate).toISOString(),
            hoursWorked: String(hoursWorked),
            rateApplied: hourlyRate !== '' ? String(hourlyRate) : undefined,
            materialCost: materialCost !== '' ? String(materialCost) : '0',
            notes: notes || null
          }),
        });
        setEditingLogId(null);
      } else {
        await apiFetch(`/work-logs`, {
          method: 'POST',
          body: JSON.stringify({
            jobId,
            contractorId,
            workDate: new Date(workDate).toISOString(),
            hoursWorked: String(hoursWorked),
            hourlyRate: hourlyRate !== '' ? String(hourlyRate) : undefined,
            materialCost: materialCost !== '' ? String(materialCost) : undefined,
            notes: notes || null
          }),
        });
      }

      setNotes('');
      setHoursWorked('');
      setHourlyRate('');
      setMaterialCost('');
      setContractorId('');
      if (hourlyRate !== '') {
        setContractors(prev => prev.map(c => c.id === contractorId ? { ...c, hourlyRate } : c));
      }
      loadWorkLogs(false);
    } catch (err: any) {
      setError(err.message || 'Failed to add work log');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateContractor = async (inputValue: string) => {
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/engineers', {
        method: 'POST',
        body: JSON.stringify({ name: inputValue })
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
    setMaterialCost(log.materialCost !== undefined && log.materialCost !== null ? Number(log.materialCost) : '');
    setNotes(log.notes || '');
  };

  const handleReceiptUpload = async (logId: string, file: File) => {
    setUploadingReceiptFor(logId);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      await apiFetch(`/work-logs/${logId}/receipts`, { method: 'POST', body: formData });
      await loadWorkLogs(false);
    } catch (err: any) {
      setError(err.message || 'Failed to upload receipt');
    } finally {
      setUploadingReceiptFor(null);
    }
  };

  const handleReceiptDownload = async (receiptId: string) => {
    try {
      const response = await apiFetch(`/work-logs/receipts/${receiptId}/url?download=true`);
      const a = document.createElement('a');
      a.href = response.url;
      a.download = '';
      a.click();
    } catch (err: any) {
      setError(err.message || 'Failed to get receipt URL');
    }
  };

  const handleReceiptDelete = async (receiptId: string) => {
    if (!window.confirm('Delete this receipt?')) return;
    try {
      await apiFetch(`/work-logs/receipts/${receiptId}`, { method: 'DELETE' });
      await loadWorkLogs(false);
    } catch (err: any) {
      setError(err.message || 'Failed to delete receipt');
    }
  };

  const handleDelete = async (logId: string) => {
    if (!window.confirm('Are you sure you want to delete this log?')) return;
    try {
      await apiFetch(`/work-logs/${logId}`, { method: 'DELETE' });
      setWorkLogs((prev) => prev.filter((log) => log.id !== logId));
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
            isDisabled={isSubmitting || editingLogId !== null}
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
            styles={getReactSelectStyles()}
            {...reactSelectMenuProps}
          />
        </div>
        <div className="form-row" style={{ flex: '1 1 80px' }}>
          <label className="form-label">Rate (£)</label>
          <input type="number" step="0.01" min="0" value={hourlyRate} onChange={e => setHourlyRate(e.target.value ? Number(e.target.value) : '')} style={{ width: '100%' }} placeholder="Auto" />
        </div>
        <div className="form-row" style={{ flex: '1 1 100px' }}>
          <label className="form-label">Materials (£)</label>
          <input type="number" step="0.01" min="0" value={materialCost} onChange={e => setMaterialCost(e.target.value ? Number(e.target.value) : '')} style={{ width: '100%' }} placeholder="0.00" />
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
              setMaterialCost('');
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
              <th>Materials (£)</th>
              <th>Receipts</th>
              <th>Notes</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          {groupedLogs.map(([dateKey, group]) => (
            <tbody key={dateKey}>
              <tr style={{ backgroundColor: 'var(--color-bg)' }}>
                <td colSpan={9} style={{ padding: '0.5rem', borderTop: '2px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                  <div className="flex justify-between" style={{ fontWeight: 500 }}>
                    <span className="text-secondary" style={{ fontSize: '0.9rem' }}>
                      {new Date(dateKey).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>
                    <span className="font-medium">
                      Daily Totals: {group.totalHours.toFixed(1)} hrs | Labour £{group.totalCost.toFixed(2)} | Materials £{group.totalMaterials.toFixed(2)}
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
                  <td className="tabular-nums">£{Number(log.materialCost || 0).toFixed(2)}</td>
                  <td>
                    <div className="flex" style={{ flexDirection: 'column', gap: '2px' }}>
                      {(log.receipts || []).map(receipt => (
                        <div key={receipt.id} className="flex items-center gap-2" style={{ fontSize: '0.8rem' }}>
                          <button
                            type="button"
                            onClick={() => handleReceiptDownload(receipt.id)}
                            title={`Download ${receipt.fileName}`}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary, #6d28d9)', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: 0 }}
                          >
                            <Download size={12} />
                            <span style={{ maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{receipt.fileName}</span>
                          </button>
                          {can('worklogs:edit') && (
                            <button
                              type="button"
                              onClick={() => handleReceiptDelete(receipt.id)}
                              title="Delete receipt"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: 0 }}
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                      {can('worklogs:edit') && (
                        <label className="flex items-center gap-2" style={{ fontSize: '0.75rem', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
                          <Paperclip size={12} />
                          {uploadingReceiptFor === log.id ? 'Uploading…' : 'Attach'}
                          <input
                            type="file"
                            accept=".jpg,.jpeg,.png,.webp,.heic,.pdf"
                            style={{ display: 'none' }}
                            disabled={uploadingReceiptFor !== null}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleReceiptUpload(log.id, file);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </td>
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
                <td colSpan={9} className="empty-state">No labor recorded.</td>
              </tr>
            </tbody>
          )}
        </table>
      )}
    </div>
  );
}
