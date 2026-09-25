import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import { Users, Briefcase, TrendingUp, Building2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import { debounce } from '../utils/refetch';
import { useAuth } from '../contexts/AuthContext';
import type { JobCounts } from './JobList';

interface DailyTasks {
  jobsScheduledToday: Array<{
    id: string;
    sequence: number;
    status: string;
    property?: { address?: string };
  }>;
  actionRequired: {
    toBeChecked: Array<{
      id: string;
      sequence: number;
      status: string;
      property?: { address?: string };
    }>;
  };
}

interface WorkLog {
  id: string;
  hoursWorked: number;
  createdAt: string;
  contractor?: { name?: string };
  job?: { id?: string; sequence?: number };
}

const DAILY_TASKS_ROLES = new Set(['PM', 'ADMIN', 'OWNER', 'SUPER_ADMIN']);

const PIPELINE_STATUSES = [
  'TO_BE_CHECKED',
  'CHECKED',
  'QUOTED',
  'AUTHORISED',
  'PENDING_INVOICE',
  'COMPLETED',
  'CANCELLED',
] as const;

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Dashboard() {
  const { user, socket } = useAuth();
  const canViewDailyTasks = user?.role ? DAILY_TASKS_ROLES.has(user.role) : false;

  const [stats, setStats] = useState({
    jobsCount: 0,
    clientsCount: 0,
    propertiesCount: 0,
    activeJobsCount: 0,
  });
  const [recentLogs, setRecentLogs] = useState<WorkLog[]>([]);
  const [dailyTasks, setDailyTasks] = useState<DailyTasks | null>(null);
  const [counts, setCounts] = useState<JobCounts | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const fetches: Promise<unknown>[] = [
          apiFetch('/jobs/counts'),
          apiFetch('/clients?limit=50'),
          apiFetch('/properties?limit=50'),
          apiFetch('/work-logs?limit=8'),
        ];

        if (canViewDailyTasks) {
          fetches.push(apiFetch('/dashboard/daily-tasks'));
        }

        const results = await Promise.all(fetches);
        const [countsRes, clientsRes, propsRes, logsRes, tasksRes] = results as [
          JobCounts,
          { data?: unknown[] },
          { data?: unknown[] },
          { data?: WorkLog[] },
          DailyTasks?,
        ];

        setCounts(countsRes);
        setStats({
          jobsCount:
            countsRes.byTab.active + countsRes.byTab.completed + countsRes.byTab.cancelled,
          activeJobsCount: countsRes.byTab.active,
          clientsCount: (clientsRes.data || []).length,
          propertiesCount: (propsRes.data || []).length,
        });

        setRecentLogs(logsRes.data || []);

        if (canViewDailyTasks && tasksRes) {
          setDailyTasks(tasksRes);
        }
      } catch (err) {
        console.error('Failed to load dashboard data', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [canViewDailyTasks]);

  // Background refresh of pipeline bars / flow deltas / stalled note when any
  // job changes elsewhere — never touches isLoading (no loading swap per AGENTS.md).
  const refreshCounts = useCallback(async () => {
    try {
      const res: JobCounts = await apiFetch('/jobs/counts');
      setCounts(res);
      setStats((prev) => ({
        ...prev,
        jobsCount: res.byTab.active + res.byTab.completed + res.byTab.cancelled,
        activeJobsCount: res.byTab.active,
      }));
    } catch {
      // Counts are progressive enhancement — keep the last good payload.
    }
  }, []);

  const debouncedCountsRefresh = useMemo(
    () => debounce(() => refreshCounts(), 300),
    [refreshCounts]
  );

  useEffect(() => {
    if (!socket) return;
    const handleJobChange = () => debouncedCountsRefresh();
    socket.on('job:statusChanged', handleJobChange);
    socket.on('job:created', handleJobChange);
    socket.on('job:deleted', handleJobChange);
    return () => {
      socket.off('job:statusChanged', handleJobChange);
      socket.off('job:created', handleJobChange);
      socket.off('job:deleted', handleJobChange);
    };
  }, [socket, debouncedCountsRefresh]);

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.08 },
    },
  };

  const item = {
    hidden: { opacity: 0, y: 15 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: 'spring' as const, bounce: 0, duration: 0.6 },
    },
  };

  const scheduledToday = dailyTasks?.jobsScheduledToday ?? [];
  const needsAttention = dailyTasks?.actionRequired?.toBeChecked ?? [];

  const pipelineMax = counts
    ? Math.max(...Object.values(counts.byStatus), 1)
    : 1;
  const stalledTotal = counts
    ? Object.values(counts.stalled).reduce((sum, n) => sum + n, 0)
    : 0;

  return (
    <motion.div
      className="dashboard-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <div className="page-header">
        <div className="page-header-title">
          <h1 className="dashboard-page-title">Dashboard Overview</h1>
          <p className="text-secondary dashboard-page-subtitle">
            Welcome back. Here is what needs your attention today.
          </p>
        </div>
        <Link to="/jobs/new" style={{ textDecoration: 'none' }}>
          <motion.button
            className="button primary dashboard-create-btn"
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', duration: 0.4, bounce: 0.3 }}
          >
            + Create New Job
          </motion.button>
        </Link>
      </div>

      <motion.div variants={container} initial="hidden" animate="show" className="dashboard-page">
        <div className="stat-grid">
          <motion.div variants={item} className="section-card stat-card">
            <div className="stat-card-header">
              <div className="stat-card-icon">
                <TrendingUp size={18} color="var(--color-brand)" />
              </div>
              <span className="font-medium">Total Jobs</span>
            </div>
            <div className="stat-card-value">{isLoading ? '-' : stats.jobsCount}</div>
          </motion.div>

          <motion.div variants={item} className="section-card stat-card">
            <div className="stat-card-header">
              <div className="stat-card-icon">
                <Briefcase size={18} color="var(--color-brand)" />
              </div>
              <span className="font-medium">Active Jobs</span>
            </div>
            <div className="stat-card-value">{isLoading ? '-' : stats.activeJobsCount}</div>
            {!isLoading && stats.activeJobsCount > 0 && (
              <span className="stat-card-badge">Ongoing</span>
            )}
          </motion.div>

          <motion.div variants={item} className="section-card stat-card">
            <div className="stat-card-header">
              <div className="stat-card-icon">
                <Users size={18} color="var(--color-brand)" />
              </div>
              <span className="font-medium">Clients</span>
            </div>
            <div className="stat-card-value">{isLoading ? '-' : stats.clientsCount}</div>
          </motion.div>

          <motion.div variants={item} className="section-card stat-card">
            <div className="stat-card-header">
              <div className="stat-card-icon">
                <Building2 size={18} color="var(--color-brand)" />
              </div>
              <span className="font-medium">Properties</span>
            </div>
            <div className="stat-card-value">{isLoading ? '-' : stats.propertiesCount}</div>
          </motion.div>
        </div>

        {counts && (
          <motion.div variants={item} className="section-card pipeline-panel">
            <div className="dashboard-panel-header">
              <h3 className="dashboard-panel-title">Job Pipeline</h3>
              <Link to="/jobs">
                <button type="button" className="button secondary small">View all jobs</button>
              </Link>
            </div>

            <div className="pipeline-rows">
              {PIPELINE_STATUSES.map((status) => {
                const count = counts.byStatus[status];
                const flow = counts.flow7d[status];
                return (
                  <div key={status} className={`pipeline-row ${status.toLowerCase()}`}>
                    <span className="pipeline-label">{formatStatus(status)}</span>
                    <div
                      className="pipeline-track"
                      role="presentation"
                    >
                      <div
                        className="pipeline-bar"
                        style={{ width: `${Math.round((count / pipelineMax) * 100)}%` }}
                      />
                    </div>
                    <span className="pipeline-count tabular-nums">{count}</span>
                    <span className="pipeline-delta">
                      {flow > 0 ? `↑${flow} this week` : ''}
                    </span>
                  </div>
                );
              })}
            </div>

            {stalledTotal > 0 && (
              <p className="pipeline-stalled-note">
                {stalledTotal} {stalledTotal === 1 ? 'job has' : 'jobs have'} been untouched
                for {counts.stalledDays}+ days.{' '}
                <Link to="/jobs">Review stalled jobs</Link>
              </p>
            )}
          </motion.div>
        )}

        {canViewDailyTasks && (
          <div className="dashboard-bento">
            <motion.div variants={item} className="section-card dashboard-panel">
              <div className="dashboard-panel-header">
                <h3 className="dashboard-panel-title">Today&apos;s Schedule</h3>
              </div>
              <div className="dashboard-list">
                {isLoading ? (
                  <p className="dashboard-empty">Loading...</p>
                ) : scheduledToday.length === 0 ? (
                  <p className="dashboard-empty">No jobs scheduled today.</p>
                ) : (
                  scheduledToday.map((job) => (
                    <Link key={job.id} to={`/jobs/${job.id}`} className="dashboard-list-item">
                      <div className="dashboard-list-item-main">
                        <p className="dashboard-list-item-title">Job #{job.sequence}</p>
                        <p className="dashboard-list-item-meta">
                          {job.property?.address || 'No address'} · {formatStatus(job.status)}
                        </p>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </motion.div>

            <motion.div variants={item} className="section-card dashboard-panel">
              <div className="dashboard-panel-header">
                <h3 className="dashboard-panel-title">Needs Attention</h3>
              </div>
              <div className="dashboard-list">
                {isLoading ? (
                  <p className="dashboard-empty">Loading...</p>
                ) : needsAttention.length === 0 ? (
                  <p className="dashboard-empty">All caught up — no jobs awaiting review.</p>
                ) : (
                  needsAttention.map((job) => (
                    <Link key={job.id} to={`/jobs/${job.id}`} className="dashboard-list-item">
                      <div className="dashboard-list-item-main">
                        <p className="dashboard-list-item-title">Job #{job.sequence}</p>
                        <p className="dashboard-list-item-meta">
                          {job.property?.address || 'No address'} · To be checked
                        </p>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}

        <motion.div variants={item} className="section-card dashboard-panel">
          <div className="dashboard-panel-header">
            <h3 className="dashboard-panel-title">Recent Activity</h3>
            <Link to="/logistics">
              <button type="button" className="button secondary small">View All</button>
            </Link>
          </div>

          <div className="activity-list">
            {isLoading ? (
              <p className="dashboard-empty">Loading...</p>
            ) : recentLogs.length === 0 ? (
              <p className="dashboard-empty">No recent activity.</p>
            ) : (
              recentLogs.map((log) => (
                <Link
                  key={log.id}
                  to={log.job?.id ? `/jobs/${log.job.id}` : '/logistics'}
                  className="activity-row"
                >
                  <div className="activity-avatar">
                    {log.contractor?.name ? log.contractor.name[0].toUpperCase() : 'U'}
                  </div>
                  <div className="activity-row-body">
                    <p className="activity-row-title">{log.contractor?.name || 'Unknown User'}</p>
                    <p className="activity-row-sub">
                      Logged {log.hoursWorked} hrs on Job #{log.job?.sequence ?? '—'}
                    </p>
                  </div>
                  <span className="activity-row-date">
                    {new Date(log.createdAt).toLocaleDateString()}
                  </span>
                </Link>
              ))
            )}
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
