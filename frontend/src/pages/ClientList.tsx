import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';

export interface Client {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
}

export function ClientList() {
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Form State
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
    } catch (err: any) {
      if (err.status === 422 || err.status === 409) {
        setError(err.message || 'Validation failed or client already exists.');
      } else {
        setError('Failed to create client.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-md)' }}>
        <h2>Clients</h2>
      </div>

      {error && (
        <div style={{ padding: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)', backgroundColor: 'var(--status-cancelled-bg)', color: 'var(--status-cancelled-text)', borderRadius: 'var(--border-radius)' }}>
          {error}
        </div>
      )}

      {/* Create Form */}
      <div style={{ background: 'var(--surface-color)', padding: 'var(--spacing-md)', borderRadius: 'var(--border-radius)', marginBottom: 'var(--spacing-lg)', border: '1px solid var(--border-color)' }}>
        <h3 style={{ fontSize: '1rem', marginBottom: 'var(--spacing-md)' }}>New Client</h3>
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 'var(--spacing-xs)' }}>Name *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} required style={{ width: '100%' }} />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 'var(--spacing-xs)' }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} style={{ width: '100%' }} />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: 'var(--spacing-xs)' }}>Phone</label>
            <input type="text" value={phone} onChange={e => setPhone(e.target.value)} style={{ width: '100%' }} />
          </div>
          <button type="submit" className="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Add Client'}
          </button>
        </form>
      </div>

      {/* List Table */}
      {isLoading ? (
        <p>Loading clients...</p>
      ) : (
        <table className="dense-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {clients.map(c => (
              <tr key={c.id}>
                <td className="tabular-nums">{c.id}</td>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td>{c.email || '-'}</td>
                <td className="tabular-nums">{c.phone || '-'}</td>
                <td>
                  <span className={`status-badge ${c.status === 'ACTIVE' ? 'authorised' : 'cancelled'}`}>
                    {c.status}
                  </span>
                </td>
                <td className="tabular-nums">{new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: 'var(--spacing-lg)' }}>No clients found.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
