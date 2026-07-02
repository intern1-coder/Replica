import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { apiFetch } from '../utils/api';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [forgotSent, setForgotSent] = useState(false);
  const [isForgotSubmitting, setIsForgotSubmitting] = useState(false);
  const { login, isLoading, isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Email and password are required');
      return;
    }

    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email) {
      setError('Enter your email address to reset your password.');
      return;
    }
    setIsForgotSubmitting(true);
    try {
      await apiFetch('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setForgotSent(true);
    } catch (err: any) {
      setError(err.message || 'Failed to send reset link.');
    } finally {
      setIsForgotSubmitting(false);
    }
  };

  if (mode === 'forgot') {
    return (
      <div className="app-shell items-center" style={{ justifyContent: 'center' }}>
        <div className="section-card page-enter" style={{ width: '100%', maxWidth: '400px', margin: 0 }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 'var(--space-lg)', textAlign: 'center' }}>
            Reset your password
          </h1>

          {error && (
            <div className="page-error" style={{ padding: 'var(--space-sm)' }}>{error}</div>
          )}

          {forgotSent ? (
            <div className="form-section">
              <p className="text-secondary" style={{ textAlign: 'center' }}>
                If an account exists for that email, a password reset link has been sent.
              </p>
              <button
                type="button"
                className="button primary"
                style={{ width: '100%' }}
                onClick={() => { setMode('login'); setForgotSent(false); setError(''); }}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgot} className="form-section">
              <div className="form-row">
                <label htmlFor="forgot-email" className="form-label">Email Address</label>
                <input
                  id="forgot-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@affinity.local"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="form-actions" style={{ borderTop: 'none', paddingTop: 0, marginTop: 'var(--space-xs)' }}>
                <button type="submit" className="button primary" style={{ width: '100%' }} disabled={isForgotSubmitting}>
                  {isForgotSubmitting ? 'Sending…' : 'Send reset link'}
                </button>
              </div>
              <p style={{ textAlign: 'center', marginTop: 'var(--space-sm)' }}>
                <button
                  type="button"
                  className="link-button text-secondary"
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                  onClick={() => { setMode('login'); setError(''); }}
                >
                  Back to sign in
                </button>
              </p>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell items-center" style={{ justifyContent: 'center' }}>
      <div className="section-card page-enter" style={{ width: '100%', maxWidth: '400px', margin: 0 }}>
        
        <h1 style={{ fontSize: '1.5rem', marginBottom: 'var(--space-lg)', textAlign: 'center' }}>Affinity Workspace</h1>
        
        {error && (
          <div className="page-error" style={{ padding: 'var(--space-sm)' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="form-section">
          <div className="form-row">
            <label htmlFor="email" className="form-label">Email Address</label>
            <input 
              id="email"
              type="email" 
              value={email} 
              onChange={e => setEmail(e.target.value)}
              placeholder="you@affinity.local"
              autoComplete="email"
              required
            />
          </div>
          
          <div className="form-row">
            <label htmlFor="password" className="form-label">Password</label>
            <input 
              id="password"
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          <div className="form-actions" style={{ borderTop: 'none', paddingTop: 0, marginTop: 'var(--space-xs)' }}>
            <button
              type="submit"
              className="button primary"
              style={{ width: '100%' }}
              disabled={isLoading}
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
          <p style={{ textAlign: 'center', marginTop: 'var(--space-sm)' }}>
            <button
              type="button"
              className="link-button text-secondary"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}
              onClick={() => { setMode('forgot'); setError(''); }}
            >
              Forgot password?
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
