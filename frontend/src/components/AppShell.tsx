import { useState, useEffect } from 'react';
import { Outlet, Navigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, LayoutDashboard, Users, Building2, ClipboardList, Calendar, ChevronDown, Bell, Search, Hexagon, Moon, Sun, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export function AppShell() {
  const { isAuthenticated, logout } = useAuth();
  const [userRole, setUserRole] = useState<string>('');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

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
    <div className="app-shell">
      {/* Detached Floating Sidebar */}
      <AnimatePresence initial={false}>
        {isSidebarOpen && (
          <motion.nav 
            className="sidebar"
            initial={{ width: 0, opacity: 0, marginLeft: -16 }}
            animate={{ width: 280, opacity: 1, marginLeft: 0 }}
            exit={{ width: 0, opacity: 0, marginLeft: -16 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}
          >
        <div className="sidebar-header" style={{ paddingBottom: '2rem' }}>
          <div className="flex items-center gap-3">
            <div style={{ backgroundColor: 'var(--color-brand)', padding: '6px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Hexagon size={24} color="var(--color-brand-text)" fill="var(--color-brand-text)" />
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.05em', color: 'var(--color-text-primary)' }}>affinity</div>
          </div>
        </div>

        {/* User Profile Switcher */}
        <div style={{ padding: '0 var(--space-md) var(--space-lg) var(--space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: '16px', cursor: 'pointer' }}>
            <div className="flex items-center gap-3">
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: '#f97316', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.9rem' }}>
                JD
              </div>
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.1 }}>John Doe</div>
                <div className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'capitalize', marginTop: '2px' }}>
                  {userRole ? userRole.toLowerCase() : 'Workspace'}
                </div>
              </div>
            </div>
            <ChevronDown size={16} className="text-muted" />
          </div>
        </div>
        
        <div className="sidebar-nav">
          <div style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Menu</div>
          <NavLink to="/" icon={<LayoutDashboard size={20} />} label="Overview" />
          <NavLink to="/jobs" icon={<ClipboardList size={20} />} label="Job Pipeline" />
          <NavLink to="/logistics" icon={<Calendar size={20} />} label="Logistics" />
          <NavLink to="/clients" icon={<Users size={20} />} label="Clients" />
          <NavLink to="/properties" icon={<Building2 size={20} />} label="Properties" />
          {(userRole === 'ADMIN' || userRole === 'OWNER') && (
            <>
              <div style={{ padding: '1.5rem 1rem 0.5rem 1rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Admin</div>
              <NavLink to="/team" icon={<Users size={20} />} label="Team Access" />
            </>
          )}
        </div>

        <div className="sidebar-footer" style={{ borderTop: 'none', padding: 'var(--space-md)' }}>
          <button onClick={logout} className="button secondary" style={{ width: '100%', justifyContent: 'flex-start', padding: '0.85rem 1rem', border: 'none', backgroundColor: 'transparent', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
            <LogOut size={20} /> Logout
          </button>
        </div>
      </motion.nav>
      )}
      </AnimatePresence>

      {/* Main Content Area */}
      <main className="main-content">
        {/* Top Navbar */}
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.5rem 2.5rem', backgroundColor: 'transparent', position: 'relative', zIndex: 10 }}>
          
          {/* Search Bar & Toggle */}
          <div className="flex items-center gap-4">
            <button 
              className="button secondary"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              style={{ padding: '8px', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', borderRadius: 'var(--radius-md)' }}
              title="Toggle Sidebar"
            >
              <Menu size={18} className="text-secondary" />
            </button>
            <div className="search-input-wrapper" style={{ maxWidth: '400px' }}>
              <Search size={18} />
              <input type="text" className="search-input" placeholder="Search everywhere..." style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }} />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
              className="button secondary" 
              onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
              style={{ padding: '8px', borderRadius: '50%', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}
              title="Toggle Theme"
            >
              {theme === 'dark' ? <Sun size={18} className="text-secondary" /> : <Moon size={18} className="text-secondary" />}
            </button>
            <button className="button secondary" style={{ padding: '8px', borderRadius: '50%', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)' }}>
              <Bell size={18} className="text-secondary" />
            </button>
            <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: '#f97316', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer' }}>
              JD
            </div>
          </div>
        </header>

        <div className="main-content-inner">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function NavLink({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  const location = useLocation();
  const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));

  return (
    <Link 
      to={to} 
      className={`sidebar-nav-link ${isActive ? 'active' : ''}`}
    >
      {icon} {label}
    </Link>
  );
}
