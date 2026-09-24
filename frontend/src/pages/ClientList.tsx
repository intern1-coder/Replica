import { useState, useEffect, useMemo, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Search, Plus, User, Mail, Phone, Building2, Edit, Trash2, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  // Soft-delete marker: set = inactive, null/absent = active.
  deletedAt?: string | null;
  createdAt: string;
}

export function ClientList() {
  const { can } = useAuth();
  const { showToast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canEdit = can('clients:edit');
  const canDeactivate = can('clients:delete');

  const loadClients = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await apiFetch(`/clients${showInactive ? '?includeInactive=true' : ''}`);
      setClients(response.data || []);
    } catch (err: any) {
      setError('Failed to load clients: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  }, [showInactive]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const resetForm = () => {
    setName('');
    setEmail('');
    setPhone('');
    setEditingId(null);
  };

  const openEdit = (c: Client) => {
    setIsFormOpen(false);
    setEditingId(c.id);
    setName(c.name);
    setEmail(c.email || '');
    setPhone(c.phone || '');
    setError('');
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');
    try {
      const newClient = await apiFetch('/clients', {
        method: 'POST',
        body: JSON.stringify({ name, email: email || null, phone: phone || null }),
      });
      setClients([newClient, ...clients]);
      resetForm();
      setIsFormOpen(false);
      showToast('Client created', 'success');
    } catch (err: any) {
      setError(err.message || 'Validation failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingId) return;
    setIsSubmitting(true);
    setError('');
    try {
      const updated = await apiFetch(`/clients/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, email: email || null, phone: phone || null }),
      });
      setClients(clients.map((c) => (c.id === editingId ? { ...c, ...updated } : c)));
      resetForm();
      showToast('Client updated', 'success');
    } catch (err: any) {
      setError(err.message || 'Validation failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeactivate = async (c: Client) => {
    if (!window.confirm(`Deactivate ${c.name}? They will be hidden from the client list.`)) return;
    try {
      await apiFetch(`/clients/${c.id}`, { method: 'DELETE' });
      showToast('Client deactivated', 'success');
      loadClients();
    } catch (err: any) {
      showToast(err.message || 'Failed to deactivate client', 'error');
    }
  };

  const handleReactivate = async (c: Client) => {
    try {
      await apiFetch(`/clients/${c.id}/restore`, { method: 'PATCH' });
      showToast('Client reactivated', 'success');
      loadClients();
    } catch (err: any) {
      showToast(err.message || 'Failed to reactivate client', 'error');
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
      </div>

      <div className="filter-bar">
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

          {canDeactivate && (
            <label className="flex items-center gap-2 text-secondary" style={{ fontSize: '0.875rem', whiteSpace: 'nowrap', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                style={{ minHeight: 'unset', width: '1rem', height: '1rem', padding: 0 }}
              />
              Show inactive
            </label>
          )}

          <motion.button
            className="button primary"
            onClick={() => {
              if (isFormOpen || editingId) {
                resetForm();
                setIsFormOpen(false);
              } else {
                resetForm();
                setIsFormOpen(true);
              }
            }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", duration: 0.4, bounce: 0.2 }}
          >
            <Plus size={18} /> {isFormOpen || editingId ? 'Cancel' : 'Add Client'}
          </motion.button>
      </div>

      {error && <div className="page-error">{error}</div>}

      <AnimatePresence>
        {(isFormOpen || editingId) && (
          <motion.div
            initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
            animate={{ opacity: 1, height: 'auto', overflow: 'visible' }}
            exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
            transition={{ type: "spring", duration: 0.5, bounce: 0 }}
            className="section-card"
          >
            <div className="section-card-header">
              <h3 style={{ fontSize: '1.125rem' }}>{editingId ? 'Edit Client' : 'Create New Client'}</h3>
            </div>
            <form onSubmit={editingId ? handleUpdate : handleCreate} className="form-section">
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
                  {isSubmitting ? 'Saving...' : editingId ? 'Save Changes' : 'Save Client'}
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
          <table className="min-w-full divide-y divide-border">
            <thead>
              <tr>
                <th className="w-[35%] px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap align-middle">
                  Client
                </th>
                <th className="w-[30%] px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap align-middle">
                  Contact Info
                </th>
                <th className="w-[15%] px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap align-middle">
                  Status
                </th>
                <th className="w-[10%] px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap align-middle">
                  Created
                </th>
                {(canEdit || canDeactivate) && (
                  <th className="w-[10%] px-4 py-3 text-right text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap align-middle">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredClients.length > 0 ? (
                filteredClients.map((c) => {
                  const isInactive = !!c.deletedAt;
                  return (
                    <motion.tr
                      key={c.id}
                      variants={listItem}
                      className="cursor-pointer hover:bg-gray-50/80 dark:hover:bg-zinc-900/50 transition-colors"
                      style={isInactive ? { opacity: 0.6 } : undefined}
                    >
                      <td className="px-4 py-4 whitespace-nowrap align-middle">
                        <div className="flex items-center gap-3">
                          <div style={{ padding: '0.5rem', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                            <User size={16} className="text-secondary" />
                          </div>
                          <div>
                            <div className="font-medium" style={{ color: 'var(--color-text-primary)' }}>{c.name}</div>
                            <div className="text-muted" style={{ fontSize: '0.75rem', marginTop: '0.125rem' }}>ID: {c.id.split('-')[0]}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap align-middle">
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
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap align-middle">
                        <span className={`status-badge ${isInactive ? 'cancelled' : 'authorised'}`}>
                          {isInactive ? 'INACTIVE' : 'ACTIVE'}
                        </span>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap align-middle text-secondary" style={{ fontSize: '0.875rem' }}>
                        {new Date(c.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      {(canEdit || canDeactivate) && (
                        <td className="px-4 py-4 whitespace-nowrap align-middle text-right">
                          <div className="flex items-center gap-2" style={{ justifyContent: 'flex-end' }}>
                            {isInactive ? (
                              canDeactivate && (
                                <motion.button
                                  className="button secondary small"
                                  onClick={() => handleReactivate(c)}
                                  whileTap={{ scale: 0.95 }}
                                  title="Reactivate client"
                                >
                                  <RotateCcw size={14} /> Reactivate
                                </motion.button>
                              )
                            ) : (
                              <>
                                {canEdit && (
                                  <motion.button
                                    className="button secondary small"
                                    onClick={() => openEdit(c)}
                                    whileTap={{ scale: 0.95 }}
                                    title="Edit client"
                                  >
                                    <Edit size={14} /> Edit
                                  </motion.button>
                                )}
                                {canDeactivate && (
                                  <motion.button
                                    className="button danger small"
                                    onClick={() => handleDeactivate(c)}
                                    whileTap={{ scale: 0.95 }}
                                    title="Deactivate client"
                                  >
                                    <Trash2 size={14} />
                                  </motion.button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </motion.tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={(canEdit || canDeactivate) ? 5 : 4} className="px-4 py-10 text-center text-secondary">
                    <div className="empty-state" style={{ border: 'none', padding: 0 }}>
                      <div style={{ padding: '1rem', backgroundColor: 'var(--color-bg)', borderRadius: '50%', marginBottom: 'var(--space-md)' }}>
                        <User size={32} className="text-muted" />
                      </div>
                      <p className="font-medium text-primary" style={{ fontSize: '1.125rem', margin: '0 0 var(--space-xs) 0' }}>No clients found</p>
                      <p className="text-secondary" style={{ margin: 0, fontSize: '0.9375rem' }}>
                        {searchQuery ? "Try adjusting your search query." : "Add a client to get started."}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}