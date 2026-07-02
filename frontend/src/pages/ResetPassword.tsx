import { useState } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/api';

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('This reset link is missing its token. Please request a new one.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiFetch('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="app-shell items-center" style={{ justifyContent: 'center' }}>
      <div className="section-card page-enter" style={{ width: '100%', maxWidth: '400px', margin: 0 }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 'var(--space-lg)', textAlign: 'center' }}>
          Set a new password
        </h1>

        {error && (
          <div className="page-error" style={{ padding: 'var(--space-sm)' }}>{error}</div>
        )}

        {done ? (
          <div className="form-section">
            <p className="text-secondary" style={{ textAlign: 'center' }}>
              Your password has been reset. Redirecting you to sign in…
            </p>
            <Link to="/login" className="button primary" style={{ width: '100%', justifyContent: 'center' }}>
              Go to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="form-section">
            <div className="form-row">
              <label htmlFor="password" className="form-label">New password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="form-row">
              <label htmlFor="confirm" className="form-label">Confirm new password</label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="form-actions" style={{ borderTop: 'none', paddingTop: 0, marginTop: 'var(--space-xs)' }}>
              <button type="submit" className="button primary" style={{ width: '100%' }} disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Reset password'}
              </button>
            </div>
            <p style={{ textAlign: 'center', marginTop: 'var(--space-sm)' }}>
              <Link to="/login" className="text-secondary">Back to sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
