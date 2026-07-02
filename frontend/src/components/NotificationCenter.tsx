import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useReminders, type FollowUpReminder } from '../contexts/ReminderContext';

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const abs = Math.abs(diff);
  const minutes = Math.floor(abs / 60_000);
  const hours = Math.floor(abs / 3_600_000);
  const days = Math.floor(abs / 86_400_000);
  const suffix = diff < 0 ? 'from now' : 'ago';
  if (minutes < 2) return diff < 0 ? 'in a moment' : 'just now';
  if (hours < 1) return `${minutes}m ${suffix}`;
  if (days < 1) return `${hours}h ${suffix}`;
  return `${days}d ${suffix}`;
}

function ReminderRow({ r, onDone, onDismiss }: {
  r: FollowUpReminder;
  onDone: () => void;
  onDismiss: () => void;
}) {
  const isOverdue = new Date(r.dueAt) < new Date();
  const label = r.job?.property?.address ?? `Job #${r.job?.sequence ?? r.jobId.slice(0, 8)}`;

  return (
    <div style={{
      padding: '12px 16px',
      borderBottom: '1px solid var(--color-border)',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <Link
          to={`/jobs/${r.jobId}`}
          style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)', textDecoration: 'none' }}
        >
          {label}
        </Link>
        <span style={{
          fontSize: '0.75rem',
          color: isOverdue ? 'var(--color-error)' : 'var(--color-text-muted)',
          whiteSpace: 'nowrap',
        }}>
          {isOverdue ? '⚠ Overdue · ' : ''}{relativeTime(r.dueAt)}
        </span>
      </div>
      {r.note && (
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{r.note}</p>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
        <button
          onClick={onDone}
          className="button primary"
          style={{ fontSize: '0.75rem', padding: '3px 10px', borderRadius: '6px' }}
        >
          Done
        </button>
        <button
          onClick={onDismiss}
          className="button secondary"
          style={{ fontSize: '0.75rem', padding: '3px 10px', borderRadius: '6px', opacity: 0.7 }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

export function NotificationCenter() {
  const { openReminders, markDone, dismiss } = useReminders();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const overdueCount = openReminders.filter((r) => new Date(r.dueAt) < new Date()).length;
  const count = openReminders.length;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="button secondary"
        onClick={() => setOpen((o) => !o)}
        style={{ padding: '8px', borderRadius: '50%', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', position: 'relative' }}
        title="Follow-up reminders"
      >
        <Bell size={18} className="text-secondary" />
        {count > 0 && (
          <span style={{
            position: 'absolute',
            top: -4,
            right: -4,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: overdueCount > 0 ? 'var(--color-error)' : 'var(--color-brand)',
            color: '#fff',
            fontSize: '0.7rem',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 4px',
          }}>
            {count}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          width: 340,
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg, 12px)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          zIndex: 999,
          maxHeight: 480,
          overflowY: 'auto',
        }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Follow-up Reminders</span>
            {count > 0 && (
              <span className="status-badge" style={{ fontSize: '0.75rem' }}>{count} open</span>
            )}
          </div>

          {openReminders.length === 0 ? (
            <p className="text-muted" style={{ padding: '24px 16px', textAlign: 'center', fontSize: '0.85rem' }}>
              No pending follow-ups
            </p>
          ) : (
            openReminders.map((r) => (
              <ReminderRow
                key={r.id}
                r={r}
                onDone={() => markDone(r.id)}
                onDismiss={() => dismiss(r.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
