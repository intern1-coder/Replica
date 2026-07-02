import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import { useAuth } from './AuthContext';

export interface FollowUpReminder {
  id: string;
  jobId: string;
  job?: { id: string; sequence?: number; property?: { address: string } };
  createdById: string;
  createdBy?: { id: string; name: string };
  sourceCommunicationLogId?: string | null;
  dueAt: string;
  note?: string | null;
  status: 'OPEN' | 'DONE' | 'DISMISSED';
  resolvedAt?: string | null;
  resolvedReason?: string | null;
  notifiedAt?: string | null;
  createdAt: string;
}

interface ReminderContextValue {
  reminders: FollowUpReminder[];
  openReminders: FollowUpReminder[];
  byJobId: Record<string, FollowUpReminder[]>;
  refetch: () => void;
  snooze: (id: string, minutes?: number) => Promise<void>;
  markDone: (id: string, note?: string) => Promise<void>;
  dismiss: (id: string, note?: string) => Promise<void>;
}

const ReminderContext = createContext<ReminderContextValue | null>(null);

export function ReminderProvider({ children }: { children: ReactNode }) {
  const { socket, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [reminders, setReminders] = useState<FollowUpReminder[]>([]);
  const notifiedIds = useRef(new Set<string>());

  const fetchReminders = useCallback(async () => {
    try {
      const data = await apiFetch('/reminders?status=OPEN');
      setReminders(data);
    } catch {
      // silently fail — not critical enough to block the UI
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) fetchReminders();
  }, [fetchReminders, isAuthenticated]);

  // Socket-driven refresh
  useEffect(() => {
    if (!socket) return;
    const handler = () => fetchReminders();
    socket.on('reminder:changed', handler);
    socket.on('communicationLog:created', handler);
    return () => {
      socket.off('reminder:changed', handler);
      socket.off('communicationLog:created', handler);
    };
  }, [socket, fetchReminders]);

  // Browser push notifications — poll every 30s
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      reminders.forEach((r) => {
        if (r.status !== 'OPEN') return;
        if (notifiedIds.current.has(r.id)) return;
        if (new Date(r.dueAt).getTime() > now) return;

        notifiedIds.current.add(r.id);

        if (Notification.permission === 'granted') {
          fireNotification(r);
        } else if (Notification.permission === 'default') {
          Notification.requestPermission().then((perm) => {
            if (perm === 'granted') fireNotification(r);
          });
        }

        // Tell backend the push fired so it can record notifiedAt
        apiFetch(`/reminders/${r.id}/notified`, { method: 'PATCH' }).catch(() => {});
      });
    };

    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [reminders]);

  const fireNotification = (r: FollowUpReminder) => {
    const label = r.job?.property?.address ?? `Job #${r.job?.sequence ?? ''}`;
    const n = new Notification('Follow-up due', {
      body: r.note ? `${label}: ${r.note}` : label,
      icon: '/favicon.ico',
      tag: r.id,
    });
    n.onclick = () => {
      window.focus();
      navigateRef.current(`/jobs/${r.jobId}`);
    };
  };

  const patch = useCallback(
    async (id: string, body: object) => {
      await apiFetch(`/reminders/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      // Optimistically remove from open list; socket event will resync
      setReminders((prev) => prev.filter((r) => r.id !== id));
    },
    []
  );

  const snooze = useCallback(
    (id: string, minutes = 1440) => patch(id, { action: 'snooze', snoozeMinutes: minutes }),
    [patch]
  );
  const markDone = useCallback((id: string, note?: string) => patch(id, { action: 'done', ...(note ? { closingNote: note } : {}) }), [patch]);
  const dismiss = useCallback((id: string, note?: string) => patch(id, { action: 'dismiss', ...(note ? { closingNote: note } : {}) }), [patch]);

  const openReminders = reminders.filter((r) => r.status === 'OPEN');

  const byJobId = openReminders.reduce<Record<string, FollowUpReminder[]>>((acc, r) => {
    (acc[r.jobId] ??= []).push(r);
    return acc;
  }, {});

  return (
    <ReminderContext.Provider value={{ reminders, openReminders, byJobId, refetch: fetchReminders, snooze, markDone, dismiss }}>
      {children}
    </ReminderContext.Provider>
  );
}

export function useReminders() {
  const ctx = useContext(ReminderContext);
  if (!ctx) throw new Error('useReminders must be used within ReminderProvider');
  return ctx;
}
