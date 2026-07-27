import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import { debounce, mergeById, type FetchOptions } from '../utils/refetch';
import type { Client } from './ClientList';
import type { Property } from './PropertyList';
import { useAuth } from '../contexts/AuthContext';
import { useReminders } from '../contexts/ReminderContext';
import { Search, MapPin, User, ExternalLink, Plus, BriefcaseBusiness, Calendar, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { useToast } from '../contexts/ToastContext';

export interface Job {
  id: string;
  sequence: number;
  status: 'TO_BE_CHECKED' | 'CHECKED' | 'QUOTED' | 'AUTHORISED' | 'PENDING_INVOICE' | 'COMPLETED' | 'CANCELLED';
  clientId: string;
  propertyId: string;
  tenantId?: string | null;
  description: string | null;
  materials: string | null;
  quotedValue: number | null;
  tenantSnapshotName: string | null;
  tenantSnapshotPhone: string | null;
  version: number;
  createdAt: string;
  client?: Client;
  property?: Property;
  tenant?: { id: string; name: string; phone: string | null; email: string | null } | null;
  assignedContractors?: { id: string; name: string }[];
  scheduledDate?: string | null;
  updatedAt?: string;
}

type JobTab = 'active' | 'completed' | 'cancelled' | 'archived';

export function JobList() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const { socket, can } = useAuth();
  const { byJobId } = useReminders();
  const { showToast } = useToast();
  const [listAnimated, setListAnimated] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<Job | null>(null);

  const [activeTab, setActiveTab] = useState<JobTab>('active');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadJobs = useCallback(async (options?: FetchOptions) => {
    const background = options?.background ?? false;
    if (!background) {
      setIsLoading(true);
    }
    try {
      const params = new URLSearchParams();
      params.append('tab', activeTab);
      if (statusFilter) params.append('status', statusFilter);
      if (debouncedSearch) params.append('search', debouncedSearch);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);
      params.append('page', page.toString());

      const response = await apiFetch(`/jobs?${params.toString()}`);
      const nextJobs: Job[] = response.data || [];
      if (background) {
        setJobs((prev) => mergeById(prev, nextJobs));
      } else {
        setJobs(nextJobs);
      }
      if (response.meta) {
        setTotalPages(response.meta.totalPages || 1);
      }
      setListAnimated(true);
    } catch (err: any) {
      if (!background) {
        setError('Failed to load jobs: ' + err.message);
      }
    } finally {
      if (!background) {
        setIsLoading(false);
      }
    }
  }, [activeTab, statusFilter, debouncedSearch, startDate, endDate, page]);

  const loadJobsRef = useRef(loadJobs);
  loadJobsRef.current = loadJobs;

  const debouncedBackgroundLoad = useMemo(
    () => debounce(() => loadJobsRef.current({ background: true }), 300),
    []
  );

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    if (!socket) return;

    const handleStatusChanged = (payload: { jobId: string; status: Job['status']; version: number }) => {
      setJobs((prev) => {
        const patched = prev.map((j) =>
          j.id === payload.jobId
            ? { ...j, status: payload.status, version: payload.version }
            : j
        );
        // Archived is keyed on deletedAt, not status — nothing to evict here.
        if (activeTab === 'archived') return patched;
        const stillMatches = (status: Job['status']) => {
          if (activeTab === 'completed') return status === 'COMPLETED';
          if (activeTab === 'cancelled') return status === 'CANCELLED';
          return status !== 'COMPLETED' && status !== 'CANCELLED';
        };
        return patched.filter((j) => j.id !== payload.jobId || stillMatches(j.status));
      });
      // A job that just transitioned INTO this tab (e.g. another job reaching
      // COMPLETED while this tab is open) isn't in `prev` to patch — pick it
      // up on the next background refresh.
      debouncedBackgroundLoad();
    };

    const handleJobCreated = () => debouncedBackgroundLoad();

    const handleJobDeleted = (payload: { jobId: string }) => {
      setJobs((prev) => prev.filter((j) => j.id !== payload.jobId));
      // A job just landed in Archived — refresh so it shows up there.
      if (activeTab === 'archived') debouncedBackgroundLoad();
    };

    socket.on('job:statusChanged', handleStatusChanged);
    socket.on('job:created', handleJobCreated);
    socket.on('job:deleted', handleJobDeleted);
    return () => {
      socket.off('job:statusChanged', handleStatusChanged);
      socket.off('job:created', handleJobCreated);
      socket.off('job:deleted', handleJobDeleted);
    };
  }, [socket, debouncedBackgroundLoad, activeTab]);

  const handleRestore = async (jobId: string) => {
    setConfirmRestore(null);
    setRestoringId(jobId);
    try {
      await apiFetch(`/jobs/${jobId}/restore`, { method: 'PATCH' });
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
      showToast('Job restored', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to restore job', 'error');
    } finally {
      setRestoringId(null);
    }
  };

  const listContainer: any = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.05 }
    }
  };

  const listItem: any = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', duration: 0.4, bounce: 0 } }
  };

  const showInitialLoading = isLoading && jobs.length === 0;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      <div className="page-header">
        <div className="page-header-title">
          <h1 className="flex items-center gap-3">
            <BriefcaseBusiness size={28} className="text-brand" style={{ color: 'var(--color-brand)' }} />
            Jobs
          </h1>
          <p className="text-secondary" style={{ fontSize: '1.0625rem' }}>View and manage maintenance jobs.</p>
        </div>

        <Link to="/jobs/new" style={{ textDecoration: 'none' }}>
          <motion.button
            className="button primary"
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", duration: 0.4, bounce: 0.2 }}
          >
            <Plus size={18} /> Create Job
          </motion.button>
        </Link>
      </div>

      {error && <div className="page-error">{error}</div>}

      <div className="segment-control" style={{ marginBottom: 'var(--space-md)' }}>
        {(['active', 'completed', 'cancelled', 'archived'] as const)
          .filter((tab) => tab !== 'archived' || can('jobs:delete'))
          .map((tab) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? 'active' : ''}
              onClick={() => { setActiveTab(tab); setPage(1); }}
            >
              {tab === 'active' ? 'Active' : tab === 'completed' ? 'Completed' : tab === 'cancelled' ? 'Not Proceeding' : 'Archived'}
            </button>
          ))}
      </div>

      <div className="filter-bar">
        <div className="search-input-wrapper">
          <Search size={18} />
          <input
            type="text"
            className="search-input"
            placeholder="Search by Job #, Address, or Client..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-muted" />
          <label className="form-label" style={{ margin: 0 }}>From:</label>
          <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(1); }} />
        </div>
        <div className="flex items-center gap-2">
          <label className="form-label" style={{ margin: 0 }}>To:</label>
          <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(1); }} />
        </div>
        {activeTab === 'active' && (
          <div className="flex items-center gap-2">
            <label className="form-label" style={{ margin: 0 }}>Filter by Status:</label>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={{ minWidth: '160px' }}>
              <option value="">All Statuses</option>
              <option value="TO_BE_CHECKED">To Be Checked</option>
              <option value="CHECKED">Checked</option>
              <option value="QUOTED">Quoted</option>
              <option value="AUTHORISED">Authorised</option>
              <option value="PENDING_INVOICE">Pending Invoice</option>
            </select>
          </div>
        )}
      </div>

      {showInitialLoading ? (
        <div className="text-secondary" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>Loading jobs...</div>
      ) : (
        <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="list-header list-cols-jobs">
            <div>Job #</div>
            <div>Status</div>
            <div>Address</div>
            <div>Client</div>
            <div>Date Created</div>
            <div style={{ textAlign: 'right' }}>Action</div>
          </div>

          <motion.ul
            variants={listContainer}
            initial={listAnimated ? false : 'hidden'}
            animate="show"
            style={{ listStyle: 'none', padding: 0, margin: 0 }}
          >
            {jobs.length > 0 ? (
              jobs.map((j) => (
                <motion.li
                  key={j.id}
                  variants={listItem}
                  className="list-row list-cols-jobs"
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <div className="tabular-nums" data-label="Job #">
                    {activeTab === 'archived' ? (
                      <span className="font-medium" style={{ fontSize: '1rem' }}>#{j.sequence}</span>
                    ) : (
                      <Link to={`/jobs/${j.id}`} className="font-medium" style={{ fontSize: '1rem' }}>
                        #{j.sequence}
                      </Link>
                    )}
                  </div>
                  <div data-label="Status" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className={`status-badge ${j.status.toLowerCase()}`}>
                      {j.status.replace(/_/g, ' ')}
                    </span>
                    {byJobId[j.id] && byJobId[j.id].length > 0 && (() => {
                      const isOverdue = byJobId[j.id].some(r => new Date(r.dueAt) < new Date());
                      return (
                        <span style={{
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          padding: '2px 7px',
                          borderRadius: 6,
                          backgroundColor: isOverdue ? 'var(--color-error)' : 'var(--color-warning)',
                          color: '#fff',
                          display: 'inline-block',
                        }}>
                          {isOverdue ? '⚠ Follow-up overdue' : '🔔 Follow-up due'}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-2" data-label="Address" style={{ color: 'var(--color-text-primary)', fontSize: '0.9375rem' }}>
                    <MapPin size={16} className="text-muted" />
                    {j.property?.address || `Property #${j.propertyId.toString().substring(0, 8)}`}
                  </div>
                  <div className="flex items-center gap-2 text-secondary" data-label="Client" style={{ fontSize: '0.9375rem' }}>
                    <User size={16} className="text-muted" />
                    {j.client?.name || `Client #${j.clientId.toString().substring(0, 8)}`}
                  </div>
                  <div className="tabular-nums text-muted" data-label="Date Created" style={{ fontSize: '0.875rem' }}>
                    {new Date(j.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </div>
                  <div className="list-cell-action" style={{ textAlign: 'right' }}>
                    {activeTab === 'archived' ? (
                      <motion.button
                        className="button secondary small"
                        whileTap={{ scale: 0.95 }}
                        transition={{ type: "spring", duration: 0.3 }}
                        disabled={restoringId === j.id}
                        onClick={() => setConfirmRestore(j)}
                      >
                        <RotateCcw size={14} /> {restoringId === j.id ? 'Restoring...' : 'Restore'}
                      </motion.button>
                    ) : (
                      <Link to={`/jobs/${j.id}`} style={{ textDecoration: 'none' }}>
                        <motion.button
                          className="button secondary small"
                          whileTap={{ scale: 0.95 }}
                          transition={{ type: "spring", duration: 0.3 }}
                        >
                          Open <ExternalLink size={14} />
                        </motion.button>
                      </Link>
                    )}
                  </div>
                </motion.li>
              ))
            ) : (
              <motion.li variants={listItem} style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
                <div className="empty-state" style={{ border: 'none', padding: 0 }}>
                  <div style={{ padding: '1rem', backgroundColor: 'var(--color-bg)', borderRadius: '50%', marginBottom: 'var(--space-md)' }}>
                    <BriefcaseBusiness size={32} className="text-muted" />
                  </div>
                  <p className="font-medium text-primary" style={{ fontSize: '1.125rem', margin: '0 0 var(--space-xs) 0' }}>No jobs found</p>
                  <p className="text-secondary" style={{ margin: 0, fontSize: '0.9375rem' }}>
                    {searchQuery || statusFilter || startDate || endDate ? "Try adjusting your filters." : "Create a job to get started."}
                  </p>
                </div>
              </motion.li>
            )}
          </motion.ul>

          {totalPages > 1 && (
            <div className="flex items-center justify-between" style={{ padding: 'var(--space-md) var(--space-xl)', borderTop: '1px solid var(--color-border)' }}>
              <motion.button
                className="button secondary"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                whileTap={{ scale: 0.97 }}
              >
                Previous
              </motion.button>
              <span className="text-secondary" style={{ fontSize: '0.875rem' }}>Page {page} of {totalPages}</span>
              <motion.button
                className="button secondary"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
                whileTap={{ scale: 0.97 }}
              >
                Next
              </motion.button>
            </div>
          )}
        </div>
      )}

      {confirmRestore && (
        <div className="modal-backdrop entering" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-panel entering section-card" style={{ width: '400px', maxWidth: '90vw' }}>
            <h3 style={{ margin: '0 0 var(--space-sm) 0', fontSize: '1rem' }}>Restore Job?</h3>
            <p className="text-secondary" style={{ margin: '0 0 var(--space-md) 0', fontSize: '0.85rem', lineHeight: '1.4' }}>
              This moves job #{confirmRestore.sequence} out of Archived and back to the {destinationTabLabel(confirmRestore.status)} tab.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmRestore(null)} className="button secondary" disabled={restoringId === confirmRestore.id}>Cancel</button>
              <button onClick={() => handleRestore(confirmRestore.id)} className="button primary" disabled={restoringId === confirmRestore.id}>
                {restoringId === confirmRestore.id ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function destinationTabLabel(status: Job['status']): string {
  if (status === 'COMPLETED') return 'Completed';
  if (status === 'CANCELLED') return 'Not Proceeding';
  return 'Active';
}
