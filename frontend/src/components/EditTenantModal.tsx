import { useState } from 'react';
import { apiFetch } from '../utils/api';
import { X } from 'lucide-react';

interface EditTenantModalProps {
  tenant: { id: string; name: string; phone?: string | null; email?: string | null };
  onClose: () => void;
  onSaved: (updated: { id: string; name: string; phone: string | null; email: string | null }) => void;
}

export function EditTenantModal({ tenant, onClose, onSaved }: EditTenantModalProps) {
  const [name, setName] = useState(tenant.name);
  const [phone, setPhone] = useState(tenant.phone || '');
  const [email, setEmail] = useState(tenant.email || '');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');
    try {
      const updated = await apiFetch(`/tenants/${tenant.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, phone: phone || null, email: email || null }),
      });
      onSaved(updated);
    } catch (err: any) {
      setError(err.message || 'Failed to save tenant');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop entering" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="modal-panel entering section-card" style={{ width: '420px', maxWidth: '90vw', padding: 0 }}>
        <div className="flex justify-between items-center" style={{ padding: 'var(--space-md)', borderBottom: '1px solid var(--color-border)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Edit Tenant</h3>
          <button onClick={onClose} type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSave}>
          <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            {error && <div className="page-error">{error}</div>}
            <div className="flex items-start gap-2" style={{ padding: '0.75rem', backgroundColor: 'var(--status-quoted-bg)', color: 'var(--status-quoted-text)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--status-quoted-border)', fontSize: '0.8rem', lineHeight: '1.4' }}>
              This updates the tenant record and refreshes the name/phone shown on this job. Other jobs for this tenant keep their own historical snapshot.
            </div>
            <div>
              <label className="form-label">Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label className="form-label">Phone</label>
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
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
