import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import { Calendar, Clock, MapPin, User, X, Briefcase, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Select, { type MultiValue } from 'react-select';
import { reactSelectMenuProps } from '../utils/reactSelectTheme';

interface WorkLog {
  id: string;
  jobId: string;
  contractorId: string;
  workDate: string;
  hoursWorked: string | number;
  rateApplied?: string | number;
  materialCost: string | number | null;
  notes: string | null;
  createdAt: string;
  contractor?: { id: string; name: string };
  loggedBy?: { id: string; name: string };
  job?: { id: string; sequence: number; status: string; description: string | null; property: { address: string; accessNotes: string | null } };
}

interface UpcomingJob {
  id: string;
  sequence: number;
  status: string;
  scheduledDate: string;
  description?: string | null;
  property?: { address: string };
  assignedContractors?: { id: string; name: string }[];
}

interface CommunicationLog {
  id: string;
  performedBy: { name: string };
  loggedAt: string;
  direction: string;
  method: string;
  notes: string | null;
}

interface ContractorOption {
  id: string;
  name: string;
}

const UPCOMING_WINDOW_DAYS = 14;
const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/** Strip empty / undefined / "undefined" entries so repeated query params stay valid UUIDs. */
function cleanContractorIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim())
    .filter((id) => id !== '' && id !== 'undefined' && id !== 'null');
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDateKey(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "Sept 26 - 10:00 AM" */
function formatScheduled(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} - ${time}`;
}

function jobTitle(job: UpcomingJob): string {
  const desc = job.description?.split('\n')[0]?.trim();
  if (desc) return desc.length > 64 ? `${desc.slice(0, 64)}…` : desc;
  return `Job #${job.sequence} — ${job.status.replace(/_/g, ' ').toLowerCase()}`;
}

function ContractorAvatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: 'var(--status-checked-bg)',
        color: 'var(--status-checked-text)',
        border: '1px solid var(--color-border)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size <= 28 ? '0.65rem' : '0.75rem',
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function LogisticsGrid() {
  const [selectedLog, setSelectedLog] = useState<WorkLog | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'jobHistory' | 'contractorDay' | 'comms'>('details');
  const [jobHistoryLogs, setJobHistoryLogs] = useState<WorkLog[]>([]);
  const [contractorDayLogs, setContractorDayLogs] = useState<WorkLog[]>([]);
  const [communicationLogs, setCommunicationLogs] = useState<CommunicationLog[]>([]);
  const [isContextLoading, setIsContextLoading] = useState(false);
  const [newCommNotes, setNewCommNotes] = useState('');
  const [isCommSubmitting, setIsCommSubmitting] = useState(false);

  const [logs, setLogs] = useState<WorkLog[]>([]);
  const [contractors, setContractors] = useState<{ id: string; name: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [upcomingJobs, setUpcomingJobs] = useState<UpcomingJob[]>([]);
  const [isLoadingUpcoming, setIsLoadingUpcoming] = useState(true);

  const today = new Date();
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [startDate, setStartDate] = useState(lastWeek.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0]);
  // [] = no contractor filter. (We never pre-select "All Contractors".)
  const [contractorIds, setContractorIds] = useState<string[]>([]);
  const [contractorLoading, setContractorLoading] = useState(true);

  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  const [periodSummary, setPeriodSummary] = useState<{
    totals: { hours: string; labourCost?: string; materialCost: string; logCount: number };
  } | null>(null);

  const contractorOptions: ContractorOption[] = useMemo(
    () => [{ id: '', name: 'All Contractors' }, ...contractors.map((c) => ({ id: c.id, name: c.name }))],
    [contractors],
  );

  const cleanIds = useMemo(() => cleanContractorIds(contractorIds), [contractorIds]);

  const selectValue: ContractorOption[] = useMemo(() => {
    // No selection yet
    if (cleanIds.length === 0) return [];
    const byId = new Map(contractorOptions.map((o) => [o.id, o]));
    return cleanIds.map((id) => byId.get(id)).filter((o): o is ContractorOption => Boolean(o));
  }, [cleanIds, contractorOptions]);

  const handleContractorChange = (selected: MultiValue<ContractorOption>) => {
    const list = selected ?? [];
    // If user cleared all selections or chose "All Contractors" (empty id)
    if (!list.length || list.some((o) => o.id === '')) {
      setContractorIds([]);
    } else {
      const ids = cleanContractorIds(list.map((o) => o.id));
      setContractorIds(ids.length > 0 ? ids : []);
    }
    setPage(1);
  };

  // Backend accepts a single contractorId / assignedContractorId (isUUID).
  // Sending `?contractorId=a&contractorId=b` fails validation, so for
  // multi-select we fetch unfiltered and narrow client-side.
  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', new Date(startDate).toISOString());
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        params.append('endDate', end.toISOString());
      }
      if (cleanIds.length === 1) params.append('contractorId', cleanIds[0]);
      params.append('page', page.toString());

      const response = await apiFetch(`/work-logs?${params.toString()}`);
      const rows: WorkLog[] = response.data || [];
      setLogs(cleanIds.length > 1 ? rows.filter((l) => cleanIds.includes(l.contractorId)) : rows);
      if (response.meta) setTotalPages(response.meta.totalPages || 1);
    } catch (err: unknown) {
      // No red banner: keep the table mounted with an empty state instead.
      console.error('Failed to load logistics schedule:', err);
      setLogs([]);
      setTotalPages(1);
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate, cleanIds, page]);

  useEffect(() => {
    setContractorLoading(true);
    apiFetch('/engineers')
      .then((res) => {
        setContractors(Array.isArray(res) ? res : res?.data || []);
        setContractorLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setContractorLoading(false);
        setContractors([]);
      });
  }, []);

  useEffect(() => {
    setIsLoadingUpcoming(true);
    let cancelled = false;
    const now = new Date();
    const windowEnd = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams();
    params.append('tab', 'active');
    params.append('scheduledFrom', now.toISOString());
    params.append('scheduledTo', windowEnd.toISOString());
    params.append('limit', '100');
    if (cleanIds.length === 1) params.append('assignedContractorId', cleanIds[0]);

    apiFetch(`/jobs?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        const rows: UpcomingJob[] = res.data || [];
        setUpcomingJobs(
          cleanIds.length > 1
            ? rows.filter((j) => j.assignedContractors?.some((c) => cleanIds.includes(c.id)))
            : rows,
        );
      })
      .catch(() => {
        if (!cancelled) setUpcomingJobs([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingUpcoming(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cleanIds]);

  useEffect(() => {
    // /work-logs/summary requires exactly one contractorId (or jobId).
    if (cleanIds.length !== 1) {
      setPeriodSummary(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams();
    params.append('contractorId', cleanIds[0]);
    if (startDate) params.append('startDate', new Date(startDate).toISOString());
    if (endDate) {
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
      params.append('endDate', end.toISOString());
    }
    apiFetch(`/work-logs/summary?${params.toString()}`)
      .then((res) => {
        if (!cancelled) setPeriodSummary(res);
      })
      .catch(() => {
        if (!cancelled) setPeriodSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cleanIds, startDate, endDate]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    if (selectedLog) {
      setActiveTab('details');
      setIsPanelVisible(true);
      loadContextData(selectedLog);
    } else {
      setIsPanelVisible(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLog]);

  const loadContextData = async (log: WorkLog) => {
    setIsContextLoading(true);
    try {
      const logDate = new Date(log.workDate);
      const dayStart = new Date(logDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(logDate);
      dayEnd.setUTCHours(23, 59, 59, 999);

      const [jobRes, contractorRes, commsRes] = await Promise.all([
        apiFetch(`/work-logs?jobId=${log.jobId}&limit=100`),
        apiFetch(
          `/work-logs?contractorId=${log.contractorId}&startDate=${dayStart.toISOString()}&endDate=${dayEnd.toISOString()}&limit=100`,
        ),
        apiFetch(`/communication-logs?jobId=${log.jobId}&limit=100`),
      ]);
      setJobHistoryLogs(jobRes.data || []);
      setContractorDayLogs(contractorRes.data || []);
      setCommunicationLogs(commsRes.data || []);
    } catch (err: unknown) {
      console.error('Failed to load context data', err);
    } finally {
      setIsContextLoading(false);
    }
  };

  const handleCommSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommNotes.trim() || !selectedLog) return;
    setIsCommSubmitting(true);
    try {
      await apiFetch('/communication-logs', {
        method: 'POST',
        body: JSON.stringify({
          jobId: selectedLog.jobId,
          direction: 'INTERNAL',
          method: 'SYSTEM_NOTE',
          outcome: 'LOGGED',
          notes: newCommNotes,
        }),
      });
      setNewCommNotes('');
      loadContextData(selectedLog);
    } catch (err: unknown) {
      console.error('Failed to submit communication', err);
    } finally {
      setIsCommSubmitting(false);
    }
  };

  const groupedUpcoming = useMemo(() => {
    const groups: Record<string, UpcomingJob[]> = {};
    const sorted = [...upcomingJobs].sort(
      (a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime(),
    );
    sorted.forEach((job) => {
      const d = new Date(job.scheduledDate);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(job);
    });
    return groups;
  }, [upcomingJobs]);

  const sortedLogs = useMemo(
    () => [...logs].sort((a, b) => new Date(b.workDate).getTime() - new Date(a.workDate).getTime()),
    [logs],
  );

  const summaryLabel = contractorIds.includes('')
    ? 'All Contractors'
    : cleanIds
        .map((id) => contractors.find((c) => c.id === id)?.name ?? id)
        .join(', ');

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25, ease: EASE_OUT }}>
      <div className="page-header">
        <div className="page-header-title">
          <h1 className="flex items-center gap-3">
            <Calendar size={28} className="text-brand" style={{ color: 'var(--color-brand)' }} />
            Logistics Grid
          </h1>
          <p className="text-secondary" style={{ fontSize: '1.0625rem' }}>
            Upcoming jobs and logged contractor hours.
          </p>
        </div>
      </div>

      <div className="filter-bar logistics-filter-bar section-card" style={{ marginBottom: 'var(--space-xl)' }}>
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-muted" />
          <label className="form-label" style={{ margin: 0 }} htmlFor="logistics-start">
            Start:
          </label>
          <input
            id="logistics-start"
            type="date"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="form-label" style={{ margin: 0 }} htmlFor="logistics-end">
            End:
          </label>
          <input
            id="logistics-end"
            type="date"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          <User size={18} className="text-muted" />
          <label className="form-label" style={{ margin: 0 }} htmlFor="logistics-contractor">
            Contractor:
          </label>
          <Select<ContractorOption, true>
            inputId="logistics-contractor"
            isMulti
            options={contractorOptions}
            value={selectValue}
            onChange={handleContractorChange}
            placeholder={contractorLoading ? 'Loading contractors...' : 'Search contractors...'}
            isLoading={contractorLoading}
            isClearable
            getOptionLabel={(option) => option.name}
            getOptionValue={(option) => option.id}
            styles={{
              container: (provided) => ({ ...provided, flex: 1, minWidth: 0 }),
              control: (provided, state) => ({
                ...provided,
                minHeight: '44px',
                height: 'auto',
                borderRadius: 'var(--radius-sm)',
                fontSize: '1rem',
                backgroundColor: 'var(--color-surface)',
                borderColor: state.isFocused ? 'var(--color-brand)' : 'var(--color-border)',
                boxShadow: state.isFocused ? '0 0 0 2px var(--color-brand-light)' : 'none',
                alignItems: 'flex-start',
                '&:hover': { borderColor: 'var(--color-border-strong)' },
                minWidth: '280px',
              }),
              valueContainer: (provided) => ({
                ...provided,
                flexWrap: 'wrap',
                gap: '4px',
                padding: '4px 6px',
                maxHeight: '88px',
                overflowY: 'auto',
              }),
              option: (provided, state) => ({
                ...provided,
                backgroundColor: state.isSelected
                  ? 'var(--color-brand)'
                  : state.isFocused
                    ? 'var(--color-surface-hover)'
                    : 'var(--color-surface)',
                color: state.isSelected ? 'var(--color-brand-text)' : 'var(--color-text-primary)',
              }),
              input: (provided) => ({ ...provided, color: 'var(--color-text-primary)', fontSize: '1rem', margin: 0 }),
              placeholder: (provided) => ({ ...provided, color: 'var(--color-text-muted)' }),
              menu: (provided) => ({
                ...provided,
                backgroundColor: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: '0.375rem',
                marginTop: '0.125rem',
                boxShadow: 'var(--shadow-md)',
                zIndex: 1000,
              }),
              menuList: (provided) => ({ ...provided, padding: 0 }),
              multiValue: (provided) => ({
                ...provided,
                backgroundColor: 'var(--status-checked-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: '9999px',
                padding: '1px 2px 1px 8px',
                margin: 0,
                alignItems: 'center',
              }),
              multiValueLabel: (provided) => ({
                ...provided,
                color: 'var(--status-checked-text)',
                fontSize: '0.85rem',
                fontWeight: 600,
                padding: '1px 4px 1px 2px',
              }),
              multiValueRemove: (provided) => ({
                ...provided,
                color: 'var(--status-checked-text)',
                borderRadius: '50%',
                '&:hover': { backgroundColor: 'var(--color-border)', color: 'var(--color-text-primary)' },
              }),
            }}
            {...reactSelectMenuProps}
          />
        </div>
      </div>

      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <h3 className="flex items-center gap-2" style={{ marginBottom: 'var(--space-md)' }}>
          <Calendar size={20} className="text-brand" /> Upcoming (next {UPCOMING_WINDOW_DAYS} days)
        </h3>
        {isLoadingUpcoming ? (
          <div className="text-secondary" style={{ padding: 'var(--space-md)' }}>
            Loading upcoming jobs...
          </div>
        ) : Object.keys(groupedUpcoming).length === 0 ? (
          <div className="empty-state" style={{ padding: 'var(--space-md)' }}>
            <p className="text-secondary" style={{ margin: 0 }}>
              No jobs scheduled in this window.
            </p>
          </div>
        ) : (
          <div className="flex" style={{ flexDirection: 'column', gap: 'var(--space-md)' }}>
            {Object.entries(groupedUpcoming).map(([dateKey, jobsForDay]) => (
              <div key={dateKey}>
                <div className="text-secondary" style={{ fontSize: '0.9rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                  {formatDateKey(dateKey)}
                </div>
                <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
                  {jobsForDay.map((job) => {
                    const primary = job.assignedContractors?.[0];
                    return (
                      <Link
                        key={job.id}
                        to={`/jobs/${job.id}`}
                        className="section-card card-hover"
                        style={{
                          marginBottom: 0,
                          padding: 'var(--space-md)',
                          minWidth: '240px',
                          maxWidth: '320px',
                          flex: '1 1 240px',
                          textDecoration: 'none',
                          color: 'inherit',
                        }}
                      >
                        <div className="flex justify-between items-start" style={{ marginBottom: '0.5rem' }}>
                          <strong style={{ fontSize: '1rem' }}>Job #{job.sequence}</strong>
                          <span className={`status-badge ${job.status.toLowerCase()}`}>
                            {job.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <div
                          className="flex items-center gap-2 text-secondary"
                          style={{ fontSize: '0.85rem', marginBottom: '0.35rem' }}
                        >
                          <Clock size={14} /> {formatScheduled(job.scheduledDate)}
                        </div>
                        <div className="flex items-center gap-2" style={{ fontSize: '0.9rem', marginBottom: '0.35rem' }}>
                          {primary ? (
                            <>
                              <ContractorAvatar name={primary.name} size={28} />
                              <span style={{ fontWeight: 600 }}>{primary.name}</span>
                            </>
                          ) : (
                            <>
                              <span
                                className="flex items-center justify-center"
                                style={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: '50%',
                                  border: '1px dashed var(--color-border-strong)',
                                  color: 'var(--color-text-muted)',
                                }}
                              >
                                <User size={14} />
                              </span>
                              <span className="text-muted">Unassigned</span>
                            </>
                          )}
                        </div>
                        <div className="text-secondary" style={{ fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                          {jobTitle(job)}
                        </div>
                        <div
                          className="flex items-start gap-2 text-secondary"
                          style={{ fontSize: '0.85rem' }}
                        >
                          <MapPin size={14} style={{ marginTop: '1px', flexShrink: 0 }} />
                          <span>{job.property?.address || 'No property'}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <h3 className="flex items-center gap-2" style={{ marginBottom: 'var(--space-md)' }}>
        <FileText size={20} className="text-brand" /> Logged Hours
      </h3>

      {periodSummary && (
        <div className="section-card flex items-center gap-4" style={{ marginBottom: 'var(--space-xl)', fontSize: '0.9rem', flexWrap: 'wrap' }}>
          <strong>Period total ({summaryLabel}):</strong>
          <span>{Number(periodSummary.totals.hours).toFixed(2)} hrs</span>
          {periodSummary.totals.labourCost !== undefined && (
            <span>£{Number(periodSummary.totals.labourCost).toFixed(2)} labour</span>
          )}
          <span>£{Number(periodSummary.totals.materialCost).toFixed(2)} materials</span>
          <span className="text-secondary">{periodSummary.totals.logCount} logs</span>
        </div>
      )}

      {isLoading ? (
        <div className="text-secondary" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
          Loading schedule...
        </div>
      ) : sortedLogs.length === 0 ? (
        <div className="empty-state section-card" style={{ marginBottom: 0 }}>
          <Calendar size={32} className="text-muted" style={{ marginBottom: 'var(--space-md)' }} />
          <p className="font-medium" style={{ margin: 0 }}>
            No hours logged for this selection.
          </p>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, ease: EASE_OUT }}
        >
          <div className="section-card table-scroll" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="dense-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th scope="col">Contractor</th>
                  <th scope="col">Date</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Hours
                  </th>
                  <th scope="col">Project</th>
                </tr>
              </thead>
              <tbody>
                {sortedLogs.map((log) => {
                  const name = log.contractor?.name || 'Unassigned';
                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedLog(log);
                        }
                      }}
                      tabIndex={0}
                      className="interactive-list-item"
                      style={{ cursor: 'pointer' }}
                    >
                      <td data-label="Contractor">
                        <span className="flex items-center gap-2">
                          <ContractorAvatar name={name} size={28} />
                          <span style={{ fontWeight: 600 }}>{name}</span>
                        </span>
                      </td>
                      <td data-label="Date">
                        {new Date(log.workDate).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>
                      <td data-label="Hours" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {Number(log.hoursWorked).toFixed(2)}
                      </td>
                      <td data-label="Project">
                        <span style={{ fontWeight: 600 }}>Job #{log.job?.sequence}</span>
                        {log.job?.property?.address && (
                          <span className="text-secondary"> — {log.job.property.address}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-4" style={{ marginTop: 'var(--space-lg)' }}>
              <motion.button
                className="button secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.16, ease: EASE_OUT }}
              >
                Previous
              </motion.button>
              <span className="font-medium text-secondary" style={{ fontSize: '0.9rem' }}>
                Page {page} of {totalPages}
              </span>
              <motion.button
                className="button secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.16, ease: EASE_OUT }}
              >
                Next
              </motion.button>
            </div>
          )}
        </motion.div>
      )}

      {/* Slide-Over Context Dashboard */}
      <AnimatePresence>
        {isPanelVisible && selectedLog && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="slide-over-backdrop"
              onClick={() => {
                setIsPanelVisible(false);
                setTimeout(() => setSelectedLog(null), 250);
              }}
            />
            <motion.div
              initial={{ x: '4%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '4%', opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
              className="slide-over-panel"
              style={{ padding: 'var(--space-xl)', overflowY: 'auto' }}
            >
              <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-lg)' }}>
                <h3 className="flex items-center gap-2" style={{ margin: 0 }}>
                  <Briefcase size={22} className="text-primary" /> Context Dashboard
                </h3>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ duration: 0.16, ease: EASE_OUT }}
                  onClick={() => {
                    setIsPanelVisible(false);
                    setTimeout(() => setSelectedLog(null), 250);
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
                  aria-label="Close context panel"
                >
                  <X size={24} />
                </motion.button>
              </div>

              {/* Segmented Controls */}
              <div className="segment-control" style={{ width: '100%', marginBottom: 'var(--space-lg)', display: 'flex' }}>
                {(['details', 'jobHistory', 'contractorDay', 'comms'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={activeTab === tab ? 'active' : ''}
                    style={{ flex: 1, textAlign: 'center' }}
                  >
                    {tab === 'details' ? 'Details' : tab === 'jobHistory' ? 'History' : tab === 'contractorDay' ? 'Route' : 'Comms'}
                  </button>
                ))}
              </div>

              {/* Tab 1: Log Details */}
              {activeTab === 'details' && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                  className="flex"
                  style={{ flexDirection: 'column', gap: 'var(--space-md)' }}
                >
                  <div className="section-card" style={{ marginBottom: 0 }}>
                    <div className="flex" style={{ flexDirection: 'column', gap: '0.5rem', marginBottom: 'var(--space-sm)' }}>
                      <div className="flex items-center gap-2">
                        <Calendar size={16} className="text-muted" /> <strong>Date:</strong>{' '}
                        {new Date(selectedLog.workDate).toLocaleDateString()}
                      </div>
                      <div className="flex items-center gap-2">
                        <User size={16} className="text-muted" /> <strong>Contractor:</strong>{' '}
                        {selectedLog.contractor?.name}
                      </div>
                    </div>
                    <h4
                      style={{
                        marginTop: 'var(--space-md)',
                        marginBottom: 'var(--space-sm)',
                        borderTop: '1px solid var(--color-border)',
                        paddingTop: 'var(--space-md)',
                      }}
                    >
                      Financials
                    </h4>
                    <div className="form-grid-2">
                      <div>
                        <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                          HOURS
                        </span>
                        <br />
                        <span style={{ fontSize: '1.1rem', fontWeight: 500 }}>
                          {Number(selectedLog.hoursWorked).toFixed(2)}
                        </span>
                      </div>
                      {selectedLog.rateApplied !== undefined && (
                        <div>
                          <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                            RATE
                          </span>
                          <br />
                          <span style={{ fontSize: '1.1rem', fontWeight: 500 }}>
                            £{Number(selectedLog.rateApplied).toFixed(2)}
                          </span>
                        </div>
                      )}
                      <div>
                        <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                          MATERIALS
                        </span>
                        <br />
                        <span style={{ fontSize: '1.1rem', fontWeight: 500 }}>
                          £{Number(selectedLog.materialCost || 0).toFixed(2)}
                        </span>
                      </div>
                      {selectedLog.rateApplied !== undefined && (
                        <div>
                          <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                            TOTAL COST
                          </span>
                          <br />
                          <span style={{ fontSize: '1.1rem', fontWeight: 500, color: 'var(--color-brand)' }}>
                            £
                            {(
                              Number(selectedLog.hoursWorked) * Number(selectedLog.rateApplied) +
                              Number(selectedLog.materialCost || 0)
                            ).toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="section-card" style={{ marginBottom: 0 }}>
                    <h4 className="flex items-center gap-2">
                      <FileText size={18} className="text-muted" /> Notes
                    </h4>
                    <p
                      style={{
                        whiteSpace: 'pre-wrap',
                        backgroundColor: 'var(--color-bg)',
                        padding: 'var(--space-md)',
                        borderRadius: 'var(--radius-sm)',
                        margin: 0,
                        fontSize: '0.9rem',
                      }}
                    >
                      {selectedLog.notes || <em className="text-muted">No notes provided.</em>}
                    </p>
                  </div>

                  <div className="section-card" style={{ marginBottom: 0 }}>
                    <h4>Job Context (Job #{selectedLog.job?.sequence})</h4>
                    <div className="flex" style={{ flexDirection: 'column', gap: '0.5rem', fontSize: '0.9rem' }}>
                      <div className="flex items-center gap-2">
                        <strong>Status:</strong>{' '}
                        <span className={`status-badge ${selectedLog.job?.status.toLowerCase()}`}>
                          {selectedLog.job?.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div>
                        <strong>Description:</strong> {selectedLog.job?.description || <em className="text-muted">No description.</em>}
                      </div>
                      <div className="flex items-start gap-2">
                        <strong>Address:</strong>{' '}
                        <MapPin size={14} className="text-muted" style={{ marginTop: '2px', flexShrink: 0 }} />{' '}
                        <span>{selectedLog.job?.property?.address}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Tab 2: Job History */}
              {activeTab === 'jobHistory' && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                >
                  <h4 style={{ marginBottom: 'var(--space-md)' }}>Job #{selectedLog.job?.sequence} Timeline</h4>
                  {isContextLoading ? (
                    <p>Loading history...</p>
                  ) : (
                    <div className="flex" style={{ flexDirection: 'column', gap: 'var(--space-md)' }}>
                      {jobHistoryLogs.map((log) => (
                        <div
                          key={log.id}
                          className={`timeline-item ${log.id === selectedLog.id ? 'active' : ''}`}
                          style={{ paddingBottom: 'var(--space-md)' }}
                        >
                          <div className="text-muted" style={{ fontSize: '0.85rem', fontWeight: 500 }}>
                            {new Date(log.workDate).toLocaleDateString()}
                          </div>
                          <div className="font-medium" style={{ marginTop: '4px' }}>
                            {log.contractor?.name}
                          </div>
                          <div className="text-secondary" style={{ fontSize: '0.9rem' }}>
                            {Number(log.hoursWorked).toFixed(2)} hours
                          </div>
                          {log.notes && (
                            <div className="text-muted" style={{ fontSize: '0.85rem', marginTop: '4px', fontStyle: 'italic' }}>
                              &ldquo;{log.notes}&rdquo;
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* Tab 3: Contractor's Day */}
              {activeTab === 'contractorDay' && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                >
                  <h4 style={{ marginBottom: 'var(--space-md)' }}>
                    {selectedLog.contractor?.name}&rsquo;s Route on {new Date(selectedLog.workDate).toLocaleDateString()}
                  </h4>
                  {isContextLoading ? (
                    <p>Loading contractor schedule...</p>
                  ) : (
                    <div className="flex" style={{ flexDirection: 'column', gap: 'var(--space-md)' }}>
                      {contractorDayLogs.map((log) => (
                        <div
                          key={log.id}
                          className={`timeline-item ${log.id === selectedLog.id ? 'active' : ''}`}
                          style={{ paddingBottom: 'var(--space-md)' }}
                        >
                          <div className="font-medium">Job #{log.job?.sequence}</div>
                          <div className="flex items-start gap-1 text-muted" style={{ fontSize: '0.85rem', margin: '4px 0' }}>
                            <MapPin size={12} style={{ marginTop: '3px' }} /> {log.job?.property?.address}
                          </div>
                          <div className="text-secondary" style={{ fontSize: '0.9rem' }}>
                            {Number(log.hoursWorked).toFixed(2)} hours
                          </div>
                          {log.notes && (
                            <div className="text-muted" style={{ fontSize: '0.85rem', marginTop: '4px', fontStyle: 'italic' }}>
                              &ldquo;{log.notes}&rdquo;
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* Tab 4: Comms & Updates */}
              {activeTab === 'comms' && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: EASE_OUT }}
                  className="flex"
                  style={{ flexDirection: 'column', height: '100%' }}
                >
                  <h4 style={{ marginBottom: 'var(--space-md)' }}>Updates & Communications</h4>
                  <div
                    className="flex"
                    style={{
                      flex: 1,
                      overflowY: 'auto',
                      flexDirection: 'column',
                      gap: 'var(--space-md)',
                      marginBottom: 'var(--space-md)',
                      paddingRight: '4px',
                    }}
                  >
                    {isContextLoading ? (
                      <p>Loading updates...</p>
                    ) : (
                      <>
                        {communicationLogs.map((log) => (
                          <div key={log.id} className="section-card" style={{ marginBottom: 0 }}>
                            <div className="flex justify-between" style={{ marginBottom: '4px' }}>
                              <strong style={{ fontSize: '0.9rem' }}>{log.performedBy?.name}</strong>
                              <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                                {new Date(log.loggedAt).toLocaleString()}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--color-brand)', marginBottom: '8px', fontWeight: 500 }}>
                              {log.direction === 'INTERNAL'
                                ? 'INTERNAL UPDATE'
                                : `${log.direction.replace('_', ' ')} (${log.method})`}
                            </div>
                            <div style={{ fontSize: '0.95rem' }}>{log.notes || <em className="text-muted">No notes.</em>}</div>
                          </div>
                        ))}
                        {communicationLogs.length === 0 && (
                          <p className="text-muted" style={{ fontStyle: 'italic' }}>
                            No communication logs or updates found.
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  <form
                    onSubmit={handleCommSubmit}
                    className="flex form-section"
                    style={{ marginTop: 'auto', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-md)' }}
                  >
                    <textarea
                      placeholder="Type an internal update..."
                      value={newCommNotes}
                      onChange={(e) => setNewCommNotes(e.target.value)}
                      style={{ width: '100%', resize: 'none', height: '80px', fontSize: '0.9rem' }}
                      required
                    />
                    <div className="form-actions" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
                      <motion.button
                        type="submit"
                        className="button primary"
                        disabled={isCommSubmitting || !newCommNotes.trim()}
                        whileTap={{ scale: 0.97 }}
                        transition={{ duration: 0.16, ease: EASE_OUT }}
                      >
                        {isCommSubmitting ? 'Posting...' : 'Post Update'}
                      </motion.button>
                    </div>
                  </form>
                </motion.div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
