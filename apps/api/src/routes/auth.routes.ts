import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { requireAuth, getRoleLevel, parsePkorgFachrichtung, parsePkorgRoleType } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../config/logger.js';
import { pkorgLogin, pkorgGetRoles } from '../services/pkorg/pkorgClient.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  twoFactorCode: z.string().optional(),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  passwordRepeat: z.string().min(6),
}).refine((data) => data.password === data.passwordRepeat, {
  message: 'Passwords do not match',
  path: ['passwordRepeat'],
});

export const authRouter = Router();

// ─── POST /api/auth/login ────────────────────────────────────────────────────
authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, twoFactorCode } = loginSchema.parse(req.body);

    // PKOrg 2FA login path
    if (twoFactorCode) {
      try {
        const pkorgCookies = await pkorgLogin(email, password, twoFactorCode);

        // Fetch PKOrg roles immediately so we can persist fachrichtung to the user record
        let roles: { text: string; url: string }[] = [];
        try {
          roles = await pkorgGetRoles(pkorgCookies);
        } catch (e) {
          logger.warn('Could not fetch PKOrg roles during login', { error: (e as Error).message });
        }

        // Pick best role: prefer CEX, then first available
        const firstRole = roles[0] ?? null;
        const fachrichtung = firstRole ? parsePkorgFachrichtung(firstRole.text) : null;
        const roleType = firstRole ? parsePkorgRoleType(firstRole.text) : null;

        // Create or find user — always ensure ADMIN role for successful PKOrg logins
        let user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          const hashedPassword = await bcrypt.hash(password, 12);
          user = await prisma.user.create({
            data: {
              email,
              password: hashedPassword,
              role: 'ADMIN',
              pkorgFachrichtung: fachrichtung,
              pkorgRoleType: roleType,
              pkorgRoleText: firstRole?.text ?? null,
            },
          });
        } else {
          // Update PKOrg affiliation and upgrade role if needed
          user = await prisma.user.update({
            where: { id: user.id },
            data: {
              ...(user.role === 'USER' ? { role: 'ADMIN' as const } : {}),
              pkorgFachrichtung: fachrichtung,
              pkorgRoleType: roleType,
              pkorgRoleText: firstRole?.text ?? null,
            },
          });
          if (user.role === 'ADMIN') {
            logger.info('User PKOrg affiliation updated', { email, fachrichtung, roleType });
          }
        }

        req.session.userId = user.id;
        req.session.userRole = user.role;
        req.session.pkorgCookies = pkorgCookies;
        req.session.hasPkorgSession = true;
        req.session.lastPkorgPing = new Date().toISOString();
        req.session.pkorgRoles = roles;
        req.session.activePkorgRole = firstRole ?? undefined;
        req.session.activePkorgFachrichtung = fachrichtung;
        req.session.activePkorgRoleType = roleType ?? undefined;

        res.json({
          user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt.toISOString() },
        });
        return;
      } catch (err) {
        logger.warn('PKOrg 2FA login failed', { email, error: (err as Error).message });
        throw new AppError(401, 'auth_failed', '2FA authentication failed');
      }
    }

    // Local login path
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, role: true, password: true, createdAt: true, pkorgFachrichtung: true, pkorgRoleType: true, pkorgRoleText: true },
    });
    if (!user) {
      throw new AppError(401, 'auth_failed', 'Invalid email or password');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new AppError(401, 'auth_failed', 'Invalid email or password');
    }

    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.hasPkorgSession = false;
    // Restore persisted PKOrg affiliation so the fachrichtung filter works immediately
    if (user.pkorgFachrichtung) {
      req.session.activePkorgFachrichtung = user.pkorgFachrichtung;
    }
    if (user.pkorgRoleType) {
      req.session.activePkorgRoleType = user.pkorgRoleType;
    }
    if (user.pkorgRoleText) {
      req.session.activePkorgRole = { text: user.pkorgRoleText, url: '#' };
    }

    res.json({
      user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt.toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/register ─────────────────────────────────────────────────
authRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError(409, 'user_exists', 'A user with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, role: 'USER' },
    });

    res.status(201).json({
      user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt.toISOString() },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/auth/logout ───────────────────────────────────────────────────
authRouter.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.clearCookie('mcs_session');
    res.json({ status: 'ok' });
  });
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
authRouter.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { id: true, email: true, role: true, createdAt: true, pkorgFachrichtung: true, pkorgRoleType: true, pkorgRoleText: true },
    });

    if (!user) {
      throw new AppError(404, 'not_found', 'User not found');
    }

    res.json({
      user: {
        ...user,
        createdAt: user.createdAt.toISOString(),
      },
      hasPkorgSession: req.session.hasPkorgSession ?? false,
      activePkorgRole: req.session.activePkorgRole ?? null,
      pkorgRoles: req.session.pkorgRoles ?? [],
      activePkorgFachrichtung: req.session.activePkorgFachrichtung ?? null,
      activePkorgRoleType: req.session.activePkorgRoleType ?? null,
    });
  } catch (err) {
    next(err);
  }
});
