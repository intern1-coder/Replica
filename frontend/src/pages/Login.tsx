import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
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
        </form>
      </div>
    </div>
  );
}
