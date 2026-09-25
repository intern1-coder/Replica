import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Search, Plus, User, Mail, Phone, Building2, Edit, Trash2, RotateCcw, X, Save } from 'lucide-react';
import { motion } from 'motion/react';
import { DataTablePagination } from '../components/DataTablePagination';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const currentPage = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const pageSize = [10, 25, 50].includes(Number(searchParams.get('limit') ?? '10'))
    ? Number(searchParams.get('limit') ?? '10')
    : 10;

  const [searchQuery, setSearchQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canEdit = can('clients:edit');
  const canDeactivate = can('clients:delete');

  const syncUrlPagination = useCallback((nextPage: number, nextSize: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(nextPage));
    params.set('limit', String(nextSize));
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const hasPage = searchParams.has('page');
    const hasLimit = searchParams.has('limit');

    if (!hasPage || !hasLimit) {
      const params = new URLSearchParams(searchParams.toString());
      if (!hasPage) params.set('page', '1');
      if (!hasLimit) params.set('limit', '10');
      setSearchParams(params, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const loadClients = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(currentPage), limit: String(pageSize) });
      if (showInactive) params.set('includeInactive', 'true');
      if (searchQuery.trim()) params.set('q', searchQuery.trim());

      const response = await apiFetch(`/clients?${params.toString()}`);
      setClients(response.data || []);
      setTotalItems(response.meta?.total ?? 0);
      setTotalPages(response.meta?.totalPages ?? 1);
    } catch (err: any) {
      setError('Failed to load clients: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  }, [showInactive, currentPage, pageSize, searchQuery]);

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
    setError('');
    setName(c.name);
    setEmail(c.email || '');
    setPhone(c.phone || '');
    setEditingId(c.id);
    setShowForm(true);
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
      setShowForm(false);
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
      setShowForm(false);
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
    <>
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
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  syncUrlPagination(1, pageSize);
                }}
                className="search-input"
              />
            </div>

            {canDeactivate && (
              <label className="flex items-center gap-2 text-secondary" style={{ fontSize: '0.875rem', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => {
                    setShowInactive(e.target.checked);
                    syncUrlPagination(1, pageSize);
                  }}
                  style={{ minHeight: 'unset', width: '1rem', height: '1rem', padding: 0 }}
                />
                Show inactive
              </label>
            )}

            <motion.button
              className="button primary"
              onClick={() => {
                if (showForm) {
                  resetForm();
                  setShowForm(false);
                } else {
                  resetForm();
                  setShowForm(true);
                }
              }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", duration: 0.4, bounce: 0.2 }}
            >
              <Plus size={18} /> {showForm ? 'Cancel' : 'Add Client'}
            </motion.button>
        </div>

        {error && <div className="page-error">{error}</div>}

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
                              <User size={16} className="text-muted" />
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
                            {!c.email && !c.phone && (
                              <span className="text-muted" style={{ fontSize: '0.85rem' }}>No contact info</span>
                            )}
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
                          {searchQuery ? 'Try adjusting your search query.' : 'Add a client to get started.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <DataTablePagination
              currentPage={currentPage}
              totalPages={totalPages}
              totalItems={totalItems}
              pageSize={pageSize}
              onPageChange={(page) => syncUrlPagination(page, pageSize)}
              onPageSizeChange={(size) => {
                syncUrlPagination(1, size);
              }}
            />
          </div>
        )}
      </motion.div>

      {showForm && (
        <div className="modal-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-panel entering section-card w-full max-w-2xl rounded-2xl shadow-xl bg-white max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center" style={{ padding: 'var(--space-md)', borderBottom: '1px solid var(--color-border)' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{editingId ? 'Edit Client' : 'Create New Client'}</h2>
              <button onClick={() => { setShowForm(false); resetForm(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              {error && <div className="page-error">{error}</div>}
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
                <div className="flex justify-end gap-2" style={{ paddingTop: 'var(--space-md)' }}>
                  <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="button secondary" disabled={isSubmitting}>Cancel</button>
                  <button
                    type="submit"
                    className="button primary flex items-center gap-2"
                    disabled={isSubmitting}
                  >
                    <Save size={16} />
                    {isSubmitting ? 'Saving...' : editingId ? 'Save Changes' : 'Save Client'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}