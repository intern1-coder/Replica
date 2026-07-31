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

async function fetchSession(authToken: string): Promise<{ status: number; data?: any }> {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) {
      return { status: res.status };
    }
    const data = await res.json();
    return { status: res.status, data };
  } catch {
    return { status: 0 };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('affinity_token'));
  const [isLoading, setIsLoading] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});

  const isAuthenticated = !!token;

  const logout = useCallback(() => {
    setToken(null);
  }, []);

  const loadSession = useCallback(async (authToken: string) => {
    let result = await fetchSession(authToken);

    // Retry once on transient server/network errors
    if (result.status !== 401 && result.status !== 200) {
      await new Promise((r) => setTimeout(r, 1500));
      result = await fetchSession(authToken);
    }

    if (result.status === 401) {
      throw Object.assign(new Error('Session expired'), { status: 401 });
    }
    if (result.status !== 200 || !result.data) {
      throw Object.assign(new Error('Failed to load session'), { status: result.status });
    }

    setUser(result.data.user ?? null);
    setPermissions(result.data.permissions ?? {});
    return result.data;
  }, []);

  useEffect(() => {
    const onUnauthorized = () => logout();
    window.addEventListener('affinity:unauthorized', onUnauthorized);
    return () => window.removeEventListener('affinity:unauthorized', onUnauthorized);
  }, [logout]);

  useEffect(() => {
    if (token) {
      localStorage.setItem('affinity_token', token);

      loadSession(token).catch((err: any) => {
        if (err?.status === 401) {
          setToken(null);
        }
      });

      const newSocket = io(SOCKET_URL, {
        auth: { token }
      });
      const onPermissionsChanged = () => {
        loadSession(token).catch((err: any) => {
          if (err?.status === 401) setToken(null);
        });
      };
      newSocket.on('user:permissionsChanged', onPermissionsChanged);

      // The server rejects the handshake when the JWT is missing/expired.
      // Reconnecting with the same token can never succeed — stop retrying
      // and drop the session instead of spamming failed polling requests.
      const onConnectError = (err: Error) => {
        if (/auth|token/i.test(err.message)) {
          newSocket.disconnect();
          setToken(null);
        }
      };
      newSocket.on('connect_error', onConnectError);

      setSocket(newSocket);

      return () => {
        newSocket.off('connect_error', onConnectError);
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
