import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Users, Briefcase, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';

export function Dashboard() {
  const [stats, setStats] = useState({
    jobsCount: 0,
    clientsCount: 0,
    propertiesCount: 0,
    activeJobsCount: 0
  });
  const [recentLogs, setRecentLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [jobsRes, clientsRes, propsRes, logsRes] = await Promise.all([
          apiFetch('/jobs?limit=50'),
          apiFetch('/clients?limit=50'),
          apiFetch('/properties?limit=50'),
          apiFetch('/work-logs?limit=5')
        ]);
        
        const jobs = jobsRes.data || [];
        const activeJobs = jobs.filter((j: any) => j.status !== 'COMPLETED' && j.status !== 'CANCELLED');
        
        setStats({
          jobsCount: jobs.length,
          activeJobsCount: activeJobs.length,
          clientsCount: (clientsRes.data || []).length,
          propertiesCount: (propsRes.data || []).length,
        });
        
        setRecentLogs(logsRes.data || []);
      } catch (err) {
        console.error('Failed to load dashboard data', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  const container: any = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.08 }
    }
  };

  const item: any = {
    hidden: { opacity: 0, y: 15 },
    show: { 
      opacity: 1, 
      y: 0,
      transition: {
        type: 'spring',
        bounce: 0,
        duration: 0.6
      }
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <div className="page-header-title">
          <h1 className="flex items-center gap-3" style={{ fontSize: '2rem' }}>
            Dashboard Overview
          </h1>
          <p className="text-secondary" style={{ fontSize: '1rem', marginTop: '0.25rem' }}>Welcome back. Let's dive into your workspace.</p>
        </div>
        <Link to="/jobs/new" style={{ textDecoration: 'none' }}>
          <motion.button 
            className="button primary"
            whileTap={{ scale: 0.95 }}
            transition={{ type: "spring", duration: 0.4, bounce: 0.3 }}
            style={{ padding: '0.85rem 1.5rem', fontSize: '1rem', borderRadius: 'var(--radius-pill)' }}
          >
            + Create New Job
          </motion.button>
        </Link>
      </div>

      <motion.div 
        variants={container}
        initial="hidden"
        animate="show"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem'
        }}
      >
        {/* Top Stats Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.5rem' }}>
          
          <motion.div variants={item} className="section-card" style={{ marginBottom: 0, padding: '1.5rem' }}>
            <div className="flex items-center gap-3 text-secondary" style={{ marginBottom: '1rem' }}>
              <div style={{ padding: '8px', backgroundColor: 'var(--color-surface)', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                <TrendingUp size={18} color="var(--color-brand)" />
              </div>
              <span className="font-medium">Total Jobs</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--color-text-primary)' }}>{isLoading ? '-' : stats.jobsCount}</span>
            </div>
          </motion.div>

          <motion.div variants={item} className="section-card" style={{ marginBottom: 0, padding: '1.5rem' }}>
            <div className="flex items-center gap-3 text-secondary" style={{ marginBottom: '1rem' }}>
              <div style={{ padding: '8px', backgroundColor: 'var(--color-surface)', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                <Briefcase size={18} color="var(--color-brand)" />
              </div>
              <span className="font-medium">Active Jobs</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--color-text-primary)' }}>{isLoading ? '-' : stats.activeJobsCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--color-brand)', backgroundColor: 'rgba(163, 230, 53, 0.1)', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                Ongoing
              </span>
            </div>
          </motion.div>

          <motion.div variants={item} className="section-card" style={{ marginBottom: 0, padding: '1.5rem' }}>
            <div className="flex items-center gap-3 text-secondary" style={{ marginBottom: '1rem' }}>
              <div style={{ padding: '8px', backgroundColor: 'var(--color-surface)', borderRadius: '12px', border: '1px solid var(--color-border)' }}>
                <Users size={18} color="var(--color-brand)" />
              </div>
              <span className="font-medium">Clients</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--color-text-primary)' }}>{isLoading ? '-' : stats.clientsCount}</span>
            </div>
          </motion.div>
        </div>

        {/* Bottom Leads/Recent Activity Row */}
        <motion.div variants={item} className="section-card" style={{ marginBottom: 0, padding: '1.5rem' }}>
          <div className="flex justify-between items-center" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', margin: 0 }}>Recent Activity</h3>
            <Link to="/logistics">
              <button className="button secondary small" style={{ borderRadius: '8px' }}>View All</button>
            </Link>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {isLoading ? (
              <p className="text-secondary">Loading...</p>
            ) : recentLogs.length === 0 ? (
              <p className="text-secondary">No recent activity.</p>
            ) : (
              recentLogs.map((log: any) => (
                <motion.div 
                  key={log.id}
                  whileHover={{ scale: 1.02, backgroundColor: 'var(--color-surface-hover)' }}
                  className="flex items-center gap-3" 
                  style={{ padding: '1rem', backgroundColor: 'var(--color-surface)', borderRadius: '16px', border: '1px solid var(--color-border)', cursor: 'pointer' }}
                >
                  {/* Avatar Placeholder */}
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: `var(--color-brand)`, color: 'var(--color-brand-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0, fontSize: '0.9rem' }}>
                    {log.contractor?.name ? log.contractor.name[0].toUpperCase() : 'U'}
                  </div>
                  <div style={{ overflow: 'hidden' }}>
                    <h4 style={{ fontSize: '0.9rem', margin: 0, color: 'var(--color-text-primary)' }}>{log.contractor?.name || 'Unknown User'}</h4>
                    <p className="text-muted" style={{ fontSize: '0.8rem', margin: '2px 0 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      Logged {log.hoursWorked} hrs on Job #{log.job?.sequence}
                    </p>
                    <p className="text-muted" style={{ fontSize: '0.7rem', margin: '2px 0 0 0', opacity: 0.7 }}>
                      {new Date(log.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </motion.div>

      </motion.div>
    </motion.div>
  );
}
