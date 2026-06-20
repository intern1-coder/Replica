import { useState, useEffect } from 'react';
import { Outlet, Navigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, LayoutDashboard, Users, Building2, ClipboardList, Calendar } from 'lucide-react';

export function AppShell() {
  const { isAuthenticated, logout } = useAuth();
  const [userRole, setUserRole] = useState<string>('');

  useEffect(() => {
    const token = localStorage.getItem('affinity_token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUserRole(payload.role);
      } catch (e) {}
    }
  }, []);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: 'var(--bg-color)' }}>
      {/* Sidebar Navigation */}
      <nav style={{ width: '240px', backgroundColor: '#343a40', color: 'white', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 'var(--spacing-md)', fontSize: '1.2rem', fontWeight: 600, borderBottom: '1px solid #495057' }}>
          Affinity
          {userRole && (
            <div style={{ fontSize: '0.75rem', fontWeight: 400, color: '#adb5bd', marginTop: '0.25rem', textTransform: 'capitalize' }}>
              Logged in as: {userRole.toLowerCase()}
            </div>
          )}
        </div>
        
        <div style={{ flex: 1, padding: 'var(--spacing-md) 0', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <NavLink to="/" icon={<LayoutDashboard size={18} />} label="Dashboard" />
          <NavLink to="/jobs" icon={<ClipboardList size={18} />} label="Jobs" />
          <NavLink to="/logistics" icon={<Calendar size={18} />} label="Logistics" />
          <NavLink to="/clients" icon={<Users size={18} />} label="Clients" />
          <NavLink to="/properties" icon={<Building2 size={18} />} label="Properties" />
        </div>

        <div style={{ padding: 'var(--spacing-md)', borderTop: '1px solid #495057' }}>
          <button 
            onClick={logout}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', backgroundColor: 'transparent', color: '#adb5bd', border: '1px solid #495057' }}
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main style={{ flex: 1, overflow: 'auto', padding: 'var(--spacing-lg)' }}>
        <Outlet />
      </main>
    </div>
  );
}

function NavLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link 
      to={to} 
      style={{ 
        display: 'flex', 
        alignItems: 'center', 
        gap: '0.75rem', 
        padding: '0.5rem var(--spacing-md)', 
        color: '#e9ecef', 
        textDecoration: 'none' 
      }}
    >
      {icon} {label}
    </Link>
  );
}
