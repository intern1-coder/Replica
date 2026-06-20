import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { Link } from 'react-router-dom';

export interface Property {
  id: string;
  address: string;
  currentTenantName: string | null;
  currentTenantPhone: string | null;
  currentClientId: string | null;
  currentClient?: { id: string; name: string };
  createdAt: string;
}

export function PropertyList() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Form State
  const [address, setAddress] = useState('');
  const [currentTenantName, setCurrentTenantName] = useState('');
  const [currentTenantPhone, setCurrentTenantPhone] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadProperties();
  }, []);

  const loadProperties = async () => {
    try {
      const response = await apiFetch('/properties');
      setProperties(response.data || []);
    } catch (err: any) {
      setError('Failed to load properties: ' + err.message);
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
          currentTenantName: currentTenantName || null,
          currentTenantPhone: currentTenantPhone || null,
        }),
      });
      setProperties([newProperty, ...properties]);
      setAddress('');
      setCurrentTenantName('');
      setCurrentTenantPhone('');
    } catch (err: any) {
      if (err.status === 422 || err.status === 409) {
        setError(err.message || 'Validation failed or property already exists.');
      } else {
        setError('Failed to create property.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
        <h2>Properties</h2>
      </div>

      {error && (
        <div style={{ padding: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)', backgroundColor: 'var(--status-cancelled-bg)', color: 'var(--status-cancelled-text)', borderRadius: 'var(--border-radius)' }}>
          {error}
        </div>
      )}

      {/* Create Form */}
      <div style={{ background: 'var(--surface-color)', padding: 'var(--spacing-md)', borderRadius: 'var(--border-radius)', marginBottom: 'var(--spacing-lg)', border: '1px solid var(--border-color)' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: 'var(--spacing-md)' }}>New Property</h3>
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 300px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 'var(--spacing-xs)' }}>Full Address *</label>
            <input type="text" value={address} onChange={e => setAddress(e.target.value)} placeholder="123 Main St, London..." required style={{ width: '100%', padding: '0.5rem' }} />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 'var(--spacing-xs)' }}>Current Tenant Name</label>
            <input type="text" value={currentTenantName} onChange={e => setCurrentTenantName(e.target.value)} style={{ width: '100%', padding: '0.5rem' }} />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 'var(--spacing-xs)' }}>Tenant Phone</label>
            <input type="text" value={currentTenantPhone} onChange={e => setCurrentTenantPhone(e.target.value)} style={{ width: '100%', padding: '0.5rem' }} />
          </div>
          <button type="submit" className="primary" disabled={isSubmitting} style={{ padding: '0.5rem 1rem' }}>
            {isSubmitting ? 'Saving...' : 'Add Property'}
          </button>
        </form>
      </div>

      {/* List Table */}
      {isLoading ? (
        <p>Loading properties...</p>
      ) : (
        <table className="dense-table">
          <thead>
            <tr>
              <th>Address</th>
              <th>Tenant Name</th>
              <th>Tenant Phone</th>
              <th>Assigned Client</th>
            </tr>
          </thead>
          <tbody>
            {properties.map(p => (
              <tr key={p.id}>
                <td style={{ fontWeight: 600 }}>{p.address}</td>
                <td>{p.currentTenantName || '-'}</td>
                <td>{p.currentTenantPhone || '-'}</td>
                <td>{p.currentClient?.name || '-'}</td>
              </tr>
            ))}
            {properties.length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: 'var(--spacing-lg)' }}>No properties found.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
