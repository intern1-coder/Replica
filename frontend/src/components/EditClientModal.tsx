import { useState } from 'react';
import { apiFetch } from '../utils/api';
import { X } from 'lucide-react';

interface EditClientModalProps {
  client: { id: string; name: string; email?: string | null; phone?: string | null };
  onClose: () => void;
  onSaved: (updated: { id: string; name: string; email: string | null; phone: string | null }) => void;
}

export function EditClientModal({ client, onClose, onSaved }: EditClientModalProps) {
  const [name, setName] = useState(client.name);
  const [email, setEmail] = useState(client.email || '');
  const [phone, setPhone] = useState(client.phone || '');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      const updated = await apiFetch(`/clients/${client.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, email: email || null, phone: phone || null }),
      });
      onSaved(updated);
    } catch (err: any) {
      setError(err.message || 'Failed to save client');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop entering" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-panel entering section-card" style={{ width: '420px', maxWidth: '90vw', padding: 0 }}>
        <div className="flex justify-between items-center" style={{ padding: 'var(--space-md)', borderBottom: '1px solid var(--color-border)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Edit Client</h3>
          <button onClick={onClose} type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSave}>
          <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {error && <div className="page-error">{error}</div>}
            <div>
              <label className="form-label">Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Phone</label>
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2" style={{ padding: 'var(--space-md)', borderTop: '1px solid var(--color-border)' }}>
            <button type="button" onClick={onClose} className="button secondary" disabled={isSaving}>Cancel</button>
            <button type="submit" className="button primary" disabled={isSaving}>{isSaving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
