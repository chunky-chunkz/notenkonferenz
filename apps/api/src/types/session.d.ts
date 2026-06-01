import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    userRole?: string;
    pkorgCookies?: Record<string, string>;
    lastPkorgPing?: string;
    hasPkorgSession?: boolean;
    pkorgRoles?: Array<{ text: string; url: string }>;
    /** null means no active role selected */
    activePkorgRole?: { text: string; url: string } | null;
    /** null means no filter — show all fachrichtungen */
    activePkorgFachrichtung?: string | null;
    /** null means role type could not be parsed */
    activePkorgRoleType?: string | null;
  }
}
