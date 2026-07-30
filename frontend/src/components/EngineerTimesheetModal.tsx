import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import { X } from 'lucide-react';

interface EngineerTimesheetModalProps {
  engineer: { id: string; name: string };
  onClose: () => void;
}

interface WorkLogSummary {
  totals: { hours: string; labourCost?: string; materialCost: string; logCount: number };
}

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Admin-facing timesheet total for one engineer over a date range — not a contractor login (Rules.md). */
export function EngineerTimesheetModal({ engineer, onClose }: EngineerTimesheetModalProps) {
  const [startDate, setStartDate] = useState(firstOfMonth());
  const [endDate, setEndDate] = useState(today());
  const [summary, setSummary] = useState<WorkLogSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError('');
    apiFetch(`/work-logs/summary?contractorId=${engineer.id}&startDate=${startDate}&endDate=${endDate}`)
      .then((res) => { if (!cancelled) setSummary(res); })
      .catch(() => { if (!cancelled) setError('Failed to load timesheet.'); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [engineer.id, startDate, endDate]);

  return (
    <div className="modal-backdrop entering" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-panel entering section-card" style={{ width: '420px', maxWidth: '90vw', padding: 0 }}>
        <div className="flex justify-between items-center" style={{ padding: 'var(--space-md)', borderBottom: '1px solid var(--color-border)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>{engineer.name} — Timesheet</h3>
          <button onClick={onClose} type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
          {error && <div className="page-error">{error}</div>}
          <div className="flex gap-2">
            <div className="form-row" style={{ flex: 1 }}>
              <label className="form-label">From</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="form-row" style={{ flex: 1 }}>
              <label className="form-label">To</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          {isLoading ? (
            <p>Loading...</p>
          ) : summary ? (
            <div className="detail-grid">
              <div className="section-card" style={{ marginBottom: 0 }}>
                <div className="text-secondary" style={{ fontSize: '0.8rem' }}>Total Hours</div>
                <div className="tabular-nums font-medium" style={{ fontSize: '1.2rem' }}>{Number(summary.totals.hours).toFixed(2)}</div>
              </div>
              <div className="section-card" style={{ marginBottom: 0 }}>
                <div className="text-secondary" style={{ fontSize: '0.8rem' }}>Logs</div>
                <div className="tabular-nums font-medium" style={{ fontSize: '1.2rem' }}>{summary.totals.logCount}</div>
              </div>
              {summary.totals.labourCost !== undefined && (
                <div className="section-card" style={{ marginBottom: 0 }}>
                  <div className="text-secondary" style={{ fontSize: '0.8rem' }}>Labour Cost</div>
                  <div className="tabular-nums font-medium" style={{ fontSize: '1.2rem' }}>£{Number(summary.totals.labourCost).toFixed(2)}</div>
                </div>
              )}
              <div className="section-card" style={{ marginBottom: 0 }}>
                <div className="text-secondary" style={{ fontSize: '0.8rem' }}>Materials</div>
                <div className="tabular-nums font-medium" style={{ fontSize: '1.2rem' }}>£{Number(summary.totals.materialCost).toFixed(2)}</div>
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2" style={{ padding: 'var(--space-md)', borderTop: '1px solid var(--color-border)' }}>
          <button onClick={onClose} className="button secondary">Close</button>
        </div>
      </div>
    </div>
  );
}
