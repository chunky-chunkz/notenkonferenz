import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';

/**
 * Role hierarchy – higher index = more permissions.
 * A user may only switch to a role that is ≤ their real userRole.
 */
export const ROLE_HIERARCHY: string[] = ['USER', 'VEX', 'STAFF', 'ADMIN'];

export function getRoleLevel(role: string): number {
  const idx = ROLE_HIERARCHY.indexOf(role);
  return idx === -1 ? -1 : idx;
}

/** Returns the role that should be used for permission checks. */
export function effectiveRole(req: Request): string {
  return req.session.userRole ?? '';
}

/**
 * Extract the fachrichtung keyword from a PKOrg role text.
 *
 * Supported formats (PKOrg returns the second format via affiliations JSON):
 *   Old: "<type> <Berufsfeld> <Fachrichtung> <Land>"  e.g. "CEX Inf Api CH"   → "Api"
 *   New: "<Berufsfeld> <Fachrichtung> <Land> (<type>)" e.g. "Inf Api CH (CEX)" → "Api"
 *
 * Returns null if parsing fails (→ no filter applied).
 */
export function parsePkorgFachrichtung(roleText: string): string | null {
  const parts = roleText.trim().split(/\s+/);
  // New format: "Inf Api CH (CEX)" → last part has parens, fachrichtung is parts[1]
  if (parts.length >= 4 && parts[parts.length - 1].startsWith('(')) {
    return parts[1]; // e.g. "Api", "Platt"
  }
  // Old format: "CEX Inf Api CH" → fachrichtung is parts[2]
  if (parts.length >= 3) {
    return parts[2]; // e.g. "Api", "Platt", "Sysadmin"
  }
  return null;
}

/**
 * Extract the PKOrg role type keyword from a role text.
 * e.g. "Inf Api CH (CEX)" → "CEX"
 *      "CEX Inf Api CH"   → "CEX"
 */
export function parsePkorgRoleType(roleText: string): string | null {
  const parts = roleText.trim().split(/\s+/);
  // New format: last part is "(CEX)" — strip parens
  if (parts.length >= 2 && parts[parts.length - 1].startsWith('(')) {
    return parts[parts.length - 1].replace(/[()]/g, '');
  }
  // Old format: first part is the type
  if (parts.length >= 1) {
    return parts[0];
  }
  return null;
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
 * Require VEX, STAFF or ADMIN role.
 * VEX = Verfahrensexperte (external expert with limited access to their own candidates)
 */
export function requireVex(req: Request, _res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    next(new AppError(401, 'unauthorized', 'Authentication required'));
    return;
  }
  const role = effectiveRole(req);
  if (role !== 'VEX' && role !== 'STAFF' && role !== 'ADMIN') {
    next(new AppError(403, 'forbidden', 'VEX access required'));
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
  const role = effectiveRole(req);
  if (role !== 'STAFF' && role !== 'ADMIN') {
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
  const role = effectiveRole(req);
  if (role !== 'ADMIN') {
    next(new AppError(403, 'forbidden', 'Admin access required'));
    return;
  }
  next();
}
