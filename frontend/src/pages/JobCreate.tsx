import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import type { Client } from './ClientList';
import type { Property } from './PropertyList';
import { ArrowLeft } from 'lucide-react';
import { SearchableAutocomplete } from '../components/SearchableAutocomplete';

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
  const [isNewClient, setIsNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');

  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [description, setDescription] = useState('');

  const [autoFillMsgTenant, setAutoFillMsgTenant] = useState<string | null>(null);
  const [autoFillMsgClient, setAutoFillMsgClient] = useState<string | null>(null);
  const [autoFillMsgProperty, setAutoFillMsgProperty] = useState<string | null>(null);

  const [suggestedTenants, setSuggestedTenants] = useState<Tenant[]>([]);
  const [suggestedClients, setSuggestedClients] = useState<Client[]>([]);
  const [suggestedProperties, setSuggestedProperties] = useState<Property[]>([]);

  // ==========================================
  // OMNI-DIRECTIONAL SMART CASCADING LOGIC
  // ==========================================

  const handleSelectTenant = async (t: Tenant | null) => {
    setSelectedTenant(t);
    setIsNewTenant(false);
    setAutoFillMsgTenant(null); // Cleared on manual selection
    if (!t) return;
    
    try {
      const res = await apiFetch(`/tenants/${t.id}/related`);
      if (res.properties && res.properties.length === 1) {
        if (!selectedProperty) {
          setSelectedProperty(res.properties[0]);
          setAutoFillMsgProperty('Auto-filled based on Tenant history');
          setSuggestedProperties([]);
        }
      } else if (res.properties && res.properties.length > 1) {
        setSuggestedProperties(res.properties);
      } else {
        setSuggestedProperties([]);
      }

      if (res.clients && res.clients.length === 1) {
        if (!selectedClient) {
          setSelectedClient(res.clients[0]);
          setAutoFillMsgClient('Auto-filled based on Tenant history');
          setSuggestedClients([]);
        }
      } else if (res.clients && res.clients.length > 1) {
        setSuggestedClients(res.clients);
      } else {
        setSuggestedClients([]);
      }
    } catch (e) {
      console.error('Failed to fetch related data for tenant', e);
    }
  };

  const handleSelectClient = async (c: Client | null) => {
    setSelectedClient(c);
    setAutoFillMsgClient(null); // Cleared on manual selection
    if (!c) return;
    
    try {
      const res = await apiFetch(`/clients/${c.id}/related`);
      if (res.properties && res.properties.length === 1) {
        if (!selectedProperty) {
          setSelectedProperty(res.properties[0]);
          setAutoFillMsgProperty('Auto-filled based on Client history');
          setSuggestedProperties([]);
        }
      } else if (res.properties && res.properties.length > 1) {
        setSuggestedProperties(res.properties);
      } else {
        setSuggestedProperties([]);
      }
    } catch (e) {
      console.error('Failed to fetch related data for client', e);
    }
  };

  const handleSelectProperty = async (p: Property | null) => {
    setSelectedProperty(p);
    setAutoFillMsgProperty(null); // Cleared on manual selection
    if (!p) return;
    
    try {
      const res = await apiFetch(`/properties/${p.id}/related`);
      
      if (res.currentClient) {
        if (!selectedClient) {
          setSelectedClient(res.currentClient);
          setAutoFillMsgClient('Auto-filled based on Property');
          setSuggestedClients([]);
        }
      } else if (res.historicalClients && res.historicalClients.length === 1) {
        if (!selectedClient) {
          setSelectedClient(res.historicalClients[0]);
          setAutoFillMsgClient('Auto-filled based on Property history');
          setSuggestedClients([]);
        }
      } else if (res.historicalClients && res.historicalClients.length > 1) {
        setSuggestedClients(res.historicalClients);
      } else {
        setSuggestedClients([]);
      }

      // Only auto-fill tenant if there is EXACTLY ONE tenant. Otherwise, let user choose.
      if (res.tenants && res.tenants.length === 1) {
        if (!selectedTenant) {
          setSelectedTenant(res.tenants[0]);
          setAutoFillMsgTenant('Auto-filled based on Property');
          setSuggestedTenants([]);
        }
      } else if (res.tenants && res.tenants.length > 1) {
        setSuggestedTenants(res.tenants);
      } else {
        setSuggestedTenants([]);
      }
    } catch (e) {
      console.error('Failed to fetch related data for property', e);
    }
  };

  // ==========================================
  // SUBMISSION
  // ==========================================

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!selectedClient && !isNewClient) {
      setError('You must select or create a Client.');
      return;
    }
    if (!selectedProperty) {
      setError('You must select a Property.');
      return;
    }

    if (isNewClient && !newClientName) {
      setError('You must provide a name for the new Client.');
      return;
    }

    if (isNewTenant && !newTenantName) {
      setError('You must provide a name for the new Tenant.');
      return;
    }

    setIsSubmitting(true);
    try {
      let finalClientId = selectedClient?.id;

      if (isNewClient) {
        const createdClient = await apiFetch('/clients', {
          method: 'POST',
          body: JSON.stringify({ 
            name: newClientName, 
            phone: newClientPhone || undefined, 
            email: newClientEmail || undefined 
          })
        });
        finalClientId = createdClient.id;
      }

      const newJob = await apiFetch('/jobs', {
        method: 'POST',
        body: JSON.stringify({ 
          clientId: finalClientId, 
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

  return (
    <div className="page-enter">
      <div className="page-header">
        <Link to="/jobs" className="flex items-center gap-2 text-secondary font-medium">
          <ArrowLeft size={16} /> Back to Jobs
        </Link>
      </div>

      <h2>Create New Job</h2>

      {error && (
        <div className="page-error">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="section-card form-section" style={{ maxWidth: '600px', margin: '0 auto' }}>
        
        <p className="text-secondary" style={{ fontSize: '0.9rem', marginBottom: 'var(--space-md)' }}>
          <strong className="text-primary">Smart Suggest:</strong> You can fill these out in any order! Selecting one will automatically suggest related choices for the others based on job history.
        </p>

        {/* Tenant Lookup */}
        <div className="form-row">
          <label className="form-label">1. Tenant</label>
          {isNewTenant ? (
             <div className="section-card" style={{ padding: 'var(--space-sm)', margin: 0 }}>
               <div className="font-medium" style={{ marginBottom: 'var(--space-xs)' }}>New Tenant</div>
               <input 
                 type="text" 
                 placeholder="Tenant Name (Required)" 
                 value={newTenantName}
                 onChange={e => setNewTenantName(e.target.value)}
                 style={{ width: '100%', marginBottom: 'var(--space-xs)' }}
                 required
               />
               <input 
                 type="text" 
                 placeholder="Tenant Phone (Optional)" 
                 value={newTenantPhone}
                 onChange={e => setNewTenantPhone(e.target.value)}
                 style={{ width: '100%', marginBottom: 'var(--space-xs)' }}
               />
               <div className="flex gap-2">
                 <button type="button" onClick={() => setIsNewTenant(false)} className="button secondary small">Cancel</button>
               </div>
             </div>
          ) : (
            <div>
              <SearchableAutocomplete
                endpoint="/tenants"
                placeholder={selectedProperty || selectedClient ? "Smart suggestions loaded. Type to override..." : "Type to search existing tenants..."}
                labelKey={(t: Tenant) => t.name}
                subLabelKey={(t: Tenant) => [t.phone, t.email].filter(Boolean).join(' | ')}
                selectedItem={selectedTenant}
                onSelect={handleSelectTenant}
                allowCreate={true}
                defaultOptions={suggestedTenants}
                defaultOptionsTitle="Tenants at this Property"
                onCreateNew={(term) => {
                  setNewTenantName(term);
                  setIsNewTenant(true);
                }}
              />
              {autoFillMsgTenant && selectedTenant && (
                <div className="flex items-center gap-2" style={{ fontSize: '0.8rem', color: 'var(--color-brand)', marginTop: '0.25rem' }}>
                  <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--color-brand)' }}></span>
                  {autoFillMsgTenant}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Client Lookup */}
        <div className="form-row">
          <label className="form-label">2. Client</label>
          {isNewClient ? (
             <div className="section-card" style={{ padding: 'var(--space-sm)', margin: 0 }}>
               <div className="font-medium" style={{ marginBottom: 'var(--space-xs)' }}>New Client</div>
               <input 
                 type="text" 
                 placeholder="Client Name (Required)" 
                 value={newClientName}
                 onChange={e => setNewClientName(e.target.value)}
                 style={{ width: '100%', marginBottom: 'var(--space-xs)' }}
                 required
               />
               <input 
                 type="text" 
                 placeholder="Phone (Optional)" 
                 value={newClientPhone}
                 onChange={e => setNewClientPhone(e.target.value)}
                 style={{ width: '100%', marginBottom: 'var(--space-xs)' }}
               />
               <input 
                 type="email" 
                 placeholder="Email (Optional)" 
                 value={newClientEmail}
                 onChange={e => setNewClientEmail(e.target.value)}
                 style={{ width: '100%', marginBottom: 'var(--space-xs)' }}
               />
               <div className="flex gap-2">
                 <button type="button" onClick={() => setIsNewClient(false)} className="button secondary small">Cancel</button>
               </div>
             </div>
          ) : (
            <div>
              <SearchableAutocomplete
                endpoint="/clients"
                placeholder={selectedTenant || selectedProperty ? "Smart suggestions loaded. Type to override..." : "Type to search clients by name, email, or phone..."}
                labelKey={(c: Client) => c.name}
                subLabelKey={(c: Client) => [c.phone, c.email].filter(Boolean).join(' | ')}
                selectedItem={selectedClient}
                onSelect={handleSelectClient}
                defaultOptions={suggestedClients}
                defaultOptionsTitle="Clients for this selection"
                allowCreate={true}
                onCreateNew={(term) => {
                  setNewClientName(term);
                  setIsNewClient(true);
                }}
              />
              {autoFillMsgClient && selectedClient && (
                <div className="flex items-center gap-2" style={{ fontSize: '0.8rem', color: 'var(--color-brand)', marginTop: '0.25rem' }}>
                  <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--color-brand)' }}></span>
                  {autoFillMsgClient}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Property Lookup */}
        <div className="form-row">
          <label className="form-label">3. Property</label>
          <SearchableAutocomplete
            endpoint="/properties"
            placeholder={selectedTenant || selectedClient ? "Smart suggestions loaded. Type to override..." : "Type to search all properties..."}
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
            selectedItem={selectedProperty}
            onSelect={handleSelectProperty}
            defaultOptions={suggestedProperties}
            defaultOptionsTitle="Properties for this selection"
          />
          {autoFillMsgProperty && selectedProperty && (
            <div className="flex items-center gap-2" style={{ fontSize: '0.8rem', color: 'var(--color-brand)', marginTop: '0.25rem' }}>
              <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--color-brand)' }}></span>
              {autoFillMsgProperty}
            </div>
          )}
        </div>

        {/* Description */}
        <div className="form-row">
          <label className="form-label">4. Job Description</label>
          <textarea 
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            style={{ width: '100%' }}
            placeholder="Initial details about the required work..."
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="button primary" disabled={isSubmitting || (!selectedClient && !isNewClient) || !selectedProperty} style={{ width: '100%' }}>
            {isSubmitting ? 'Creating...' : 'Create Job'}
          </button>
        </div>
      </form>
    </div>
  );
}
