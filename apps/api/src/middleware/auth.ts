import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';

// Augment express-session to include our user data
declare module 'express-session' {
  interface SessionData {
    userId: number;
    userRole: string;
    pkorgCookies?: Record<string, string>;
    lastPkorgPing?: string;
    hasPkorgSession?: boolean;
  }
}

/**
 * Require an authenticated session. Sends 401 if not logged in.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    next(new AppError(401, 'unauthorized', 'Authentication required'));
    return;
  }
  next();
}

/**
 * Require STAFF or ADMIN role.
 */
export function requireStaff(req: Request, _res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    next(new AppError(401, 'unauthorized', 'Authentication required'));
    return;
  }
  if (req.session.userRole !== 'STAFF' && req.session.userRole !== 'ADMIN') {
    next(new AppError(403, 'forbidden', 'Staff access required'));
    return;
  }
  next();
}

/**
 * Require ADMIN role.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    next(new AppError(401, 'unauthorized', 'Authentication required'));
    return;
  }
  if (req.session.userRole !== 'ADMIN') {
    next(new AppError(403, 'forbidden', 'Admin access required'));
    return;
  }
  next();
}
