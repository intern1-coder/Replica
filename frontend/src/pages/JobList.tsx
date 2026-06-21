import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import type { Client } from './ClientList';
import type { Property } from './PropertyList';
import { useAuth } from '../contexts/AuthContext';
import { Search, MapPin, User, ExternalLink, Plus, BriefcaseBusiness } from 'lucide-react';
import { motion } from 'motion/react';

export interface Job {
  id: string;
  sequence: number;
  status: 'TO_BE_CHECKED' | 'CHECKED' | 'QUOTED' | 'AUTHORISED' | 'COMPLETED' | 'CANCELLED';
  clientId: string;
  propertyId: string;
  description: string | null;
  materials: string | null;
  quotedValue: number | null;
  tenantSnapshotName: string | null;
  tenantSnapshotPhone: string | null;
  version: number;
  createdAt: string;
  client?: Client;
  property?: Property;
  assignedContractors?: { id: string; name: string }[];
}

export function JobList() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const { socket } = useAuth();
  
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    loadJobs();
  }, [statusFilter, searchQuery, page]);

  useEffect(() => {
    if (!socket) return;
    const handleStatusChanged = () => loadJobs();
    socket.on('job:statusChanged', handleStatusChanged);
    return () => {
      socket.off('job:statusChanged', handleStatusChanged);
    };
  }, [socket, statusFilter]);

  const loadJobs = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      if (searchQuery) params.append('search', searchQuery);
      params.append('page', page.toString());
      
      const response = await apiFetch(`/jobs?${params.toString()}`);
      setJobs(response.data || []);
      if (response.meta) {
        setTotalPages(response.meta.totalPages || 1);
      }
    } catch (err: any) {
      setError('Failed to load jobs: ' + err.message);
    } finally {
      setIsLoading(false);
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
          <label className="form-label" style={{ margin: 0 }}>Filter by Status:</label>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} style={{ minWidth: '160px' }}>
            <option value="">All Statuses</option>
            <option value="TO_BE_CHECKED">To Be Checked</option>
            <option value="CHECKED">Checked</option>
            <option value="QUOTED">Quoted</option>
            <option value="AUTHORISED">Authorised</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="text-secondary" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>Loading jobs...</div>
      ) : (
        <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* List Header */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1.5fr 2fr 2fr 1.5fr 1fr', 
            gap: 'var(--space-md)', 
            padding: 'var(--space-md) var(--space-xl)', 
            borderBottom: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
            fontSize: '0.8125rem',
            fontWeight: 500
          }}>
            <div>Job #</div>
            <div>Status</div>
            <div>Address</div>
            <div>Client</div>
            <div>Date Created</div>
            <div style={{ textAlign: 'right' }}>Action</div>
          </div>

          <motion.ul 
            variants={listContainer}
            initial="hidden"
            animate="show"
            style={{ listStyle: 'none', padding: 0, margin: 0 }}
          >
            {jobs.length > 0 ? (
              jobs.map((j) => (
                <motion.li 
                  key={j.id} 
                  variants={listItem}
                  style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '1fr 1.5fr 2fr 2fr 1.5fr 1fr', 
                    gap: 'var(--space-md)', 
                    padding: 'var(--space-md) var(--space-xl)', 
                    borderBottom: '1px solid var(--color-border)',
                    alignItems: 'center',
                    transition: 'background-color 150ms ease-out'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <div className="tabular-nums">
                    <Link to={`/jobs/${j.id}`} className="font-medium" style={{ fontSize: '1rem' }}>
                      #{j.sequence}
                    </Link>
                  </div>
                  <div>
                    <span className={`status-badge ${j.status.toLowerCase()}`}>
                      {j.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2" style={{ color: 'var(--color-text-primary)', fontSize: '0.9375rem' }}>
                    <MapPin size={16} className="text-muted" />
                    {j.property?.address || `Property #${j.propertyId.toString().substring(0,8)}`}
                  </div>
                  <div className="flex items-center gap-2 text-secondary" style={{ fontSize: '0.9375rem' }}>
                    <User size={16} className="text-muted" />
                    {j.client?.name || `Client #${j.clientId.toString().substring(0,8)}`}
                  </div>
                  <div className="tabular-nums text-muted" style={{ fontSize: '0.875rem' }}>
                    {new Date(j.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Link to={`/jobs/${j.id}`} style={{ textDecoration: 'none' }}>
                      <motion.button 
                        className="button secondary small"
                        whileTap={{ scale: 0.95 }}
                        transition={{ type: "spring", duration: 0.3 }}
                      >
                        Open <ExternalLink size={14} />
                      </motion.button>
                    </Link>
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
                    {searchQuery || statusFilter ? "Try adjusting your filters." : "Create a job to get started."}
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
    </motion.div>
  );
}
