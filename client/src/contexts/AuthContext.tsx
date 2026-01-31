import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../services/api';

interface User {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user';
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  loginWithOkta: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for token in URL (from SAML callback)
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('token');
    
    if (tokenFromUrl) {
      // Store the token and clean up URL
      localStorage.setItem('token', tokenFromUrl);
      api.setToken(tokenFromUrl);
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Fetch user info
      api.get<{ user: User }>('/auth/me')
        .then(data => setUser(data.user))
        .catch(() => {
          localStorage.removeItem('token');
          api.setToken(null);
        })
        .finally(() => setLoading(false));
      return;
    }
    
    // Check for existing session
    const token = localStorage.getItem('token');
    if (token) {
      api.setToken(token);
      api.get<{ user: User }>('/auth/me')
        .then(data => setUser(data.user))
        .catch(() => {
          localStorage.removeItem('token');
          api.setToken(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    const data = await api.post<{ token: string; user: User }>('/auth/login', { email, password });
    localStorage.setItem('token', data.token);
    api.setToken(data.token);
    setUser(data.user);
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // Ignore logout errors
    }
    localStorage.removeItem('token');
    api.setToken(null);
    setUser(null);
  };

  const register = async (email: string, password: string, name: string) => {
    await api.post('/auth/register', { email, password, name });
    // Auto-login after registration
    await login(email, password);
  };

  const loginWithOkta = () => {
    // Redirect to SAML login endpoint
    window.location.href = '/api/auth/saml/login';
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, register, loginWithOkta }}>
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
