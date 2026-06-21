import { useState, useEffect, useMemo } from 'react';
import { apiFetch } from '../utils/api';
import { Search, Plus, Home, MapPin, User, Building2, CornerDownRight } from 'lucide-react';
import { SearchableAutocomplete } from '../components/SearchableAutocomplete';
import type { Client } from './ClientList';
import { motion, AnimatePresence } from 'motion/react';

export interface Property {
  id: string;
  address: string;
  parentId: string | null;
  parent?: { id: string; address: string };
  subUnits?: { id: string; address: string }[];
  currentClientId: string | null;
  currentClient?: { id: string; name: string; phone?: string | null; email?: string | null };
  lastTenants?: { id: string; name: string; phone: string | null; email: string | null }[];
  createdAt: string;
}

export function PropertyList() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);

  const [address, setAddress] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedParent, setSelectedParent] = useState<Property | null>(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const propRes = await apiFetch('/properties');
      setProperties(propRes.data || []);
    } catch (err: any) {
      setError('Failed to load data: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const newProperty = await apiFetch('/properties', {
        method: 'POST',
        body: JSON.stringify({ 
          address,
          currentClientId: selectedClient ? selectedClient.id : null,
          parentId: selectedParent ? selectedParent.id : null
        }),
      });
      setProperties([newProperty, ...properties]);
      setAddress('');
      setSelectedClient(null);
      setSelectedParent(null);
      setIsFormOpen(false);
    } catch (err: any) {
      setError(err.message || 'Validation failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredProperties = useMemo(() => {
    if (!searchQuery) return properties;
    const lowerQuery = searchQuery.toLowerCase();
    return properties.filter(p => 
      p.address.toLowerCase().includes(lowerQuery) || 
      (p.lastTenants && p.lastTenants.some(t => t.name.toLowerCase().includes(lowerQuery))) ||
      (p.currentClient && p.currentClient.name.toLowerCase().includes(lowerQuery))
    );
  }, [properties, searchQuery]);

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
            <Home size={28} className="text-brand" style={{ color: 'var(--color-brand)' }} /> 
            Properties
          </h1>
          <p className="text-secondary" style={{ fontSize: '1.0625rem' }}>Manage your portfolio and tenant assignments.</p>
        </div>
        
        <div className="filter-bar" style={{ marginBottom: 0, flex: 1, justifyContent: 'flex-end' }}>
          <div className="search-input-wrapper">
            <Search size={18} />
            <input 
              type="text" 
              placeholder="Search address or tenant..." 
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
            <Plus size={18} /> {isFormOpen ? 'Cancel' : 'Add Property'}
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
              <h3 style={{ fontSize: '1.125rem' }}>Create New Property</h3>
            </div>
            <form onSubmit={handleCreate} className="form-section">
              <div className="detail-grid">
                <div className="form-row">
                  <label className="form-label">Full Address *</label>
                  <input type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Main St, London..." required />
                </div>
                
                <div className="form-row">
                  <label className="form-label">Assigned Client (Optional)</label>
                  <SearchableAutocomplete
                    endpoint="/clients"
                    placeholder="Search clients..."
                    labelKey={(c: Client) => c.name}
                    subLabelKey={(c: Client) => [c.phone, c.email].filter(Boolean).join(' | ')}
                    selectedItem={selectedClient}
                    onSelect={setSelectedClient}
                  />
                </div>

                <div className="form-row">
                  <label className="form-label">Parent Property (Optional - for HMOs/Flats)</label>
                  <SearchableAutocomplete
                    endpoint="/properties"
                    placeholder="Search parent building..."
                    labelKey={(p: Property) => p.address}
                    subLabelKey={(p: Property) => {
                      const parts = [];
                      if (p.currentClient) parts.push(`Client: ${p.currentClient.name}`);
                      if (p.lastTenants && p.lastTenants.length > 0) {
                        const maxTenants = 2;
                        const tenantNames = p.lastTenants.slice(0, maxTenants).map(t => t.name);
                        const remaining = p.lastTenants.length - maxTenants;
                        
                        let tenantStr = tenantNames.join(', ');
                        if (remaining > 0) {
                          tenantStr += `, and ${remaining} more`;
                        }
                        parts.push(`Tenants: ${tenantStr}`);
                      }
                      return parts.join(' | ') || undefined;
                    }}
                    selectedItem={selectedParent}
                    onSelect={setSelectedParent}
                  />
                </div>
              </div>
              
              <div className="form-actions">
                <motion.button 
                  type="submit" 
                  className="button primary" 
                  disabled={isSubmitting}
                  whileTap={{ scale: 0.97 }}
                >
                  {isSubmitting ? 'Saving...' : 'Save Property'}
                </motion.button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="text-secondary" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>Loading properties...</div>
      ) : (
        <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* List Header */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '2fr 1.5fr 1.5fr', 
            gap: 'var(--space-md)', 
            padding: 'var(--space-md) var(--space-xl)', 
            borderBottom: '1px solid var(--color-border)',
            color: 'var(--color-text-secondary)',
            fontSize: '0.8125rem',
            fontWeight: 500
          }}>
            <div>Address</div>
            <div>Current Tenants</div>
            <div>Assigned Client</div>
          </div>

          <motion.ul 
            variants={listContainer}
            initial="hidden"
            animate="show"
            style={{ listStyle: 'none', padding: 0, margin: 0 }}
          >
            {filteredProperties.length > 0 ? (
              filteredProperties.map((p) => (
                <motion.li 
                  key={p.id} 
                  variants={listItem}
                  style={{ 
                    display: 'grid', 
                    gridTemplateColumns: '2fr 1.5fr 1.5fr', 
                    gap: 'var(--space-md)', 
                    padding: 'var(--space-md) var(--space-xl)', 
                    borderBottom: '1px solid var(--color-border)',
                    alignItems: 'start',
                    transition: 'background-color 150ms ease-out'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--color-surface)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <div className="flex items-start gap-3">
                    <div style={{ padding: '0.5rem', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                      <MapPin size={16} className="text-secondary" />
                    </div>
                    <div className="flex" style={{ flexDirection: 'column', gap: '0.25rem' }}>
                      <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{p.address}</div>
                      {p.parent && (
                        <div className="text-secondary flex items-center gap-1" style={{ fontSize: '0.875rem' }}>
                          <CornerDownRight size={14} className="text-muted" /> Part of: {p.parent.address}
                        </div>
                      )}
                      {p.subUnits && p.subUnits.length > 0 && (
                        <div style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>
                          <span style={{ fontWeight: 500, color: 'var(--color-brand)' }}>{p.subUnits.length} sub-units</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <div className="flex" style={{ flexDirection: 'column', gap: '0.35rem' }}>
                      {p.lastTenants && p.lastTenants.length > 0 ? (
                        p.lastTenants.map(t => (
                          <div key={t.id} className="flex items-center gap-2" style={{ fontSize: '0.9375rem' }}>
                            <User size={14} className="text-muted" /> 
                            <span style={{ color: 'var(--color-text-primary)' }}>
                              {t.name}
                              {t.phone && <span className="text-muted" style={{ fontSize: '0.85rem', marginLeft: '0.5rem' }}>{t.phone}</span>}
                            </span>
                          </div>
                        ))
                      ) : (
                        <span className="text-muted" style={{ fontSize: '0.875rem' }}>No tenants assigned</span>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    {p.currentClient ? (
                      <div className="flex" style={{ flexDirection: 'column', gap: '0.25rem' }}>
                        <div className="flex items-center gap-2" style={{ color: 'var(--color-text-primary)', fontSize: '0.9375rem' }}>
                          <Building2 size={14} className="text-muted" /> {p.currentClient.name}
                        </div>
                        {(p.currentClient.phone || p.currentClient.email) && (
                          <div className="text-muted" style={{ fontSize: '0.85rem', marginLeft: '1.35rem' }}>
                            {[p.currentClient.phone, p.currentClient.email].filter(Boolean).join(' | ')}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted" style={{ fontSize: '0.875rem', fontStyle: 'italic' }}>Unassigned</span>
                    )}
                  </div>
                </motion.li>
              ))
            ) : (
              <motion.li variants={listItem} style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>
                <div className="empty-state" style={{ border: 'none', padding: 0 }}>
                  <div style={{ padding: '1rem', backgroundColor: 'var(--color-bg)', borderRadius: '50%', marginBottom: 'var(--space-md)' }}>
                    <Home size={32} className="text-muted" />
                  </div>
                  <p className="font-medium text-primary" style={{ fontSize: '1.125rem', margin: '0 0 var(--space-xs) 0' }}>No properties found</p>
                  <p className="text-secondary" style={{ margin: 0, fontSize: '0.9375rem' }}>
                    {searchQuery ? "Try adjusting your search query." : "Add a property to get started."}
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
