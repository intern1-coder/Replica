import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Outlet, Navigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../utils/api';
import { debounce } from '../utils/refetch';
import {
  LogOut,
  LayoutDashboard,
  Users,
  Building2,
  ClipboardList,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Menu,
  X,
  Moon,
  Sun,
  HardHat,
  Settings,
  KeyRound,
} from 'lucide-react';
import { NotificationCenter } from './NotificationCenter';
import { ChangePasswordModal } from './ChangePasswordModal';

const THEME_STORAGE_KEY = 'affinity_theme';
const SIDEBAR_COLLAPSED_KEY = 'affinity_sidebar_collapsed';
const MOBILE_NAV_BREAKPOINT = 1024;

function useMobileNav(): boolean {
  const [isMobileNav, setIsMobileNav] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width: ${MOBILE_NAV_BREAKPOINT}px)`).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_NAV_BREAKPOINT}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobileNav(e.matches);
    mq.addEventListener('change', onChange);
    setIsMobileNav(mq.matches);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobileNav;
}

function readStoredTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'dark' ? 'dark' : 'light';
}

function readSidebarCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
}

function getInitials(name: string | undefined): string {
  return (name ?? 'NA')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function AccountMenuPanel({
  displayName,
  userRole,
  onChangePassword,
  onLogout,
  className,
  showHeader = true,
}: {
  displayName: string;
  userRole: string;
  onChangePassword: () => void;
  onLogout: () => void;
  className?: string;
  showHeader?: boolean;
}) {
  return (
    <div className={className ?? 'user-menu-panel'} role="menu">
      {showHeader && (
        <div className="user-menu-header">
          <div className="font-medium" style={{ fontSize: '0.9rem' }}>{displayName}</div>
          <div className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'capitalize' }}>
            {userRole ? userRole.toLowerCase() : 'Workspace'}
          </div>
        </div>
      )}
      <button type="button" role="menuitem" className="user-menu-item" onClick={onChangePassword}>
        <KeyRound size={16} /> Change password
      </button>
      <button type="button" role="menuitem" className="user-menu-item" onClick={onLogout}>
        <LogOut size={16} /> Logout
      </button>
    </div>
  );
}

export function AppShell() {
  const { isAuthenticated, logout, user, can, socket } = useAuth();
  const location = useLocation();
  const [theme, setTheme] = useState<'light' | 'dark'>(readStoredTheme);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readSidebarCollapsed);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isMobileNav = useMobileNav();
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [headerUserMenuOpen, setHeaderUserMenuOpen] = useState(false);
  const [sidebarUserMenuOpen, setSidebarUserMenuOpen] = useState(false);
  const headerUserMenuRef = useRef<HTMLDivElement>(null);
  const sidebarUserMenuRef = useRef<HTMLDivElement>(null);

  const userRole = user?.role ?? '';
  const displayName = user?.name ?? 'Workspace';
  const initials = getInitials(user?.name);
  const isDashboard = location.pathname === '/';
  const isWide = location.pathname === '/team' || location.pathname === '/engineers';
  const canUsersView = can('users:view');
  const canEngineersView = can('engineers:view');

  const [activeJobCount, setActiveJobCount] = useState<number | null>(null);

  const loadActiveJobCount = useCallback(async () => {
    try {
      const data = await apiFetch('/jobs/counts');
      setActiveJobCount(data.byTab.active);
    } catch {
      // Badge is progressive enhancement — the nav works without it.
    }
  }, []);

  const debouncedCountRefresh = useMemo(
    () => debounce(() => loadActiveJobCount(), 300),
    [loadActiveJobCount]
  );

  useEffect(() => {
    if (!isAuthenticated) return;
    async function initBadge() {
      await loadActiveJobCount();
    }
    initBadge();
  }, [isAuthenticated, loadActiveJobCount]);

  useEffect(() => {
    if (!socket) return;
    const handleJobChange = () => debouncedCountRefresh();
    socket.on('job:statusChanged', handleJobChange);
    socket.on('job:created', handleJobChange);
    socket.on('job:deleted', handleJobChange);
    return () => {
      socket.off('job:statusChanged', handleJobChange);
      socket.off('job:created', handleJobChange);
      socket.off('job:deleted', handleJobChange);
    };
  }, [socket, debouncedCountRefresh]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!isMobileNav) {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(isSidebarCollapsed));
    }
  }, [isSidebarCollapsed, isMobileNav]);

  useEffect(() => {
    if (isMobileNav) setMobileNavOpen(false);
  }, [isMobileNav]);

  // Mobile drawer: close whenever the route changes
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    document.body.classList.add('mobile-nav-open');
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.classList.remove('mobile-nav-open');
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileNavOpen]);

  const closeAllUserMenus = useCallback(() => {
    setHeaderUserMenuOpen(false);
    setSidebarUserMenuOpen(false);
  }, []);

  const openChangePassword = useCallback(() => {
    setChangePwOpen(true);
    closeAllUserMenus();
  }, [closeAllUserMenus]);

  const handleLogout = useCallback(() => {
    logout();
    closeAllUserMenus();
  }, [logout, closeAllUserMenus]);

  const toggleHeaderUserMenu = useCallback(() => {
    setHeaderUserMenuOpen((open) => {
      if (!open) setSidebarUserMenuOpen(false);
      return !open;
    });
  }, []);

  const toggleSidebarUserMenu = useCallback(() => {
    setSidebarUserMenuOpen((open) => {
      if (!open) setHeaderUserMenuOpen(false);
      return !open;
    });
  }, []);

  useEffect(() => {
    if (!headerUserMenuOpen && !sidebarUserMenuOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inHeader = headerUserMenuRef.current?.contains(target);
      const inSidebar = sidebarUserMenuRef.current?.contains(target);
      if (!inHeader && !inSidebar) closeAllUserMenus();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAllUserMenus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [headerUserMenuOpen, sidebarUserMenuOpen, closeAllUserMenus]);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const sidebarCollapsed = isMobileNav ? false : isSidebarCollapsed;

  const sidebarClass = [
    'sidebar',
    sidebarCollapsed ? 'sidebar--collapsed' : '',
    mobileNavOpen ? 'sidebar--open' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="app-shell">
      {mobileNavOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}
      <nav className={sidebarClass} aria-label="Main navigation">
        <div className="sidebar-top">
          <div className="sidebar-header">
            <div className="sidebar-brand">
              <div className="sidebar-brand-mark">
                <img src="/logo.png" alt="" className="sidebar-brand-logo" />
              </div>
              <div className="sidebar-brand-name">Affinity</div>
            </div>
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={() => setIsSidebarCollapsed((c) => !c)}
              aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isSidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
            <button
              type="button"
              className="sidebar-close-btn"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close menu"
            >
              <X size={20} />
            </button>
          </div>

          <div className="sidebar-user-menu" ref={sidebarUserMenuRef}>
            <button
              type="button"
              className="sidebar-user-menu-trigger"
              onClick={toggleSidebarUserMenu}
              aria-haspopup="menu"
              aria-expanded={sidebarUserMenuOpen}
              aria-label="Account menu"
              title={displayName}
            >
              <span className="flex items-center gap-3">
                <span className="user-avatar">{initials}</span>
                <span className="sidebar-user-menu-text">
                  <span className="sidebar-user-menu-name">{displayName}</span>
                  <span className="sidebar-user-menu-role text-muted">
                    {userRole ? userRole.toLowerCase() : 'Workspace'}
                  </span>
                </span>
              </span>
              <ChevronDown
                size={16}
                className={`text-muted sidebar-user-menu-chevron${sidebarUserMenuOpen ? ' sidebar-user-menu-chevron-open' : ''}`}
              />
            </button>
            {sidebarUserMenuOpen && (
              <AccountMenuPanel
                className="user-menu-panel sidebar-user-menu-panel"
                displayName={displayName}
                userRole={userRole}
                onChangePassword={openChangePassword}
                onLogout={handleLogout}
                showHeader={false}
              />
            )}
          </div>
        </div>

        <div className="sidebar-nav">
          <div className="sidebar-section-label">Menu</div>
          <NavLink collapsed={sidebarCollapsed} to="/" icon={<LayoutDashboard size={20} />} label="Overview" />
          <NavLink collapsed={sidebarCollapsed} to="/jobs" icon={<ClipboardList size={20} />} label="Job Pipeline" badge={isAuthenticated ? activeJobCount : null} />
          <NavLink collapsed={sidebarCollapsed} to="/logistics" icon={<Calendar size={20} />} label="Logistics" />
          <NavLink collapsed={sidebarCollapsed} to="/clients" icon={<Users size={20} />} label="Clients" />
          <NavLink collapsed={sidebarCollapsed} to="/properties" icon={<Building2 size={20} />} label="Properties" />
          {canEngineersView && (
            <>
              <div className="sidebar-section-label sidebar-section-label--group">Team</div>
              <NavLink collapsed={sidebarCollapsed} to="/engineers" icon={<HardHat size={20} />} label="Engineers" />
            </>
          )}
          {(canUsersView || can('settings:edit')) && (
            <>
              <div className="sidebar-section-label sidebar-section-label--group">Admin</div>
              {canUsersView && (
                <NavLink collapsed={sidebarCollapsed} to="/team" icon={<Users size={20} />} label="Team Access" />
              )}
              {can('settings:edit') && (
                <NavLink collapsed={sidebarCollapsed} to="/settings" icon={<Settings size={20} />} label="Settings" />
              )}
            </>
          )}
        </div>
      </nav>

      <main className="main-content">
        <header className="app-header">
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileNavOpen}
          >
            <Menu size={22} />
          </button>
          <div className="search-input-wrapper app-header-search">
            <Search size={18} />
            <input
              type="text"
              className="search-input"
              placeholder="Search everywhere..."
            />
          </div>

          <div className="app-header-actions">
            <button
              type="button"
              className="button secondary app-header-icon-btn"
              onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
              title="Toggle theme"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun size={18} className="text-secondary" /> : <Moon size={18} className="text-secondary" />}
            </button>
            <NotificationCenter />

            <div className="user-menu" ref={headerUserMenuRef}>
              <button
                type="button"
                className="user-menu-trigger"
                onClick={toggleHeaderUserMenu}
                aria-haspopup="menu"
                aria-expanded={headerUserMenuOpen}
                aria-label="Account menu"
              >
                <span className="user-avatar">{initials}</span>
              </button>
              {headerUserMenuOpen && (
                <AccountMenuPanel
                  displayName={displayName}
                  userRole={userRole}
                  onChangePassword={openChangePassword}
                  onLogout={handleLogout}
                />
              )}
            </div>
          </div>
        </header>

        <div className={`main-content-inner${isDashboard ? ' main-content-inner--dashboard' : ''}${isWide ? ' main-content-inner--wide' : ''}`}>
          <Outlet />
        </div>
      </main>

      {changePwOpen && <ChangePasswordModal onClose={() => setChangePwOpen(false)} />}
    </div>
  );
}

function NavLink({
  to,
  icon,
  label,
  collapsed,
  badge,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  badge?: number | null;
}) {
  const location = useLocation();
  const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));

  return (
    <Link
      to={to}
      className={`sidebar-nav-link ${isActive ? 'active' : ''}`}
      title={collapsed ? (badge != null ? `${label} (${badge})` : label) : undefined}
    >
      {icon}
      <span className="sidebar-nav-link-label">{label}</span>
      {badge != null && !collapsed && (
        <span className="sidebar-nav-badge">{badge}</span>
      )}
    </Link>
  );
}
