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

// Trust the first proxy (Render / nginx) so Express sees the real protocol and IP.
// Required for secure session cookies to work correctly behind a reverse proxy.
app.set('trust proxy', 1);

// ─── Global Middleware ───────────────────────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session store: Redis when REDIS_URL is set, MemoryStore otherwise.
// WARNING: MemoryStore is for single-instance demo use only — sessions are lost
// on restart and not shared across multiple instances. Set REDIS_URL in production.
let sessionStore: session.Store;
if (sessionRedis) {
  sessionStore = new RedisStore({ client: sessionRedis });
} else {
  console.warn(
    '\n⚠️  [Session] REDIS_URL is not set — using in-memory session store.\n' +
    '   Sessions will be lost on restart and are not shared across instances.\n' +
    '   Suitable for single-instance demo only. Set REDIS_URL for production.\n',
  );
  sessionStore = new session.MemoryStore();
}

app.use(session({
  store: sessionStore,
  name: 'mcs_session',
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
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
