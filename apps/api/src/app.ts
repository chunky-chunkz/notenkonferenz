import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import RedisStore from 'connect-redis';
import { sessionRedis } from './config/redis.js';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';

// Route imports
import { authRouter } from './routes/auth.routes.js';
import { itemsRouter } from './routes/items.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { jobsRouter } from './routes/jobs.routes.js';
import { filesRouter } from './routes/files.routes.js';
import { pdfRouter } from './routes/pdf.routes.js';

export const app = express();

// ─── Global Middleware ───────────────────────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session (Redis-backed)
const redisStore = new RedisStore({ client: sessionRedis });
app.use(session({
  store: redisStore,
  name: 'mcs_session',
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));

app.use(requestLogger);

// ─── Health Check ────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({ name: 'Mark Conference System API', status: 'ok' });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API Routes ──────────────────────────────────────────────────────────────

app.use('/api/auth', authRouter);
app.use('/api/items', itemsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/files', filesRouter);
app.use('/api/pdf', pdfRouter);

// ─── Error Handling ──────────────────────────────────────────────────────────

app.use(errorHandler);
