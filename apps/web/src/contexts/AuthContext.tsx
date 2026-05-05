import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { authApi } from '../lib/api';

interface User {
  id: number;
  email: string;
  role: 'USER' | 'STAFF' | 'ADMIN';
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  hasPkorgSession: boolean;
  login: (email: string, password: string, twoFactorCode?: string) => Promise<void>;
  register: (email: string, password: string, passwordRepeat: string) => Promise<void>;
  logout: () => Promise<void>;
  isStaff: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPkorgSession, setHasPkorgSession] = useState(false);

  useEffect(() => {
    authApi.me()
      .then((data) => {
        setUser(data.user);
        setHasPkorgSession(data.hasPkorgSession);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string, twoFactorCode?: string) => {
    const data = await authApi.login({ email, password, twoFactorCode });
    setUser(data.user);
    // After login, fetch full session info including PKOrg status
    try {
      const meData = await authApi.me();
      setHasPkorgSession(meData.hasPkorgSession);
    } catch {
      // ignore – user is already set
    }
  };

  const register = async (email: string, password: string, passwordRepeat: string) => {
    await authApi.register({ email, password, passwordRepeat });
  };

  const logout = async () => {
    // Always clear local state, even if the API call fails (e.g. server down)
    try {
      await authApi.logout();
    } catch {
      // ignore network errors on logout
    } finally {
      setUser(null);
      setHasPkorgSession(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        hasPkorgSession,
        login,
        register,
        logout,
        isStaff: user?.role === 'STAFF' || user?.role === 'ADMIN',
        isAdmin: user?.role === 'ADMIN',
      }}
    >
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
