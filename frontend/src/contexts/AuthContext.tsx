import { createContext, useContext, useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';

interface AuthContextType {
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
  socket: Socket | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_BASE = 'http://localhost:3000/api';
const SOCKET_URL = 'http://localhost:3000';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('affinity_token'));
  const [isLoading, setIsLoading] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);

  const isAuthenticated = !!token;

  useEffect(() => {
    if (token) {
      localStorage.setItem('affinity_token', token);
      
      const newSocket = io(SOCKET_URL, {
        auth: { token }
      });
      setSocket(newSocket);

      return () => {
        newSocket.disconnect();
      };
    } else {
      localStorage.removeItem('affinity_token');
      if (socket) {
        socket.disconnect();
        setSocket(null);
      }
    }
  }, [token]);

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
    <AuthContext.Provider value={{ token, isAuthenticated, login, logout, isLoading, socket }}>
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
