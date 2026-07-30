import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import { Calendar, Clock, MapPin, User, X, Briefcase, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface WorkLog {
  id: string;
  jobId: string;
  contractorId: string;
  workDate: string;
  hoursWorked: string | number;
  rateApplied?: string | number; // omitted server-side for callers without engineer_costs:view
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
  property?: { address: string };
  assignedContractors?: { id: string; name: string }[];
}

const UPCOMING_WINDOW_DAYS = 14;

export function LogisticsGrid() {
  const [selectedLog, setSelectedLog] = useState<WorkLog | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'jobHistory' | 'contractorDay' | 'comms'>('details');
  const [jobHistoryLogs, setJobHistoryLogs] = useState<WorkLog[]>([]);
  const [contractorDayLogs, setContractorDayLogs] = useState<WorkLog[]>([]);
  const [communicationLogs, setCommunicationLogs] = useState<any[]>([]);
  const [isContextLoading, setIsContextLoading] = useState(false);
  const [newCommNotes, setNewCommNotes] = useState('');
  const [isCommSubmitting, setIsCommSubmitting] = useState(false);

  const [logs, setLogs] = useState<WorkLog[]>([]);
  const [contractors, setContractors] = useState<{id: string, name: string}[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [upcomingJobs, setUpcomingJobs] = useState<UpcomingJob[]>([]);
  const [isLoadingUpcoming, setIsLoadingUpcoming] = useState(true);

  const today = new Date();
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const [startDate, setStartDate] = useState(lastWeek.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0]);
  const [contractorId, setContractorId] = useState('');
  
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  const [periodSummary, setPeriodSummary] = useState<{ totals: { hours: string; labourCost?: string; materialCost: string; logCount: number } } | null>(null);

  useEffect(() => {
    apiFetch('/engineers')
      .then(res => setContractors(res))
      .catch(console.error);
  }, []);

  // Upcoming: jobs actually booked (Job.scheduledDate) in the next
  // UPCOMING_WINDOW_DAYS — independent of the logged-hours date range below,
  // since a future booking has no work logs yet. Respects the contractor filter.
  useEffect(() => {
    let cancelled = false;
    setIsLoadingUpcoming(true);
    const now = new Date();
    const windowEnd = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams();
    params.append('tab', 'active');
    params.append('scheduledFrom', now.toISOString());
    params.append('scheduledTo', windowEnd.toISOString());
    params.append('limit', '100');
    if (contractorId) params.append('assignedContractorId', contractorId);

    apiFetch(`/jobs?${params.toString()}`)
      .then((res) => { if (!cancelled) setUpcomingJobs(res.data || []); })
      .catch(() => { if (!cancelled) setUpcomingJobs([]); })
      .finally(() => { if (!cancelled) setIsLoadingUpcoming(false); });
    return () => { cancelled = true; };
  }, [contractorId]);

  // Period total for the selected contractor + date range — the server-side
  // aggregate, not a sum over whatever page of logs happens to be loaded.
  useEffect(() => {
    if (!contractorId) {
      setPeriodSummary(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams();
    params.append('contractorId', contractorId);
    if (startDate) params.append('startDate', new Date(startDate).toISOString());
    if (endDate) {
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
      params.append('endDate', end.toISOString());
    }
    apiFetch(`/work-logs/summary?${params.toString()}`)
      .then((res) => { if (!cancelled) setPeriodSummary(res); })
      .catch(() => { if (!cancelled) setPeriodSummary(null); });
    return () => { cancelled = true; };
  }, [contractorId, startDate, endDate]);

  useEffect(() => {
    loadLogs();
  }, [startDate, endDate, contractorId, page]);

  useEffect(() => {
    if (selectedLog) {
      setActiveTab('details');
      setIsPanelVisible(true);
      loadContextData(selectedLog);
    } else {
      setIsPanelVisible(false);
    }
  }, [selectedLog]);

  const loadContextData = async (log: WorkLog) => {
    setIsContextLoading(true);
    try {
      const logDate = new Date(log.workDate);
      // Use UTC day boundaries so the contractor-day query returns the right window
      // regardless of the server's local timezone.
      const dayStart = new Date(logDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(logDate);
      dayEnd.setUTCHours(23, 59, 59, 999);

      const [jobRes, contractorRes, commsRes] = await Promise.all([
        apiFetch(`/work-logs?jobId=${log.jobId}&limit=100`),
        apiFetch(`/work-logs?contractorId=${log.contractorId}&startDate=${dayStart.toISOString()}&endDate=${dayEnd.toISOString()}&limit=100`),
        apiFetch(`/communication-logs?jobId=${log.jobId}&limit=100`)
      ]);
      setJobHistoryLogs(jobRes.data || []);
      setContractorDayLogs(contractorRes.data || []);
      setCommunicationLogs(commsRes.data || []);
    } catch (err) {
      console.error("Failed to load context data", err);
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
          notes: newCommNotes
        })
      });
      setNewCommNotes('');
      loadContextData(selectedLog);
    } catch (err) {
      console.error('Failed to submit communication', err);
    } finally {
      setIsCommSubmitting(false);
    }
  };

  const loadLogs = async () => {
    setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', new Date(startDate).toISOString());
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        params.append('endDate', end.toISOString());
      }
      if (contractorId) params.append('contractorId', contractorId);
      params.append('page', page.toString());
      
      const response = await apiFetch(`/work-logs?${params.toString()}`);
      setLogs(response.data || []);
      if (response.meta) {
        setTotalPages(response.meta.totalPages || 1);
      }
    } catch (err: any) {
      setError('Failed to load logistics schedule.');
    } finally {
      setIsLoading(false);
    }
  };

  // Grouped by the UTC calendar date of workDate (a date-only column, stored
  // as UTC midnight) — matching JobWorkLogs.tsx's grouping — so a log doesn't
  // land under a different day here than it does on the job page for anyone
  // on a machine behind UTC.
  const groupedLogs = useMemo(() => {
    const groups: Record<string, Record<string, WorkLog[]>> = {};
    const sorted = [...logs].sort((a, b) => new Date(b.workDate).getTime() - new Date(a.workDate).getTime());

    sorted.forEach(log => {
      const dateKey = new Date(log.workDate).toISOString().split('T')[0];
      const contractorName = log.contractor?.name || 'Unassigned';

      if (!groups[dateKey]) groups[dateKey] = {};
      if (!groups[dateKey][contractorName]) groups[dateKey][contractorName] = [];
      groups[dateKey][contractorName].push(log);
    });
    return groups;
  }, [logs]);

  // scheduledDate carries a real time-of-day (set via the date+time picker in
  // Job Details), so — unlike workDate above — it's grouped by LOCAL calendar
  // day: an appointment at 9pm local is still "today" to the person viewing it,
  // even if that instant has already crossed into tomorrow in UTC.
  const groupedUpcoming = useMemo(() => {
    const groups: Record<string, UpcomingJob[]> = {};
    const sorted = [...upcomingJobs].sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime());
    sorted.forEach((job) => {
      const d = new Date(job.scheduledDate);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(job);
    });
    return groups;
  }, [upcomingJobs]);

  const formatDateKey = (dateKey: string) =>
    new Date(`${dateKey}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  const containerVariants: any = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.08 }
    }
  };

  const itemVariants: any = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', duration: 0.5, bounce: 0.1 } }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      <div className="page-header">
        <div className="page-header-title">
          <h1 className="flex items-center gap-3">
            <Calendar size={28} className="text-brand" style={{ color: 'var(--color-brand)' }} /> 
            Logistics Grid
          </h1>
          <p className="text-secondary" style={{ fontSize: '1.0625rem' }}>Upcoming jobs and logged contractor hours.</p>
        </div>
      </div>
      
      <div className="filter-bar section-card" style={{ marginBottom: 'var(--space-xl)' }}>
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-muted" />
          <label className="form-label" style={{ margin: 0 }}>Start:</label>
          <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(1); }} />
        </div>
        <div className="flex items-center gap-2">
          <label className="form-label" style={{ margin: 0 }}>End:</label>
          <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(1); }} />
        </div>
        <div className="flex items-center gap-2">
          <User size={18} className="text-muted" />
          <label className="form-label" style={{ margin: 0 }}>Contractor:</label>
          <select value={contractorId} onChange={e => { setContractorId(e.target.value); setPage(1); }} style={{ minWidth: '200px' }}>
            <option value="">All Contractors</option>
            {contractors.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <h3 className="flex items-center gap-2" style={{ marginBottom: 'var(--space-md)' }}>
          <Calendar size={20} className="text-brand" /> Upcoming (next {UPCOMING_WINDOW_DAYS} days)
        </h3>
        {isLoadingUpcoming ? (
          <div className="text-secondary" style={{ padding: 'var(--space-md)' }}>Loading upcoming jobs...</div>
        ) : Object.keys(groupedUpcoming).length === 0 ? (
          <div className="empty-state" style={{ padding: 'var(--space-md)' }}>
            <p className="text-secondary" style={{ margin: 0 }}>No jobs scheduled in this window.</p>
          </div>
        ) : (
          <div className="flex" style={{ flexDirection: 'column', gap: 'var(--space-md)' }}>
            {Object.entries(groupedUpcoming).map(([dateKey, jobsForDay]) => (
              <div key={dateKey}>
                <div className="text-secondary" style={{ fontSize: '0.9rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                  {formatDateKey(dateKey)}
                </div>
                <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
                  {jobsForDay.map((job) => (
                    <Link
                      key={job.id}
                      to={`/jobs/${job.id}`}
                      className="section-card card-hover"
                      style={{ marginBottom: 0, padding: 'var(--space-md)', minWidth: '220px', textDecoration: 'none', color: 'inherit' }}
                    >
                      <div className="flex justify-between items-start" style={{ marginBottom: '0.5rem' }}>
                        <strong style={{ fontSize: '1rem' }}>Job #{job.sequence}</strong>
                        <span className={`status-badge ${job.status.toLowerCase()}`}>{job.status.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="flex items-center gap-2 text-secondary" style={{ fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                        <Clock size={14} /> {new Date(job.scheduledDate).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className="flex items-start gap-2 text-secondary" style={{ fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                        <MapPin size={14} style={{ marginTop: '1px', flexShrink: 0 }} /> <span>{job.property?.address || 'No property'}</span>
                      </div>
                      <div className="flex items-center gap-2" style={{ fontSize: '0.85rem' }}>
                        <User size={14} className="text-muted" />
                        {job.assignedContractors && job.assignedContractors.length > 0
                          ? job.assignedContractors.map((c) => c.name).join(', ')
                          : <span className="text-muted">Unassigned</span>}
                      </div>
                    </Link>
                  ))}
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
        <div className="section-card flex items-center gap-4" style={{ marginBottom: 'var(--space-xl)', fontSize: '0.9rem' }}>
          <strong>Period total ({contractors.find(c => c.id === contractorId)?.name}):</strong>
          <span>{Number(periodSummary.totals.hours).toFixed(2)} hrs</span>
          {periodSummary.totals.labourCost !== undefined && <span>£{Number(periodSummary.totals.labourCost).toFixed(2)} labour</span>}
          <span>£{Number(periodSummary.totals.materialCost).toFixed(2)} materials</span>
          <span className="text-secondary">{periodSummary.totals.logCount} logs</span>
        </div>
      )}

      {error && <div className="page-error">{error}</div>}

      {isLoading ? <div className="text-secondary" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>Loading schedule...</div> : (
        <motion.div 
          className="flex" 
          style={{ flexDirection: 'column', gap: 'var(--space-xl)' }}
          variants={containerVariants}
          initial="hidden"
          animate="show"
        >
          {Object.entries(groupedLogs).map(([dateKey, contractorGroups]) => (
            <motion.div key={dateKey} variants={itemVariants}>
              <h3 className="flex items-center gap-2" style={{ borderBottom: '2px solid var(--color-border)', paddingBottom: 'var(--space-sm)', marginBottom: 'var(--space-md)', color: 'var(--color-brand)' }}>
                <Calendar size={20} /> {formatDateKey(dateKey)}
              </h3>
              
              <div className="flex" style={{ flexDirection: 'column', gap: 'var(--space-md)' }}>
                {Object.entries(contractorGroups).map(([contractorName, contractorLogs]) => (
                  <div key={contractorName} className="flex items-start gap-4 logistics-row" style={{ gap: 'var(--space-lg)' }}>
                    <div className="flex items-center gap-3 logistics-contractor" style={{ fontWeight: 500, padding: 'var(--space-sm) 0' }}>
                      <div className="flex items-center justify-center" style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-brand)' }}>
                        <User size={18} />
                      </div>
                      <span style={{ fontSize: '1rem', color: 'var(--color-text-primary)' }}>{contractorName}</span>
                    </div>
                    
                    <div className="flex gap-4 logistics-cards" style={{ overflowX: 'auto', paddingBottom: '0.5rem', flex: 1 }}>
                      {contractorLogs.map((log) => (
                        <motion.div 
                          key={log.id} 
                          onClick={() => setSelectedLog(log)}
                          whileHover={{ scale: 1.02, backgroundColor: 'var(--color-surface-hover)' }}
                          whileTap={{ scale: 0.98 }}
                          transition={{ type: 'spring', duration: 0.3 }}
                          className="section-card card-hover logistics-card"
                          style={{
                            marginBottom: 0,
                            cursor: 'pointer',
                            padding: 'var(--space-md)'
                          }}
                        >
                          <div className="flex justify-between items-start" style={{ marginBottom: '0.75rem' }}>
                            <strong style={{ fontSize: '1.0625rem', color: 'var(--color-text-primary)' }}>Job #{log.job?.sequence}</strong>
                            <span className={`status-badge ${log.job?.status.toLowerCase()}`}>
                              {log.job?.status.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <div className="flex items-start gap-2 text-secondary" style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                            <MapPin size={16} className="text-muted" style={{ marginTop: '1px', flexShrink: 0 }} /> 
                            <span>{log.job?.property?.address}</span>
                          </div>
                          <div className="flex items-center gap-2 font-medium" style={{ fontSize: '0.875rem', color: 'var(--color-brand)' }}>
                            <Clock size={16} /> {Number(log.hoursWorked).toFixed(2)} hrs logged
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
          
          {Object.keys(groupedLogs).length === 0 && (
            <div className="empty-state">
              <Calendar size={32} className="text-muted" style={{ marginBottom: 'var(--space-md)' }} />
              <p className="font-medium">No logistics data found.</p>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-4" style={{ marginTop: 'var(--space-lg)' }}>
              <motion.button className="button secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)} whileTap={{ scale: 0.97 }}>Previous</motion.button>
              <span className="font-medium text-secondary" style={{ fontSize: '0.9rem' }}>Page {page} of {totalPages}</span>
              <motion.button className="button secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} whileTap={{ scale: 0.97 }}>Next</motion.button>
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
              transition={{ duration: 0.2 }}
              className="slide-over-backdrop"
              onClick={() => {
                setIsPanelVisible(false);
                setTimeout(() => setSelectedLog(null), 250);
              }}
            />
            <motion.div 
              initial={{ x: '100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="slide-over-panel" 
              style={{ padding: 'var(--space-xl)', overflowY: 'auto' }}
            >
              <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-lg)' }}>
                <h3 className="flex items-center gap-2" style={{ margin: 0 }}>
                  <Briefcase size={22} className="text-primary" /> Context Dashboard
                </h3>
                <motion.button 
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    setIsPanelVisible(false);
                    setTimeout(() => setSelectedLog(null), 250);
                  }} 
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
                >
                  <X size={24} />
                </motion.button>
              </div>

              {/* Segmented Controls */}
              <div className="segment-control" style={{ width: '100%', marginBottom: 'var(--space-lg)', display: 'flex' }}>
                {(['details', 'jobHistory', 'contractorDay', 'comms'] as const).map(tab => (
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
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex" style={{ flexDirection: 'column', gap: 'var(--space-md)' }}>
                  <div className="section-card" style={{ marginBottom: 0 }}>
                    <div className="flex" style={{ flexDirection: 'column', gap: '0.5rem', marginBottom: 'var(--space-sm)' }}>
                      <div className="flex items-center gap-2"><Calendar size={16} className="text-muted"/> <strong>Date:</strong> {new Date(selectedLog.workDate).toLocaleDateString()}</div>
                      <div className="flex items-center gap-2"><User size={16} className="text-muted"/> <strong>Contractor:</strong> {selectedLog.contractor?.name}</div>
                    </div>
                    <h4 style={{ marginTop: 'var(--space-md)', marginBottom: 'var(--space-sm)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-md)' }}>Financials</h4>
                    <div className="form-grid-2">
                      <div><span className="text-muted" style={{fontSize:'0.8rem'}}>HOURS</span><br/><span style={{fontSize:'1.1rem', fontWeight:500}}>{Number(selectedLog.hoursWorked).toFixed(2)}</span></div>
                      {selectedLog.rateApplied !== undefined && (
                        <div><span className="text-muted" style={{fontSize:'0.8rem'}}>RATE</span><br/><span style={{fontSize:'1.1rem', fontWeight:500}}>£{Number(selectedLog.rateApplied).toFixed(2)}</span></div>
                      )}
                      <div><span className="text-muted" style={{fontSize:'0.8rem'}}>MATERIALS</span><br/><span style={{fontSize:'1.1rem', fontWeight:500}}>£{Number(selectedLog.materialCost || 0).toFixed(2)}</span></div>
                      {selectedLog.rateApplied !== undefined && (
                        <div><span className="text-muted" style={{fontSize:'0.8rem'}}>TOTAL COST</span><br/><span style={{fontSize:'1.1rem', fontWeight:500, color:'var(--color-brand)'}}>£{(Number(selectedLog.hoursWorked) * Number(selectedLog.rateApplied) + Number(selectedLog.materialCost || 0)).toFixed(2)}</span></div>
                      )}
                    </div>
                  </div>

                  <div className="section-card" style={{ marginBottom: 0 }}>
                    <h4 className="flex items-center gap-2"><FileText size={18} className="text-muted"/> Notes</h4>
                    <p style={{ whiteSpace: 'pre-wrap', backgroundColor: 'var(--color-bg)', padding: 'var(--space-md)', borderRadius: 'var(--radius-sm)', margin: 0, fontSize: '0.9rem' }}>
                      {selectedLog.notes || <em className="text-muted">No notes provided.</em>}
                    </p>
                  </div>

                  <div className="section-card" style={{ marginBottom: 0 }}>
                    <h4>Job Context (Job #{selectedLog.job?.sequence})</h4>
                    <div className="flex" style={{ flexDirection: 'column', gap: '0.5rem', fontSize: '0.9rem' }}>
                      <div className="flex items-center gap-2"><strong>Status:</strong> <span className={`status-badge ${selectedLog.job?.status.toLowerCase()}`}>{selectedLog.job?.status.replace(/_/g, ' ')}</span></div>
                      <div><strong>Description:</strong> {selectedLog.job?.description || <em className="text-muted">No description.</em>}</div>
                      <div className="flex items-start gap-2"><strong>Address:</strong> <MapPin size={14} className="text-muted" style={{marginTop:'2px', flexShrink: 0}}/> <span>{selectedLog.job?.property?.address}</span></div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Tab 2: Job History */}
              {activeTab === 'jobHistory' && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <h4 style={{ marginBottom: 'var(--space-md)' }}>Job #{selectedLog.job?.sequence} Timeline</h4>
                  {isContextLoading ? <p>Loading history...</p> : (
                    <div className="flex" style={{ flexDirection: 'column', gap: 'var(--space-md)' }}>
                      {jobHistoryLogs.map(log => (
                        <div key={log.id} className={`timeline-item ${log.id === selectedLog.id ? 'active' : ''}`} style={{ paddingBottom: 'var(--space-md)' }}>
                          <div className="text-muted" style={{ fontSize: '0.85rem', fontWeight: 500 }}>{new Date(log.workDate).toLocaleDateString()}</div>
                          <div className="font-medium" style={{ marginTop: '4px' }}>{log.contractor?.name}</div>
                          <div className="text-secondary" style={{ fontSize: '0.9rem' }}>{Number(log.hoursWorked).toFixed(2)} hours</div>
                          {log.notes && <div className="text-muted" style={{ fontSize: '0.85rem', marginTop: '4px', fontStyle: 'italic' }}>"{log.notes}"</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* Tab 3: Contractor's Day */}
              {activeTab === 'contractorDay' && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <h4 style={{ marginBottom: 'var(--space-md)' }}>{selectedLog.contractor?.name}'s Route on {new Date(selectedLog.workDate).toLocaleDateString()}</h4>
                  {isContextLoading ? <p>Loading contractor schedule...</p> : (
                    <div className="flex" style={{ flexDirection: 'column', gap: 'var(--space-md)' }}>
                      {contractorDayLogs.map(log => (
                        <div key={log.id} className={`timeline-item ${log.id === selectedLog.id ? 'active' : ''}`} style={{ paddingBottom: 'var(--space-md)' }}>
                          <div className="font-medium">Job #{log.job?.sequence}</div>
                          <div className="flex items-start gap-1 text-muted" style={{ fontSize: '0.85rem', margin: '4px 0' }}><MapPin size={12} style={{marginTop:'3px'}}/> {log.job?.property?.address}</div>
                          <div className="text-secondary" style={{ fontSize: '0.9rem' }}>{Number(log.hoursWorked).toFixed(2)} hours</div>
                          {log.notes && <div className="text-muted" style={{ fontSize: '0.85rem', marginTop: '4px', fontStyle: 'italic' }}>"{log.notes}"</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {/* Tab 4: Comms & Updates */}
              {activeTab === 'comms' && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex" style={{ flexDirection: 'column', height: '100%' }}>
                  <h4 style={{ marginBottom: 'var(--space-md)' }}>Updates & Communications</h4>
                  <div className="flex" style={{ flex: 1, overflowY: 'auto', flexDirection: 'column', gap: 'var(--space-md)', marginBottom: 'var(--space-md)', paddingRight: '4px' }}>
                    {isContextLoading ? <p>Loading updates...</p> : (
                      <>
                        {communicationLogs.map(log => (
                          <div key={log.id} className="section-card" style={{ marginBottom: 0 }}>
                            <div className="flex justify-between" style={{ marginBottom: '4px' }}>
                              <strong style={{ fontSize: '0.9rem' }}>{log.performedBy?.name}</strong>
                              <span className="text-muted" style={{ fontSize: '0.8rem' }}>{new Date(log.loggedAt).toLocaleString()}</span>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--color-brand)', marginBottom: '8px', fontWeight: 500 }}>
                              {log.direction === 'INTERNAL' ? 'INTERNAL UPDATE' : `${log.direction.replace('_', ' ')} (${log.method})`}
                            </div>
                            <div style={{ fontSize: '0.95rem' }}>{log.notes || <em className="text-muted">No notes.</em>}</div>
                          </div>
                        ))}
                        {communicationLogs.length === 0 && <p className="text-muted" style={{ fontStyle: 'italic' }}>No communication logs or updates found.</p>}
                      </>
                    )}
                  </div>
                  
                  <form onSubmit={handleCommSubmit} className="flex form-section" style={{ marginTop: 'auto', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-md)' }}>
                    <textarea 
                      placeholder="Type an internal update..."
                      value={newCommNotes}
                      onChange={e => setNewCommNotes(e.target.value)}
                      style={{ width: '100%', resize: 'none', height: '80px', fontSize: '0.9rem' }}
                      required
                    />
                    <div className="form-actions" style={{ borderTop: 'none', paddingTop: 0, marginTop: 0 }}>
                      <motion.button 
                        type="submit" 
                        className="button primary" 
                        disabled={isCommSubmitting || !newCommNotes.trim()}
                        whileTap={{ scale: 0.97 }}
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
