import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../utils/api';
import { Search, Plus, User, Mail, Phone, Building2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
}

export function ClientList() {
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadClients();
  }, []);

  const loadClients = async () => {
    try {
      const response = await apiFetch('/clients');
      setClients(response.data || []);
    } catch (err: any) {
      setError('Failed to load clients: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const newClient = await apiFetch('/clients', {
        method: 'POST',
        body: JSON.stringify({ name, email: email || null, phone: phone || null }),
      });
      setClients([newClient, ...clients]);
      setName('');
      setEmail('');
      setPhone('');
      setIsFormOpen(false);
    } catch (err: any) {
      setError(err.message || 'Validation failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredClients = useMemo(() => {
    if (!searchQuery) return clients;
    const lowerQuery = searchQuery.toLowerCase();
    return clients.filter(c => 
      c.name.toLowerCase().includes(lowerQuery) || 
      (c.email && c.email.toLowerCase().includes(lowerQuery)) ||
      (c.phone && c.phone.includes(lowerQuery))
    );
  }, [clients, searchQuery]);

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
            <Building2 size={28} className="text-brand" style={{ color: 'var(--color-brand)' }} /> 
            Clients
          </h1>
          <p className="text-secondary" style={{ fontSize: '1.0625rem' }}>Manage your client roster and contact information.</p>
        </div>
        
        <div className="filter-bar" style={{ marginBottom: 0, flex: 1, justifyContent: 'flex-end' }}>
          <div className="search-input-wrapper">
            <Search size={18} />
            <input 
              type="text" 
              placeholder="Search clients..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
          
          <motion.button 
            className="button primary" 
            onClick={() => setIsFormOpen(!isFormOpen)}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", duration: 0.4, bounce: 0.2 }}
          >
            <Plus size={18} /> {isFormOpen ? 'Cancel' : 'Add Client'}
          </motion.button>
        </div>
      </div>

      {error && <div className="page-error">{error}</div>}

      <AnimatePresence>
        {isFormOpen && (
          <motion.div 
            initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
            animate={{ opacity: 1, height: 'auto', overflow: 'visible' }}
            exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
            transition={{ type: "spring", duration: 0.5, bounce: 0 }}
            className="section-card"
          >
            <div className="section-card-header">
              <h3 style={{ fontSize: '1.125rem' }}>Create New Client</h3>
            </div>
            <form onSubmit={handleCreate} className="form-section">
              <div className="detail-grid">
                <div className="form-row">
                  <label className="form-label">Company / Name *</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Acme Properties" required />
                </div>
                <div className="form-row">
                  <label className="form-label">Email Address</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="contact@example.com" />
                </div>
                <div className="form-row">
                  <label className="form-label">Phone Number</label>
                  <input type="text" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01234 567890" />
                </div>
              </div>
              <div className="form-actions">
                <motion.button 
                  type="submit" 
                  className="button primary" 
                  disabled={isSubmitting}
                  whileTap={{ scale: 0.97 }}
                >
                  {isSubmitting ? 'Saving...' : 'Save Client'}
                </motion.button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="text-secondary" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>Loading clients...</div>
      ) : (
        <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* List Header */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '2fr 2fr 1fr 1fr', 
            gap: 'var(--space-md)', 
            padding: 'var(--space-md) var(--space-xl)', 
            borderBottom: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
            fontSize: '0.8125rem',
            fontWeight: 500
          }}>
            <div>Client</div>
            <div>Contact Info</div>
            <div>Status</div>
            <div>Created</div>
          </div>

          {/* List Body */}
          <motion.ul 
            variants={listContainer}
            initial="hidden"
            animate="show"
            style={{ listStyle: 'none', padding: 0, margin: 0 }}
          >
            {filteredClients.length > 0 ? (
              filteredClients.map((c) => (
                <motion.li 
                  key={c.id} 
                  variants={listItem}
                  style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '2fr 2fr 1fr 1fr', 
                    gap: 'var(--space-md)', 
                    padding: 'var(--space-md) var(--space-xl)', 
                    borderBottom: '1px solid var(--color-border)',
                    alignItems: 'center',
                    transition: 'background-color 150ms ease-out'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <div className="flex items-center gap-3">
                    <div style={{ padding: '0.5rem', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                      <User size={16} className="text-secondary" />
                    </div>
                    <div>
                      <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{c.name}</div>
                      <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.125rem' }}>ID: {c.id.split('-')[0]}</div>
                    </div>
                  </div>
                  
                  <div className="flex" style={{ flexDirection: 'column', gap: '0.35rem' }}>
                    {c.email && (
                      <div className="flex items-center gap-2 text-secondary" style={{ fontSize: '0.85rem' }}>
                        <Mail size={14} className="text-muted" /> {c.email}
                      </div>
                    )}
                    {c.phone && (
                      <div className="flex items-center gap-2 text-secondary" style={{ fontSize: '0.85rem' }}>
                        <Phone size={14} className="text-muted" /> {c.phone}
                      </div>
                    )}
                    {!c.email && !c.phone && <span className="text-muted" style={{ fontSize: '0.85rem' }}>No contact info</span>}
                  </div>
                  
                  <div>
                    <span className={`status-badge ${c.status === 'ACTIVE' ? 'authorised' : 'cancelled'}`}>
                      {c.status}
                    </span>
                  </div>
                  
                  <div className="text-secondary" style={{ fontSize: '0.875rem' }}>
                    {new Date(c.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </div>
                </motion.li>
              ))
            ) : (
              <motion.li variants={listItem} style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
                <div className="empty-state" style={{ border: 'none', padding: 0 }}>
                  <div style={{ padding: '1rem', backgroundColor: 'var(--color-bg)', borderRadius: '50%', marginBottom: 'var(--space-md)' }}>
                    <User size={32} className="text-muted" />
                  </div>
                  <p className="font-medium text-primary" style={{ fontSize: '1.125rem', margin: '0 0 var(--space-xs) 0' }}>No clients found</p>
                  <p className="text-secondary" style={{ margin: 0, fontSize: '0.9375rem' }}>
                    {searchQuery ? "Try adjusting your search query." : "Add a client to get started."}
                  </p>
                </div>
              </motion.li>
            )}
          </motion.ul>
        </div>
      )}
    </motion.div>
  );
}
