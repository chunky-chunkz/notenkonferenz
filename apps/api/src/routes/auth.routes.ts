import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { logger } from '../config/logger.js';
import { pkorgLogin } from '../services/pkorg/pkorgClient.js';

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

        // Create or find user — always ensure ADMIN role for successful PKOrg logins
        let user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          const hashedPassword = await bcrypt.hash(password, 12);
          user = await prisma.user.create({
            data: { email, password: hashedPassword, role: 'ADMIN' },
          });
        } else if (user.role === 'USER') {
          // Upgrade pre-existing USER-role account to ADMIN on successful PKOrg auth
          user = await prisma.user.update({
            where: { id: user.id },
            data: { role: 'ADMIN' },
          });
          logger.info('User role upgraded to ADMIN via PKOrg login', { email });
        }

        req.session.userId = user.id;
        req.session.userRole = user.role;
        req.session.pkorgCookies = pkorgCookies;
        req.session.hasPkorgSession = true;
        req.session.lastPkorgPing = new Date().toISOString();

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
    const user = await prisma.user.findUnique({ where: { email } });
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
      select: { id: true, email: true, role: true, createdAt: true },
    });

    if (!user) {
      throw new AppError(404, 'not_found', 'User not found');
    }

    res.json({
      user: { ...user, createdAt: user.createdAt.toISOString() },
      hasPkorgSession: req.session.hasPkorgSession ?? false,
    });
  } catch (err) {
    next(err);
  }
});
