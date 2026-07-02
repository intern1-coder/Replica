import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { API_BASE, SOCKET_URL } from '../config';

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  canAuthorizeJobs: boolean;
}

interface AuthContextType {
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
  socket: Socket | null;
  user: AuthUser | null;
  permissions: Record<string, boolean>;
  /** Returns true if the current member has the given `resource:action` permission. */
  can: (key: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);


export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('affinity_token'));
  const [isLoading, setIsLoading] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});

  const isAuthenticated = !!token;

  const loadSession = useCallback(async (authToken: string) => {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) throw new Error('Failed to load session');
    const data = await res.json();
    setUser(data.user ?? null);
    setPermissions(data.permissions ?? {});
    return data;
  }, []);

  useEffect(() => {
    if (token) {
      localStorage.setItem('affinity_token', token);

      loadSession(token).catch(() => {
        setToken(null);
      });

      const newSocket = io(SOCKET_URL, {
        auth: { token }
      });
      const onPermissionsChanged = () => {
        loadSession(token).catch(() => setToken(null));
      };
      newSocket.on('user:permissionsChanged', onPermissionsChanged);

      setSocket(newSocket);

      return () => {
        newSocket.off('user:permissionsChanged', onPermissionsChanged);
        newSocket.disconnect();
      };
    } else {
      localStorage.removeItem('affinity_token');
      setUser(null);
      setPermissions({});
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
    }
  }, [token, loadSession]);

  const can = (key: string) => !!permissions[key];

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.message || 'Failed to login');
      }
      
      if (data.token) {
        setToken(data.token);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    setToken(null);
  };

  return (
    <AuthContext.Provider value={{ token, isAuthenticated, login, logout, isLoading, socket, user, permissions, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
