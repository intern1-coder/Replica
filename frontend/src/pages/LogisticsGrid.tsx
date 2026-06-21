import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../utils/api';
import { Calendar, Clock, MapPin, User, X, Briefcase, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface WorkLog {
  id: string;
  jobId: string;
  contractorId: string;
  workDate: string;
  hoursWorked: string | number;
  rateApplied: string | number;
  materialCost: string | number | null;
  notes: string | null;
  createdAt: string;
  contractor?: { id: string; name: string };
  loggedBy?: { id: string; name: string };
  job?: { id: string; sequence: number; status: string; description: string | null; property: { address: string; accessNotes: string | null } };
}

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

  const today = new Date();
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const [startDate, setStartDate] = useState(lastWeek.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0]);
  const [contractorId, setContractorId] = useState('');
  
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isPanelVisible, setIsPanelVisible] = useState(false);

  useEffect(() => {
    apiFetch('/users?role=CONTRACTOR')
      .then(res => setContractors(res))
      .catch(console.error);
  }, []);

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

  const groupedLogs = useMemo(() => {
    const groups: Record<string, Record<string, WorkLog[]>> = {};
    const sorted = [...logs].sort((a, b) => new Date(b.workDate).getTime() - new Date(a.workDate).getTime());
    
    sorted.forEach(log => {
      const dateStr = new Date(log.workDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      const contractorName = log.contractor?.name || 'Unassigned';
      
      if (!groups[dateStr]) groups[dateStr] = {};
      if (!groups[dateStr][contractorName]) groups[dateStr][contractorName] = [];
      groups[dateStr][contractorName].push(log);
    });
    return groups;
  }, [logs]);

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
          <p className="text-secondary" style={{ fontSize: '1.0625rem' }}>Schedule and tracking for contractors.</p>
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

      {error && <div className="page-error">{error}</div>}
      
      {isLoading ? <div className="text-secondary" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>Loading schedule...</div> : (
        <motion.div 
          className="flex" 
          style={{ flexDirection: 'column', gap: 'var(--space-xl)' }}
          variants={containerVariants}
          initial="hidden"
          animate="show"
        >
          {Object.entries(groupedLogs).map(([dateStr, contractorGroups]) => (
            <motion.div key={dateStr} variants={itemVariants}>
              <h3 className="flex items-center gap-2" style={{ borderBottom: '2px solid var(--color-border)', paddingBottom: 'var(--space-sm)', marginBottom: 'var(--space-md)', color: 'var(--color-brand)' }}>
                <Calendar size={20} /> {dateStr}
              </h3>
              
              <div className="flex" style={{ flexDirection: 'column', gap: 'var(--space-md)' }}>
                {Object.entries(contractorGroups).map(([contractorName, contractorLogs]) => (
                  <div key={contractorName} className="flex items-start gap-4" style={{ gap: 'var(--space-lg)' }}>
                    <div className="flex items-center gap-3" style={{ width: '200px', flexShrink: 0, fontWeight: 500, padding: 'var(--space-sm) 0' }}>
                      <div className="flex items-center justify-center" style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-brand)' }}>
                        <User size={18} />
                      </div>
                      <span style={{ fontSize: '1rem', color: 'var(--color-text-primary)' }}>{contractorName}</span>
                    </div>
                    
                    <div className="flex gap-4" style={{ overflowX: 'auto', paddingBottom: '0.5rem', flex: 1 }}>
                      {contractorLogs.map((log) => (
                        <motion.div 
                          key={log.id} 
                          onClick={() => setSelectedLog(log)}
                          whileHover={{ scale: 1.02, backgroundColor: 'var(--color-surface-hover)' }}
                          whileTap={{ scale: 0.98 }}
                          transition={{ type: 'spring', duration: 0.3 }}
                          className="section-card card-hover"
                          style={{ 
                            minWidth: '280px', 
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
                            <Clock size={16} /> {Number(log.hoursWorked).toFixed(2)} hrs scheduled
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
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
                      <div><span className="text-muted" style={{fontSize:'0.8rem'}}>HOURS</span><br/><span style={{fontSize:'1.1rem', fontWeight:500}}>{Number(selectedLog.hoursWorked).toFixed(2)}</span></div>
                      <div><span className="text-muted" style={{fontSize:'0.8rem'}}>RATE</span><br/><span style={{fontSize:'1.1rem', fontWeight:500}}>${Number(selectedLog.rateApplied).toFixed(2)}</span></div>
                      <div><span className="text-muted" style={{fontSize:'0.8rem'}}>MATERIAL</span><br/><span style={{fontSize:'1.1rem', fontWeight:500}}>${Number(selectedLog.materialCost || 0).toFixed(2)}</span></div>
                      <div><span className="text-muted" style={{fontSize:'0.8rem'}}>TOTAL</span><br/><span style={{fontSize:'1.1rem', fontWeight:500, color:'var(--color-brand)'}}>${(Number(selectedLog.hoursWorked) * Number(selectedLog.rateApplied) + Number(selectedLog.materialCost || 0)).toFixed(2)}</span></div>
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
