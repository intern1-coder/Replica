import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/api';
import { prependById } from '../utils/refetch';
import CreatableSelect from 'react-select/creatable';
import { getReactSelectStyles, reactSelectMenuProps } from '../utils/reactSelectTheme';
import { useAuth } from '../contexts/AuthContext';
import { Paperclip, Trash2, Download, Copy } from 'lucide-react';

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
  rateApplied?: string; // omitted server-side for callers without engineer_costs:view
  materialCost?: string;
  notes: string | null;
  createdAt: string;
  contractor?: { id: string; name: string };
  loggedBy?: { id: string; name: string };
  receipts?: WorkLogReceipt[];
}

interface WorkLogSummary {
  totals: { hours: string; labourCost?: string; materialCost: string; logCount: number };
  byContractor: { contractorId: string; name: string; hours: string; labourCost?: string; materialCost: string; logCount: number }[];
}

const PAGE_LIMIT = 100;

/** Merge a refreshed page-1 window into the full loaded list without discarding rows loaded via "Load more". */
function mergePageOneRefresh(prev: WorkLog[], refreshed: WorkLog[]): WorkLog[] {
  const refreshedById = new Map(refreshed.map((w) => [w.id, w]));
  const updated = prev.map((w) => refreshedById.get(w.id) ?? w);
  const existingIds = new Set(prev.map((w) => w.id));
  const additions = refreshed.filter((w) => !existingIds.has(w.id));
  return [...additions, ...updated];
}

export function JobWorkLogs({ jobId, onEngineerAssigned }: { jobId: string; onEngineerAssigned?: () => void }) {
  const { socket, user, can } = useAuth();
  const [workLogs, setWorkLogs] = useState<WorkLog[]>([]);
  const [_meta, setMeta] = useState<{ total: number; page: number; limit: number; totalPages: number } | null>(null);
  const [contractors, setContractors] = useState<{ id: string; name: string; hourlyRate?: string | number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<WorkLogSummary | null>(null);

  const [workDate, setWorkDate] = useState(new Date().toISOString().split('T')[0]);
  const [hoursWorked, setHoursWorked] = useState<number | ''>('');
  const [contractorId, setContractorId] = useState('');
  const [hourlyRate, setHourlyRate] = useState<number | ''>('');
  const [materialCost, setMaterialCost] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingReceiptFor, setUploadingReceiptFor] = useState<string | null>(null);
  const [_editingLog, setEditingLog] = useState<WorkLog | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const groupedLogs = useMemo(() => {
    const groups: Record<string, { logs: WorkLog[], totalHours: number, totalCost: number, totalMaterials: number }> = {};

    workLogs.forEach(log => {
      const dateKey = new Date(log.workDate).toISOString().split('T')[0];
      if (!groups[dateKey]) {
        groups[dateKey] = { logs: [], totalHours: 0, totalCost: 0, totalMaterials: 0 };
      }
      groups[dateKey].logs.push(log);
      groups[dateKey].totalHours += Number(log.hoursWorked);
      groups[dateKey].totalCost += log.rateApplied !== undefined ? Number(log.hoursWorked) * Number(log.rateApplied) : 0;
      groups[dateKey].totalMaterials += Number(log.materialCost || 0);
    });

    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [workLogs]);

  const canSeeRates = workLogs.length === 0 || workLogs.some((w) => w.rateApplied !== undefined);

  const loadSummary = useCallback(async () => {
    try {
      const response = await apiFetch(`/work-logs/summary?jobId=${jobId}`);
      setSummary(response);
    } catch {
      // Non-critical — footer totals just stay hidden if this fails.
    }
  }, [jobId]);

  const loadPage = useCallback(async (page: number, opts?: { background?: boolean }) => {
    const background = opts?.background ?? false;
    try {
      const response = await apiFetch(`/work-logs?jobId=${jobId}&limit=${PAGE_LIMIT}&page=${page}`);
      const data: WorkLog[] = response.data || [];
      setMeta(response.meta);
      if (page === 1) {
        setWorkLogs((prev) => (background ? mergePageOneRefresh(prev, data) : data));
      } else {
        setWorkLogs((prev) => {
          const existingIds = new Set(prev.map((w) => w.id));
          return [...prev, ...data.filter((w) => !existingIds.has(w.id))];
        });
      }
    } catch {
      if (!background) setError('Failed to load work logs.');
    } finally {
      if (!background) setIsLoading(false);
    }
  }, [jobId]);

  const loadPageRef = useRef(loadPage);
  loadPageRef.current = loadPage;

  useEffect(() => {
    setIsLoading(true);
    loadPage(1);
    loadContractors();
    loadSummary();
  }, [jobId, loadPage, loadSummary]);

  useEffect(() => {
    if (!socket) return;
    const handler = (payload: { jobId: string; actorId?: string; workLog?: WorkLog }) => {
      if (payload.jobId !== jobId || payload.actorId === user?.id) return;
      if (payload.workLog) {
        setWorkLogs((prev) => prependById(prev, [payload.workLog!]));
        setMeta((prev) => (prev ? { ...prev, total: prev.total + 1 } : prev));
        loadSummary();
        return;
      }
      loadPageRef.current(1, { background: true });
      loadSummary();
    };
    socket.on('workLog:created', handler);
    return () => { socket.off('workLog:created', handler); };
  }, [socket, jobId, user?.id, loadSummary]);

  const loadContractors = async () => {
    try {
      const response = await apiFetch('/engineers');
      setContractors(response || []);
    } catch (err) {
      console.error('Failed to load contractors', err);
    }
  };

  const resetCreateForm = (keepContractorAndDate: boolean) => {
    setHoursWorked('');
    setMaterialCost('');
    setNotes('');
    if (!keepContractorAndDate) {
      setContractorId('');
      setHourlyRate('');
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const created = await apiFetch(`/work-logs`, {
        method: 'POST',
        body: JSON.stringify({
          jobId,
          contractorId,
          workDate: new Date(workDate).toISOString(),
          hoursWorked: String(hoursWorked),
          rateApplied: hourlyRate !== '' ? String(hourlyRate) : undefined,
          materialCost: materialCost !== '' ? String(materialCost) : undefined,
          notes: notes || null
        }),
      });

      // Keep contractor and date so a second log for the same engineer/day
      // is a few keystrokes, not a re-selection — this is the flow that used
      // to require the sticky "Edit" state and could overwrite the first log.
      resetCreateForm(true);
      setMeta((_meta) => (_meta ? { ..._meta, total: _meta.total + 1 } : _meta));
      setWorkLogs((prev) => prependById(prev, [created]));
      loadSummary();
      // The backend auto-assigns a not-yet-assigned engineer on first log —
      // the acting user's own JobDetail page never hears about that via
      // socket (its own broadcasts are skipped as "already known"), so tell
      // the parent directly to refresh job.assignedContractors.
      if (created.autoAssigned) {
        onEngineerAssigned?.();
      }
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

  const handleDuplicate = (log: WorkLog) => {
    setWorkDate(log.workDate.split('T')[0]);
    setContractorId(log.contractorId);
    setHourlyRate(log.rateApplied !== undefined ? Number(log.rateApplied) : '');
    setHoursWorked(Number(log.hoursWorked));
    setMaterialCost(log.materialCost !== undefined && log.materialCost !== null ? Number(log.materialCost) : '');
    setNotes(log.notes || '');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  
  const handleReceiptUpload = async (logId: string, file: File) => {
    setUploadingReceiptFor(logId);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const receipt = await apiFetch(`/work-logs/${logId}/receipts`, { method: 'POST', body: formData });
      setWorkLogs((prev) => prev.map((w) => (w.id === logId ? { ...w, receipts: [receipt, ...(w.receipts || [])] } : w)));
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

  const handleReceiptDelete = async (logId: string, receiptId: string) => {
    if (!window.confirm('Delete this receipt?')) return;
    try {
      await apiFetch(`/work-logs/receipts/${receiptId}`, { method: 'DELETE' });
      setWorkLogs((prev) => prev.map((w) => (w.id === logId ? { ...w, receipts: (w.receipts || []).filter((r) => r.id !== receiptId) } : w)));
    } catch (err: any) {
      setError(err.message || 'Failed to delete receipt');
    }
  };

  const handleDelete = async (logId: string) => {
    if (!window.confirm('Are you sure you want to delete this log?')) return;
    try {
      await apiFetch(`/work-logs/${logId}`, { method: 'DELETE' });
      setWorkLogs((prev) => prev.filter((log) => log.id !== logId));
      setMeta((_meta) => (_meta ? { ..._meta, total: Math.max(0, _meta.total - 1) } : _meta));
      loadSummary();
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

      {can('worklogs:create') && (
        <form ref={formRef} onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'row', gap: 'var(--space-md)', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 'var(--space-xl)' }}>
          <div className="form-row" style={{ flex: '1 1 100px' }}>
            <label className="form-label">Date *</label>
            <input type="date" value={workDate} onChange={e => setWorkDate(e.target.value)} required style={{ width: '100%' }} />
          </div>
          <div className="form-row" style={{ flex: '1 1 80px' }}>
            <label className="form-label">Hours *</label>
            <input type="number" step="0.5" min="0.5" max="24" value={hoursWorked} onChange={e => setHoursWorked(Number(e.target.value))} required style={{ width: '100%' }} />
          </div>
          <div className="form-row" style={{ flex: '1 1 180px' }}>
            <label className="form-label">Contractor *</label>
            <CreatableSelect
              isClearable
              isDisabled={isSubmitting}
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
            <input type="number" step="0.01" min="0" max="10000" value={hourlyRate} onChange={e => setHourlyRate(e.target.value ? Number(e.target.value) : '')} style={{ width: '100%' }} placeholder="Auto" />
          </div>
          <div className="form-row" style={{ flex: '1 1 100px' }}>
            <label className="form-label">Materials (£)</label>
            <input type="number" step="0.01" min="0" value={materialCost} onChange={e => setMaterialCost(e.target.value ? Number(e.target.value) : '')} style={{ width: '100%' }} placeholder="0.00" />
          </div>
          <div className="form-row" style={{ flex: '1 1 180px' }}>
            <label className="form-label">Notes</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="submit" className="button primary" disabled={isSubmitting}>
              {isSubmitting ? '...' : 'Add Log'}
            </button>
          </div>
        </form>
      )}

      {isLoading ? <p>Loading...</p> : (
        <>
          {summary && (
            <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-md)', padding: '0.6rem 0.85rem', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
              <div className="flex gap-2" style={{ flexWrap: 'wrap', fontSize: '0.85rem' }}>
                {summary.byContractor.map((c) => (
                  <span key={c.contractorId} className="text-secondary">
                    {c.name}: <strong>{Number(c.hours).toFixed(1)} hrs</strong>
                  </span>
                ))}
              </div>
              <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                Job total: {Number(summary.totals.hours).toFixed(1)} hrs
                {summary.totals.labourCost !== undefined && <> · £{Number(summary.totals.labourCost).toFixed(2)} labour</>}
                {' '}· £{Number(summary.totals.materialCost).toFixed(2)} materials · {summary.totals.logCount} logs
              </div>
            </div>
          )}

          <div className="table-container" style={{ overflowX: 'auto', maxWidth: '100%' }}>
            <table className="dense-table" style={{ width: '100%', tableLayout: 'fixed', fontSize: '0.85rem' }}>
              <thead>
                <tr>
                  <th className="px-3 py-2 text-left" style={{ width: '12%' }}>Contractor</th>
                  <th className="px-3 py-2 text-left" style={{ width: '12%' }}>Logged By</th>
                  <th className="px-3 py-2 text-right" style={{ width: '8%' }}>Hours</th>
                  {canSeeRates && (
                    <>
                      <th className="px-3 py-2 text-right" style={{ width: '8%' }}>Rate (£)</th>
                      <th className="px-3 py-2 text-right" style={{ width: '8%' }}>Labour (£)</th>
                    </>
                  )}
                  <th className="px-3 py-2 text-right" style={{ width: '8%', marginRight: '4px' }}>Materials (£)</th>
                  <th className="px-3 py-2 text-center" style={{ width: '12%', marginLeft: '4px' }}>Receipts</th>
                  <th className="px-3 py-2 text-left" style={{ width: '20%' }}>Notes</th>
                  <th className="px-3 py-2 text-right" style={{ width: '10%' }}>Actions</th>
                </tr>
              </thead>
              {groupedLogs.map(([dateKey, group]) => (
                <>
                  <tbody key={dateKey}>
                    <tr style={{ backgroundColor: 'var(--color-bg)' }}>
                      <td colSpan={canSeeRates ? 9 : 7} style={{ padding: '0.5rem', borderTop: '2px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                        <div className="flex justify-between">
                          <span className="text-secondary" style={{ fontSize: '0.9rem' }}>
                            {new Date(dateKey).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                          </span>
                          <span className="font-medium">
                            Daily Totals: {group.totalHours.toFixed(1)} hrs
                            {canSeeRates && <> | Labour £{group.totalCost.toFixed(2)}</>}
                            {' '}| Materials £{group.totalMaterials.toFixed(2)}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {group.logs.map(log => (
                      <tr key={log.id}>
                        <td className="px-3 py-2 text-left" style={{ width: '12%' }}>{log.contractor?.name || 'Unknown'}</td>
                        <td className="px-3 py-2 text-left" style={{ width: '12%' }}>{log.loggedBy?.name || 'Unknown'}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ width: '8%' }}>{Number(log.hoursWorked)}</td>
                        {canSeeRates && (
                          <td className="px-3 py-2 text-right tabular-nums text-secondary" style={{ width: '8%' }}>{log.rateApplied !== undefined ? `£${Number(log.rateApplied).toFixed(2)}` : ''}</td>
                        )}
                        {canSeeRates && (
                          <td className="px-3 py-2 text-right tabular-nums font-medium text-primary" style={{ width: '8%' }}>{log.rateApplied !== undefined ? `£${(Number(log.hoursWorked) * Number(log.rateApplied)).toFixed(2)}` : ''}</td>
                        )}
                        <td className="px-3 py-2 text-right tabular-nums" style={{ width: '8%' }}>{`£${Number(log.materialCost || 0).toFixed(2)}`}</td>
                        <td className="px-3 py-2 text-center" style={{ width: '12%' }}>
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
                                    onClick={() => handleReceiptDelete(log.id, receipt.id)}
                                    title="Delete receipt"
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', padding: 0 }}
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                                )
                              )
                            }
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
                        <td className="px-3 py-2" style={{ width: '20%', maxWidth: '20%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.notes || ''}>
                          {log.notes}
                        </td>
                        <td className="px-3 py-2 text-right" style={{ width: '10%' }}>
                          <div className="flex justify-end gap-2">
                            {can('worklogs:create') && (
                              <button type="button" className="button secondary small" onClick={() => handleDuplicate(log)} title="Duplicate this log">
                                <Copy size={14} />
                              </button>
                            )}
                            {can('worklogs:edit') && (
                              <button type="button" className="button secondary small" onClick={() => setEditingLog(log)}>Edit</button>
                            )}
                            {can('worklogs:delete') && (
                              <button type="button" className="button danger small" onClick={() => handleDelete(log.id)}>Delete</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              ))}
            </table>
          </div>
        </>
      )}
    </div>
    );
}