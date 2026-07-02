import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { X } from 'lucide-react';

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) return setError('New password must be at least 8 characters.');
    if (newPassword !== confirm) return setError('Passwords do not match.');
    setSaving(true);
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setDone(true);
      setTimeout(() => {
        logout();
        navigate('/login');
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to change password');
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '6vh 1rem' }}
      onClick={onClose}
    >
      <div className="section-card" style={{ width: '100%', maxWidth: 420, margin: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-md)' }}>
          <h3 style={{ margin: 0 }}>Change password</h3>
          <button className="button secondary" onClick={onClose} style={{ padding: 6 }}><X size={18} /></button>
        </div>

        {error && <div className="page-error" style={{ padding: 'var(--space-sm)' }}>{error}</div>}

        {done ? (
          <div className="form-section">
            <p className="text-secondary">Your password has been changed.</p>
            <div className="form-actions"><button className="button primary" onClick={onClose}>Done</button></div>
          </div>
        ) : (
          <form onSubmit={submit} className="form-section">
            <div className="form-row">
              <label className="form-label">Current password</label>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
            </div>
            <div className="form-row">
              <label className="form-label">New password</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required />
            </div>
            <div className="form-row">
              <label className="form-label">Confirm new password</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
            </div>
            <div className="form-actions">
              <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Change password'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
