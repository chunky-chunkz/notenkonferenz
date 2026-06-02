import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { authApi } from '../lib/api';

interface User {
  id: number;
  email: string;
  role: string;
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  hasPkorgSession: boolean;
  activePkorgRole: { text: string; url: string } | null;
  pkorgRoles: { text: string; url: string }[];
  activePkorgFachrichtung: string | null;
  activePkorgRoleType: string | null;
  login: (email: string, password: string, twoFactorCode?: string) => Promise<void>;
  register: (email: string, password: string, passwordRepeat: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  isStaff: boolean;
  isAdmin: boolean;
  isVex: boolean;
  isExp: boolean;
  isCex: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasPkorgSession, setHasPkorgSession] = useState(false);
  const [activePkorgRole, setActivePkorgRole] = useState<{ text: string; url: string } | null>(null);
  const [pkorgRoles, setPkorgRoles] = useState<{ text: string; url: string }[]>([]);
  const [activePkorgFachrichtung, setActivePkorgFachrichtung] = useState<string | null>(null);
  const [activePkorgRoleType, setActivePkorgRoleType] = useState<string | null>(null);

  const applyMeData = (data: Awaited<ReturnType<typeof authApi.me>>) => {
    setUser(data.user);
    setHasPkorgSession(data.hasPkorgSession);
    setActivePkorgRole(data.activePkorgRole ?? null);
    setPkorgRoles(data.pkorgRoles ?? []);
    setActivePkorgFachrichtung(data.activePkorgFachrichtung ?? null);
    setActivePkorgRoleType((data as any).activePkorgRoleType ?? null);
  };

  const refreshMe = async () => {
    const data = await authApi.me();
    applyMeData(data);
  };

  useEffect(() => {
    authApi.me()
      .then(applyMeData)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string, twoFactorCode?: string) => {
    const data = await authApi.login({ email, password, twoFactorCode });
    setUser(data.user);
    // Apply PKOrg session data directly from the login response (avoids a race
    // condition where the /me call arrives before the session store write completes).
    if (data.hasPkorgSession !== undefined) {
      applyMeData(data as any);
    } else {
      try {
        await refreshMe();
      } catch {
        // ignore
      }
    }
  };

  const register = async (email: string, password: string, passwordRepeat: string) => {
    await authApi.register({ email, password, passwordRepeat });
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore
    } finally {
      setUser(null);
      setHasPkorgSession(false);
      setActivePkorgRole(null);
      setPkorgRoles([]);
      setActivePkorgFachrichtung(null);
      setActivePkorgRoleType(null);
    }
  };

  const effectiveRole = user?.role ?? '';

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        hasPkorgSession,
        activePkorgRole,
        pkorgRoles,
        activePkorgFachrichtung,
        activePkorgRoleType,
        login,
        register,
        logout,
        refreshMe,
        isStaff: effectiveRole === 'STAFF' || effectiveRole === 'ADMIN',
        isAdmin: effectiveRole === 'ADMIN',
        isVex: effectiveRole === 'VEX' || effectiveRole === 'STAFF' || effectiveRole === 'ADMIN',
        isExp: activePkorgRoleType === 'EXP',
        isCex: activePkorgRoleType === 'CEX',
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
