import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import type { Client } from './ClientList';
import type { Property } from './PropertyList';
import { ArrowLeft } from 'lucide-react';

export interface Tenant {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  lastPropertyId?: string;
  lastClientId?: string;
  lastProperty?: { id: string; address: string };
  lastClient?: { id: string; name: string };
}

export function JobCreate() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form Data
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [isNewTenant, setIsNewTenant] = useState(false);
  const [newTenantName, setNewTenantName] = useState('');
  const [newTenantPhone, setNewTenantPhone] = useState('');

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [description, setDescription] = useState('');

  // Search Data
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenantResults, setTenantResults] = useState<Tenant[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [propertySearch, setPropertySearch] = useState('');
  const [propertyResults, setPropertyResults] = useState<Property[]>([]);

  // ==========================================
  // OMNI-DIRECTIONAL SMART CASCADING LOGIC
  // ==========================================

  const handleSelectTenant = async (t: Tenant) => {
    setSelectedTenant(t);
    setTenantSearch('');
    setIsNewTenant(false);
    
    try {
      const res = await apiFetch(`/tenants/${t.id}/related`);
      if (res.properties) {
        setPropertyResults(res.properties);
        if (res.properties.length === 1 && !selectedProperty) setSelectedProperty(res.properties[0]);
      }
      if (res.clients) {
        setClientResults(res.clients);
        if (res.clients.length === 1 && !selectedClient) setSelectedClient(res.clients[0]);
      }
    } catch (e) {
      console.error('Failed to fetch related data for tenant', e);
    }
  };

  const handleSelectClient = async (c: Client) => {
    setSelectedClient(c);
    setClientSearch('');
    
    try {
      const res = await apiFetch(`/clients/${c.id}/related`);
      if (res.properties) {
        setPropertyResults(res.properties);
        if (res.properties.length === 1 && !selectedProperty) setSelectedProperty(res.properties[0]);
      }
    } catch (e) {
      console.error('Failed to fetch related data for client', e);
    }
  };

  const handleSelectProperty = async (p: Property) => {
    setSelectedProperty(p);
    setPropertySearch('');
    
    try {
      const res = await apiFetch(`/properties/${p.id}/related`);
      
      const allClients: Client[] = [];
      if (res.currentClient) allClients.push(res.currentClient);
      if (res.historicalClients) {
        res.historicalClients.forEach((hc: Client) => {
          if (!allClients.find(existing => existing.id === hc.id)) allClients.push(hc);
        });
      }
      
      setClientResults(allClients);
      if (allClients.length === 1 && !selectedClient) setSelectedClient(allClients[0]);

      if (res.tenants) {
        setTenantResults(res.tenants);
        if (res.tenants.length === 1 && !selectedTenant) setSelectedTenant(res.tenants[0]);
      }
    } catch (e) {
      console.error('Failed to fetch related data for property', e);
    }
  };

  // ==========================================
  // GLOBAL SEARCH TYPING DEBOUNCERS
  // ==========================================

  useEffect(() => {
    if (tenantSearch.length < 2) return;
    const timer = setTimeout(async () => {
      try {
        const response = await apiFetch(`/tenants?q=${encodeURIComponent(tenantSearch)}`);
        setTenantResults(response.data || []);
      } catch (e) { console.error(e); }
    }, 300);
    return () => clearTimeout(timer);
  }, [tenantSearch]);

  useEffect(() => {
    if (clientSearch.length < 2) return;
    const timer = setTimeout(async () => {
      try {
        const response = await apiFetch(`/clients?q=${encodeURIComponent(clientSearch)}`);
        setClientResults(response.data || []);
      } catch (e) { console.error(e); }
    }, 300);
    return () => clearTimeout(timer);
  }, [clientSearch]);

  useEffect(() => {
    if (propertySearch.length < 2) return;
    const timer = setTimeout(async () => {
      try {
        const qs = `q=${encodeURIComponent(propertySearch)}`;
        const response = await apiFetch(`/properties?${qs}`);
        setPropertyResults(response.data || []);
      } catch (e) { console.error(e); }
    }, 300);
    return () => clearTimeout(timer);
  }, [propertySearch]);


  // ==========================================
  // SUBMISSION
  // ==========================================

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!selectedClient || !selectedProperty) {
      setError('You must select both a Client and a Property.');
      return;
    }

    if (isNewTenant && !newTenantName) {
      setError('You must provide a name for the new Tenant.');
      return;
    }

    setIsSubmitting(true);
    try {
      const newJob = await apiFetch('/jobs', {
        method: 'POST',
        body: JSON.stringify({ 
          clientId: selectedClient.id, 
          propertyId: selectedProperty.id, 
          description,
          tenantId: selectedTenant ? selectedTenant.id : undefined,
          newTenantName: isNewTenant ? newTenantName : undefined,
          newTenantPhone: isNewTenant ? newTenantPhone : undefined,
        }),
      });
      navigate(`/jobs/${newJob.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to create job');
      setIsSubmitting(false);
    }
  };

  const highlightMatch = (text: string, query: string) => {
    if (!query || !text) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    return (
      <>
        {parts.map((part, i) => 
          part.toLowerCase() === query.toLowerCase() 
            ? <span key={i} style={{ backgroundColor: 'yellow', fontWeight: 'bold', color: 'black' }}>{part}</span> 
            : part
        )}
      </>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: 'var(--spacing-md)' }}>
        <Link to="/jobs" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-secondary)' }}>
          <ArrowLeft size={16} /> Back to Jobs
        </Link>
      </div>

      <h2>Create New Job</h2>

      {error && (
        <div style={{ padding: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)', backgroundColor: 'var(--status-cancelled-bg)', color: 'var(--status-cancelled-text)', borderRadius: 'var(--border-radius)' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ background: 'var(--surface-color)', padding: 'var(--spacing-lg)', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)', maxWidth: '600px' }}>
        
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 'var(--spacing-md)' }}>
          <strong>Smart Suggest:</strong> You can fill these out in any order! Selecting one will automatically suggest related choices for the others based on job history.
        </p>

        {/* Tenant Lookup */}
        <div style={{ marginBottom: 'var(--spacing-md)' }}>
          <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 600 }}>1. Tenant</label>
          {isNewTenant ? (
             <div style={{ padding: 'var(--spacing-sm)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', backgroundColor: 'var(--bg-color)' }}>
               <div style={{ marginBottom: 'var(--spacing-xs)', fontWeight: 600 }}>New Tenant</div>
               <input 
                 type="text" 
                 placeholder="Tenant Name (Required)" 
                 value={newTenantName}
                 onChange={e => setNewTenantName(e.target.value)}
                 style={{ width: '100%', marginBottom: 'var(--spacing-xs)' }}
                 required
               />
               <input 
                 type="text" 
                 placeholder="Tenant Phone (Optional)" 
                 value={newTenantPhone}
                 onChange={e => setNewTenantPhone(e.target.value)}
                 style={{ width: '100%', marginBottom: 'var(--spacing-xs)' }}
               />
               <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                 <button type="button" onClick={() => setIsNewTenant(false)} className="secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>Cancel</button>
               </div>
             </div>
          ) : selectedTenant ? (
            <div style={{ padding: 'var(--spacing-sm)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', display: 'flex', justifyContent: 'space-between', backgroundColor: 'var(--bg-color)', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{selectedTenant.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {selectedTenant.email || 'No Email'} | {selectedTenant.phone || 'No Phone'}
                </div>
              </div>
              <button type="button" onClick={() => { setSelectedTenant(null); setTenantSearch(''); setTenantResults([]); }} className="secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}>Change</button>
            </div>
          ) : (
            <div>
              <input 
                type="text" 
                placeholder={selectedProperty || selectedClient ? "Smart suggestions loaded. Type to override..." : "Type to search existing tenants..."}
                value={tenantSearch}
                onChange={e => setTenantSearch(e.target.value)}
                style={{ width: '100%', marginBottom: 'var(--spacing-xs)' }}
              />
              {tenantResults.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', maxHeight: '200px', overflowY: 'auto', marginBottom: 'var(--spacing-sm)' }}>
                  {tenantResults.map(t => (
                    <li key={t.id} style={{ padding: 'var(--spacing-sm)', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', backgroundColor: 'var(--surface-color)' }} onClick={() => handleSelectTenant(t)}>
                      <div style={{ fontWeight: 600 }}>{highlightMatch(t.name, tenantSearch)}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {t.phone ? highlightMatch(t.phone, tenantSearch) : 'No Phone'}
                        {t.lastProperty ? ` | Last Property: ${t.lastProperty.address}` : ' | No Property History'}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                Don't see them? <button type="button" onClick={() => setIsNewTenant(true)} style={{ background: 'none', border: 'none', color: 'var(--primary-color)', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>Create a new tenant</button>
              </div>
            </div>
          )}
        </div>

        {/* Client Lookup */}
        <div style={{ marginBottom: 'var(--spacing-md)' }}>
          <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 600 }}>2. Client</label>
          {selectedClient ? (
            <div style={{ padding: 'var(--spacing-sm)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', display: 'flex', justifyContent: 'space-between', backgroundColor: 'var(--bg-color)', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{selectedClient.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {selectedClient.email || 'No Email'} | {selectedClient.phone || 'No Phone'}
                </div>
              </div>
              <button type="button" onClick={() => { setSelectedClient(null); setClientSearch(''); setClientResults([]); }} className="secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}>Change</button>
            </div>
          ) : (
            <div>
              <input 
                type="text" 
                placeholder={selectedTenant || selectedProperty ? "Smart suggestions loaded. Type to override..." : "Type to search clients by name, email, or phone..."}
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                style={{ width: '100%', marginBottom: 'var(--spacing-xs)' }}
              />
              {clientResults.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', maxHeight: '200px', overflowY: 'auto' }}>
                  {clientResults.map(c => (
                    <li key={c.id} style={{ padding: 'var(--spacing-sm)', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', backgroundColor: 'var(--surface-color)' }} onClick={() => handleSelectClient(c)}>
                      <div style={{ fontWeight: 600 }}>{highlightMatch(c.name, clientSearch)}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Email: {highlightMatch(c.email || 'N/A', clientSearch)} | Phone: {highlightMatch(c.phone || 'N/A', clientSearch)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Property Lookup */}
        <div style={{ marginBottom: 'var(--spacing-md)' }}>
          <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 600 }}>3. Property</label>
          {selectedProperty ? (
            <div style={{ padding: 'var(--spacing-sm)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', display: 'flex', justifyContent: 'space-between', backgroundColor: 'var(--bg-color)', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{selectedProperty.address}</div>
              </div>
              <button type="button" onClick={() => { setSelectedProperty(null); setPropertySearch(''); setPropertyResults([]); }} className="secondary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem' }}>Change</button>
            </div>
          ) : (
            <div>
              <input 
                type="text" 
                placeholder={selectedTenant || selectedClient ? "Smart suggestions loaded. Type to override..." : "Type to search all properties..."}
                value={propertySearch}
                onChange={e => setPropertySearch(e.target.value)}
                style={{ width: '100%', marginBottom: 'var(--spacing-xs)' }}
              />
              {propertyResults.length > 0 && (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', maxHeight: '200px', overflowY: 'auto' }}>
                  {propertyResults.map(p => (
                    <li key={p.id} style={{ padding: 'var(--spacing-sm)', borderBottom: '1px solid var(--border-color)', cursor: 'pointer', backgroundColor: 'var(--surface-color)' }} onClick={() => handleSelectProperty(p)}>
                      <div style={{ fontWeight: 600 }}>{highlightMatch(p.address, propertySearch)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Description */}
        <div style={{ marginBottom: 'var(--spacing-lg)' }}>
          <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 600 }}>4. Job Description</label>
          <textarea 
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            style={{ width: '100%' }}
            placeholder="Initial details about the required work..."
          />
        </div>

        <button type="submit" className="primary" disabled={isSubmitting || !selectedClient || !selectedProperty} style={{ width: '100%' }}>
          {isSubmitting ? 'Creating...' : 'Create Job'}
        </button>
      </form>
    </div>
  );
}
