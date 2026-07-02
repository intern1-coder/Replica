import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Clock } from 'lucide-react';
import { apiFetch } from '../utils/api';
import { debounce, mergeById, prependById, type FetchOptions } from '../utils/refetch';
import { useReminders } from '../contexts/ReminderContext';
import { useAuth } from '../contexts/AuthContext';

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

interface FollowUpReminder {
  id: string;
  jobId: string;
  dueAt: string;
  note: string | null;
  status: 'OPEN' | 'DONE' | 'DISMISSED';
  resolvedReason: string | null;
  resolvedAt: string | null;
  createdAt: string;
  createdBy?: { name: string };
}

type TimelineEntry =
  | { kind: 'comm'; item: CommunicationLog; sortKey: string }
  | { kind: 'reminder'; item: FollowUpReminder; sortKey: string };

export function JobCommunications({ jobId }: { jobId: string }) {
  const [logs, setLogs] = useState<CommunicationLog[]>([]);
  const [reminders, setReminders] = useState<FollowUpReminder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const { snooze, markDone, dismiss } = useReminders();

  const [method, setMethod] = useState<'CALL' | 'EMAIL' | 'WHATSAPP'>('CALL');
  const [direction, setDirection] = useState<'TO_TENANT' | 'TO_CLIENT'>('TO_TENANT');
  const [outcome, setOutcome] = useState<'CONFIRMED' | 'NO_RESPONSE' | 'SENT'>('CONFIRMED');
  const [notes, setNotes] = useState('');

  const defaultFollowUpDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 16);
  };
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpNote, setFollowUpNote] = useState('');

  const [internalNotes, setInternalNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeForm, setActiveForm] = useState<'internal' | 'external'>('internal');

  const { socket, user } = useAuth();

  const loadAll = useCallback(async (options?: FetchOptions) => {
    const background = options?.background ?? false;
    if (!background) {
      setIsLoading(true);
    }
    try {
      const [logsRes, remindersRes] = await Promise.all([
        apiFetch(`/communication-logs?jobId=${jobId}`),
        apiFetch(`/reminders?jobId=${jobId}`),
      ]);
      setLogs((prev) => (background ? mergeById(prev, logsRes.data || []) : logsRes.data || []));
      setReminders((prev) => (background ? mergeById(prev, remindersRes || []) : remindersRes || []));
    } catch {
      setError('Failed to load communications.');
    } finally {
      if (!background) {
        setIsLoading(false);
      }
    }
  }, [jobId]);

  const loadAllRef = useRef(loadAll);
  loadAllRef.current = loadAll;

  const debouncedBackgroundLoad = useMemo(
    () => debounce(() => loadAllRef.current({ background: true }), 300),
    []
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Real-time: reload when another user logs a communication on this job
  useEffect(() => {
    if (!socket) return;
    const handler = (payload: {
      jobId: string;
      actorId?: string;
      log?: CommunicationLog;
      reminder?: FollowUpReminder;
    }) => {
      if (payload.jobId !== jobId) return;
      if (payload.actorId === user?.id) return;
      if (payload.log) {
        setLogs((prev) => prependById(prev, [payload.log!]));
      }
      if (payload.reminder) {
        setReminders((prev) => prependById(prev, [payload.reminder!]));
      }
      if (!payload.log && !payload.reminder) {
        debouncedBackgroundLoad();
      }
    };
    socket.on('communicationLog:created', handler);
    return () => { socket.off('communicationLog:created', handler); };
  }, [socket, jobId, user?.id, debouncedBackgroundLoad]);

  const handleExternalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const followUp = showFollowUp && followUpDate
        ? { dueAt: new Date(followUpDate).toISOString(), note: followUpNote || null }
        : undefined;
      const newLog = await apiFetch(`/communication-logs`, {
        method: 'POST',
        body: JSON.stringify({ jobId, method, direction, outcome, notes: notes || null, ...(followUp ? { followUp } : {}) }),
      });
      setNotes('');
      setShowFollowUp(false);
      setFollowUpDate('');
      setFollowUpNote('');
      // Reload everything so the timeline gets the new reminder too
      await loadAll({ background: true });
      setLogs(prev => prev.some(l => l.id === newLog.id) ? prev : [newLog, ...prev]);
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
      setLogs(prev => prev.some(l => l.id === newLog.id) ? prev : [newLog, ...prev]);
      setInternalNotes('');
    } catch (err: any) {
      setError(err.message || 'Failed to post update');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Build merged, sorted timeline for the external tab
  const timelineEntries: TimelineEntry[] = [
    ...logs
      .filter(l => l.direction !== 'INTERNAL')
      .map(l => ({ kind: 'comm' as const, item: l, sortKey: l.loggedAt })),
    ...reminders.map(r => ({ kind: 'reminder' as const, item: r, sortKey: r.createdAt })),
  ].sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  const internalLogs = logs.filter(l => l.direction === 'INTERNAL');

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
              <select value={outcome} onChange={e => {
                const val = e.target.value as 'CONFIRMED' | 'NO_RESPONSE' | 'SENT';
                setOutcome(val);
                if (val === 'NO_RESPONSE' && !showFollowUp) {
                  setShowFollowUp(true);
                  setFollowUpDate(defaultFollowUpDate());
                }
              }}>
                <option value="CONFIRMED">Confirmed</option>
                <option value="NO_RESPONSE">No Response</option>
                <option value="SENT">Sent</option>
              </select>
            </div>
            <div className="form-row" style={{ flex: '1 1 200px' }}>
              <label className="form-label">Notes</label>
              <input type="text" value={notes} placeholder="Summary of communication..." onChange={e => setNotes(e.target.value)} style={{ width: '100%' }} />
            </div>

            <div style={{ width: '100%', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={showFollowUp}
                  onChange={e => {
                    setShowFollowUp(e.target.checked);
                    if (e.target.checked && !followUpDate) setFollowUpDate(defaultFollowUpDate());
                  }}
                />
                Set follow-up reminder
              </label>
              {showFollowUp && (
                <div className="flex" style={{ gap: 'var(--space-md)', marginTop: 'var(--space-sm)', flexWrap: 'wrap' }}>
                  <div className="form-row" style={{ flex: '0 0 auto' }}>
                    <label className="form-label">Remind at</label>
                    <input
                      type="datetime-local"
                      value={followUpDate}
                      onChange={e => setFollowUpDate(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-row" style={{ flex: '1 1 180px' }}>
                    <label className="form-label">Reminder note</label>
                    <input
                      type="text"
                      value={followUpNote}
                      onChange={e => setFollowUpNote(e.target.value)}
                      placeholder="e.g. Call back to confirm access..."
                    />
                  </div>
                </div>
              )}
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

          {activeForm === 'internal' ? (
            <>
              {internalLogs.map(log => (
                <CommLogRow key={log.id} log={log} />
              ))}
              {internalLogs.length === 0 && (
                <p className="empty-state" style={{ border: 'none' }}>No internal updates have been logged yet.</p>
              )}
            </>
          ) : (
            <>
              {timelineEntries.map(entry =>
                entry.kind === 'comm' ? (
                  <CommLogRow key={`c-${entry.item.id}`} log={entry.item} />
                ) : (
                  <ReminderTimelineEntry
                    key={`r-${entry.item.id}`}
                    reminder={entry.item}
                    onSnooze={(id, minutes) => snooze(id, minutes).then(() => loadAll({ background: true }))}
                    onDone={(id, note) => markDone(id, note).then(() => loadAll({ background: true }))}
                    onDismiss={(id, note) => dismiss(id, note).then(() => loadAll({ background: true }))}
                  />
                )
              )}
              {timelineEntries.length === 0 && (
                <p className="empty-state" style={{ border: 'none' }}>No external communications have been logged yet.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CommLogRow({ log }: { log: CommunicationLog }) {
  return (
    <div className="timeline-item active" style={{
      borderLeftColor: log.direction === 'INTERNAL' ? 'var(--color-brand)' : 'var(--color-text-muted)',
      paddingLeft: 'var(--space-md)',
    }}>
      <div style={{ flex: 1 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: '4px' }}>
          <strong style={{ fontSize: '0.9rem' }}>{log.performedBy?.name}</strong>
          <span className="text-muted" style={{ fontSize: '0.8rem' }}>{new Date(log.loggedAt).toLocaleString()}</span>
          <span className="status-badge" style={{
            backgroundColor: log.direction === 'INTERNAL' ? 'var(--color-brand-light)' : 'var(--color-bg)',
            color: log.direction === 'INTERNAL' ? 'var(--color-brand)' : 'var(--color-text-secondary)',
            padding: '2px 6px',
          }}>
            {log.direction === 'INTERNAL' ? 'INTERNAL UPDATE' : `${log.direction.replace('_', ' ')} (${log.method})`}
          </span>
          {log.outcome === 'NO_RESPONSE' && (
            <span className="status-badge" style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '2px 6px' }}>
              NO RESPONSE
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.95rem', backgroundColor: 'var(--color-bg)', padding: 'var(--space-sm) var(--space-md)', borderRadius: 'var(--radius-md)', marginTop: '4px' }}>
          {log.notes || <em className="text-muted">No additional notes.</em>}
        </div>
      </div>
    </div>
  );
}

function reminderStatusStyle(status: FollowUpReminder['status']) {
  if (status === 'OPEN') return { bg: '#fef3c7', color: '#92400e' };
  if (status === 'DONE') return { bg: '#d1fae5', color: '#065f46' };
  return { bg: 'var(--color-bg)', color: 'var(--color-text-muted)' };
}

function ReminderTimelineEntry({
  reminder,
  onSnooze,
  onDone,
  onDismiss,
}: {
  reminder: FollowUpReminder;
  onSnooze: (id: string, minutes: number) => void;
  onDone: (id: string, note?: string) => void;
  onDismiss: (id: string, note?: string) => void;
}) {
  const [expandedAction, setExpandedAction] = useState<null | 'done' | 'dismiss' | 'snooze'>(null);
  const [actionNote, setActionNote] = useState('');
  const [customSnoozeDate, setCustomSnoozeDate] = useState('');
  const isOpen = reminder.status === 'OPEN';
  const isOverdue = isOpen && new Date(reminder.dueAt) < new Date();
  const style = reminderStatusStyle(reminder.status);

  const confirmDone = () => { onDone(reminder.id, actionNote || undefined); setExpandedAction(null); setActionNote(''); };
  const confirmDismiss = () => { onDismiss(reminder.id, actionNote || undefined); setExpandedAction(null); setActionNote(''); };
  const cancel = () => { setExpandedAction(null); setActionNote(''); setCustomSnoozeDate(''); };

  const snoozePreset = (minutes: number) => { onSnooze(reminder.id, minutes); setExpandedAction(null); };
  const snoozeCustom = () => {
    if (!customSnoozeDate) return;
    const diff = Math.round((new Date(customSnoozeDate).getTime() - Date.now()) / 60_000);
    if (diff > 0) { onSnooze(reminder.id, diff); setExpandedAction(null); setCustomSnoozeDate(''); }
  };

  return (
    <div className="timeline-item active" style={{ borderLeftColor: isOverdue ? 'var(--color-error)' : 'var(--color-warning)', paddingLeft: 'var(--space-md)' }}>
      <div style={{ flex: 1 }}>
        {/* Header row */}
        <div className="flex items-center gap-2" style={{ marginBottom: '4px', flexWrap: 'wrap' }}>
          <Clock size={14} style={{ color: isOverdue ? 'var(--color-error)' : 'var(--color-warning)', flexShrink: 0 }} />
          <strong style={{ fontSize: '0.9rem' }}>{reminder.createdBy?.name ?? 'System'}</strong>
          <span className="text-muted" style={{ fontSize: '0.8rem' }}>{new Date(reminder.createdAt).toLocaleString()}</span>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '2px 7px', borderRadius: 6, backgroundColor: style.bg, color: style.color }}>
            {reminder.status === 'OPEN' ? (isOverdue ? '⚠ FOLLOW-UP OVERDUE' : 'FOLLOW-UP OPEN') : reminder.status === 'DONE' ? 'FOLLOW-UP DONE' : 'FOLLOW-UP DISMISSED'}
          </span>
        </div>

        {/* Body */}
        <div style={{ fontSize: '0.9rem', backgroundColor: 'var(--color-bg)', padding: 'var(--space-sm) var(--space-md)', borderRadius: 'var(--radius-md)', marginTop: '4px' }}>
          <div style={{ marginBottom: 4 }}>
            <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Due: </span>
            <strong>{new Date(reminder.dueAt).toLocaleString()}</strong>
          </div>
          {reminder.note && (
            <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem', marginBottom: 4 }}>{reminder.note}</div>
          )}
          {reminder.status !== 'OPEN' && reminder.resolvedReason && (
            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              Closed: {reminder.resolvedReason}
              {reminder.resolvedAt ? ` · ${new Date(reminder.resolvedAt).toLocaleString()}` : ''}
            </div>
          )}

          {/* Action buttons — only for OPEN reminders */}
          {isOpen && expandedAction === null && (
            <div className="flex" style={{ gap: 6, marginTop: 10 }}>
              <button
                onClick={() => setExpandedAction('done')}
                className="button primary"
                style={{ fontSize: '0.78rem', padding: '4px 12px', borderRadius: 7 }}
              >
                Mark Done
              </button>
              <button
                onClick={() => setExpandedAction('snooze')}
                className="button secondary"
                style={{ fontSize: '0.78rem', padding: '4px 12px', borderRadius: 7 }}
              >
                Snooze
              </button>
              <button
                onClick={() => setExpandedAction('dismiss')}
                className="button secondary"
                style={{ fontSize: '0.78rem', padding: '4px 12px', borderRadius: 7, opacity: 0.7 }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Done expanded */}
          {isOpen && expandedAction === 'done' && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                type="text"
                placeholder="Add a closing note (optional)..."
                value={actionNote}
                onChange={e => setActionNote(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: '0.85rem', width: '100%' }}
                autoFocus
              />
              <div className="flex" style={{ gap: 6 }}>
                <button onClick={confirmDone} className="button primary" style={{ fontSize: '0.78rem', padding: '4px 14px', borderRadius: 7 }}>
                  Confirm Done
                </button>
                <button onClick={cancel} className="button secondary" style={{ fontSize: '0.78rem', padding: '4px 12px', borderRadius: 7 }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Dismiss expanded */}
          {isOpen && expandedAction === 'dismiss' && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                type="text"
                placeholder="Add a note before dismissing (optional)..."
                value={actionNote}
                onChange={e => setActionNote(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: '0.85rem', width: '100%' }}
                autoFocus
              />
              <div className="flex" style={{ gap: 6 }}>
                <button onClick={confirmDismiss} className="button secondary" style={{ fontSize: '0.78rem', padding: '4px 14px', borderRadius: 7, opacity: 0.75 }}>
                  Confirm Dismiss
                </button>
                <button onClick={cancel} className="button secondary" style={{ fontSize: '0.78rem', padding: '4px 12px', borderRadius: 7 }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Snooze expanded */}
          {isOpen && expandedAction === 'snooze' && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="flex" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Quick:</span>
                <button onClick={() => snoozePreset(60)} className="button secondary" style={{ fontSize: '0.78rem', padding: '4px 10px', borderRadius: 7 }}>+1h</button>
                <button onClick={() => snoozePreset(1440)} className="button secondary" style={{ fontSize: '0.78rem', padding: '4px 10px', borderRadius: 7 }}>+1d</button>
                <button onClick={() => snoozePreset(4320)} className="button secondary" style={{ fontSize: '0.78rem', padding: '4px 10px', borderRadius: 7 }}>+3d</button>
              </div>
              <div className="flex" style={{ gap: 6, alignItems: 'center' }}>
                <input
                  type="datetime-local"
                  value={customSnoozeDate}
                  onChange={e => setCustomSnoozeDate(e.target.value)}
                  style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: '0.85rem' }}
                />
                <button onClick={snoozeCustom} className="button primary" style={{ fontSize: '0.78rem', padding: '4px 12px', borderRadius: 7 }}>
                  Set
                </button>
              </div>
              <button onClick={cancel} className="button secondary" style={{ fontSize: '0.78rem', padding: '4px 10px', borderRadius: 7, alignSelf: 'flex-start' }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
