import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { Edit, Trash2, Plus, X, Save, Clock } from 'lucide-react';
import { EngineerTimesheetModal } from '../components/EngineerTimesheetModal';
import { motion } from 'motion/react';

// API shape — hourlyRate comes back as a Prisma Decimal (string) or number.
interface Engineer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  hourlyRate: string | number | null;
}

// All strings so controlled inputs never receive null/undefined values.
interface EngineerForm {
  name: string;
  phone: string;
  email: string;
  hourlyRate: string;
}

const emptyForm: EngineerForm = { name: '', phone: '', email: '', hourlyRate: '' };

export function Engineers() {
  const [engineers, setEngineers] = useState<Engineer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EngineerForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [timesheetFor, setTimesheetFor] = useState<Engineer | null>(null);

  const load = async () => {
    try {
      const data = await apiFetch('/engineers');
      setEngineers(data);
    } catch {
      setError('Failed to load engineers.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (eng: Engineer) => {
    setEditingId(eng.id);
    setForm({
      name: eng.name,
      phone: eng.phone || '',
      email: eng.email || '',
      hourlyRate: eng.hourlyRate != null ? String(eng.hourlyRate) : '',
    });
    setFormError('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setFormError('Name is required.');
      return;
    }
    setIsSaving(true);
    setFormError('');
    try {
      const payload: any = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        hourlyRate: form.hourlyRate ? form.hourlyRate : null,
      };
      if (editingId) {
        const updated = await apiFetch(`/engineers/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setEngineers((prev) => prev.map((e) => (e.id === editingId ? updated : e)));
      } else {
        const created = await apiFetch('/engineers', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setEngineers((prev) => [...prev, created]);
      }
      setShowForm(false);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save engineer.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!confirm('Deactivate this engineer? They will no longer appear in assignment pickers.')) return;
    try {
      // DELETE is a soft-delete (sets deletedAt) — historical work logs are preserved.
      await apiFetch(`/engineers/${id}`, { method: 'DELETE' });
      setEngineers((prev) => prev.filter((e) => e.id !== id));
    } catch (err: any) {
      alert(err.message || 'Failed to deactivate engineer.');
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Engineers</h1>
        <button onClick={openAdd} className="button primary flex items-center gap-2">
          <Plus size={16} /> Add Engineer
        </button>
      </div>

      {error && <div className="page-error">{error}</div>}

      <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
        {isLoading ? (
          <p style={{ padding: 'var(--space-md)' }}>Loading…</p>
        ) : (
          <>
            <table className="min-w-full divide-y divide-border">
              <thead>
                <tr>
                  <th className="w-[35%] px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap align-middle">
                    Name
                  </th>
                  <th className="w-[20%] px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap align-middle">
                    Phone
                  </th>
                  <th className="w-[20%] px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap align-middle">
                    Email
                  </th>
                  <th className="w-[15%] px-4 py-3 text-right text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap align-middle">
                    Hourly Rate
                  </th>
                  <th className="w-[10%] px-4 py-3 text-right text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap align-middle">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {engineers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-secondary">
                      <div className="empty-state">
                        <div style={{ padding: '1rem', backgroundColor: 'var(--color-bg)', borderRadius: '50%', marginBottom: 'var(--space-md)' }}>
                          <Plus size={32} className="text-muted" />
                        </div>
                        <p className="font-medium text-primary" style={{ fontSize: '1.125rem', margin: '0 0 var(--space-xs) 0' }}>No engineers yet</p>
                        <p className="text-secondary" style={{ margin: 0, fontSize: '0.9375rem' }}>
                          Click "Add Engineer" to get started.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  engineers.map((eng) => (
                    <motion.tr
                      key={eng.id}
                      className="cursor-pointer hover:bg-gray-50/80 dark:hover:bg-zinc-900/50 transition-colors"
                    >
                      <td className="px-4 py-4 whitespace-nowrap align-middle">
                        <div className="font-medium">{eng.name}</div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap align-middle">
                        <span className="text-secondary">{eng.phone || '—'}</span>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap align-middle">
                        <span className="text-secondary" title={eng.email || ''}>{eng.email || '—'}</span>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap align-middle text-right tabular-nums">
                        {eng.hourlyRate != null ? `£${Number(eng.hourlyRate).toFixed(2)}/hr` : '—'}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap align-middle text-right">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setTimesheetFor(eng)} className="button secondary small flex items-center gap-1">
                            <Clock size={12} /> Timesheet
                          </button>
                          <button onClick={() => openEdit(eng)} className="button secondary small flex items-center gap-1">
                            <Edit size={12} /> Edit
                          </button>
                        </div>
                        <button onClick={() => handleDeactivate(eng.id)} className="button danger small flex items-center gap-1 mt-2 w-full">
                          <Trash2 size={12} /> Deactivate
                        </button>
                      </td>
                    </motion.tr>
                  ))
                )}
              </tbody>
            </table>
          </>
        )}
      </div>

      {showForm && (
        <div className="modal-backdrop entering" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="modal-panel entering section-card" style={{ width: '420px', maxWidth: '90vw', padding: 0 }}>
            <div className="flex justify-between items-center" style={{ padding: 'var(--space-md)', borderBottom: '1px solid var(--color-border)' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{editingId ? 'Edit Engineer' : 'Add Engineer'}</h2>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
              {formError && <div className="page-error">{formError}</div>}
              <div className="form-row">
                <label className="form-label">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  style={{ width: '100%' }}
                  placeholder="e.g. John Smith"
                  disabled={isSaving}
                />
              </div>
              <div className="form-row">
                <label className="form-label">Phone</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  style={{ width: '100%' }}
                  placeholder="e.g. 07700 900000"
                  disabled={isSaving}
                />
              </div>
              <div className="form-row">
                <label className="form-label">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  style={{ width: '100%' }}
                  placeholder="e.g. john@example.com"
                  disabled={isSaving}
                />
              </div>
              <div className="form-row">
                <label className="form-label">Hourly Rate (£)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.hourlyRate}
                  onChange={(e) => setForm((f) => ({ ...f, hourlyRate: e.target.value }))}
                  style={{ width: '120px' }}
                  placeholder="e.g. 35.00"
                  disabled={isSaving}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2" style={{ padding: 'var(--space-md)', borderTop: '1px solid var(--color-border)' }}>
              <button onClick={() => setShowForm(false)} className="button secondary" disabled={isSaving}>Cancel</button>
              <button onClick={handleSave} className="button primary flex items-center gap-2" disabled={isSaving}>
                <Save size={16} />
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {timesheetFor && (
        <EngineerTimesheetModal engineer={timesheetFor} onClose={() => setTimesheetFor(null)} />
      )}
    </div>
  );
}