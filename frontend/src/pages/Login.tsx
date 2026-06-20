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
    <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-color)' }}>
      <div style={{ background: 'var(--surface-color)', padding: 'var(--spacing-xl)', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)', width: '100%', maxWidth: '400px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
        
        <h1 style={{ fontSize: '1.5rem', marginBottom: 'var(--spacing-md)', textAlign: 'center' }}>Affinity Workspace</h1>
        
        {error && (
          <div style={{ padding: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)', backgroundColor: '#ffe3e3', color: 'var(--status-cancelled-text)', borderRadius: 'var(--border-radius)', fontSize: '0.9rem', textAlign: 'center' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <div>
            <label htmlFor="email" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 'var(--spacing-xs)' }}>Email Address</label>
            <input 
              id="email"
              type="email" 
              value={email} 
              onChange={e => setEmail(e.target.value)}
              placeholder="you@affinity.local"
              style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)' }}
              autoComplete="email"
              required
            />
          </div>
          
          <div>
            <label htmlFor="password" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 'var(--spacing-xs)' }}>Password</label>
            <input 
              id="password"
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)' }}
              autoComplete="current-password"
              required
            />
          </div>

          <button 
            type="submit" 
            className="primary" 
            style={{ marginTop: 'var(--spacing-sm)', width: '100%', padding: '0.75rem' }}
            disabled={isLoading}
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
