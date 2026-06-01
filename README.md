# Mark Conference System (Notenkonferenz-Tool)

Full-stack React + Node.js rebuild of the Django Notenkonferenz system.

## Architecture

```
mark-conference-system/
├── apps/
│   ├── api/          Express.js + TypeScript backend
│   │   ├── prisma/   Prisma schema & migrations
│   │   └── src/
│   │       ├── config/      env, logger, database, redis
│   │       ├── middleware/   auth, errorHandler, upload, requestLogger
│   │       ├── routes/      auth, items, admin, jobs, files
│   │       ├── services/    logService, queue, pkorg/pkorgClient
│   │       ├── worker.ts    BullMQ worker (imports & downloads)
│   │       ├── app.ts       Express app setup
│   │       └── index.ts     Server entry point
│   └── web/          React + Vite + TypeScript frontend
│       └── src/
│           ├── components/  AppLayout, Pagination
│           ├── contexts/    AuthContext
│           ├── lib/         api.ts (typed API client)
│           └── pages/       12 page components
├── packages/
│   └── shared/       Shared TypeScript types & constants
├── docker-compose.yml
└── package.json      Monorepo workspace root
```

### Tech Stack

| Layer      | Technology                                    |
|------------|-----------------------------------------------|
| Frontend   | React 18, Vite, TypeScript, Tailwind CSS      |
| State      | TanStack Query v5, React Context              |
| Backend    | Express.js 4, TypeScript, Zod validation      |
| ORM        | Prisma (MySQL)                                |
| Queue      | BullMQ + Redis                                |
| Auth       | Cookie sessions (express-session + Redis)     |
| External   | PKOrg integration via cheerio HTML scraping   |

## Quick Start

### Prerequisites

- Node.js 20+
- Docker & Docker Compose (for MySQL and Redis)

### Development Setup

```bash
# 1. Start infrastructure
docker compose up -d mysql redis

# 2. Install dependencies
npm install

# 3. Set up environment
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.example

# 4. Run database migrations & seed
npm run db:migrate:dev
npm run db:seed

# 5. Start dev servers (API on :3001, Web on :5173)
npm run dev
```

### Default Users

| Email              | Password   | Role  |
|--------------------|------------|-------|
| admin@example.com  | Admin123!  | ADMIN |
| staff@example.com  | Staff123!  | STAFF |

## Scripts

| Command               | Description                          |
|-----------------------|--------------------------------------|
| `npm run dev`         | Start API + Web in dev mode          |
| `npm run build`       | Build all packages                   |
| `npm run db:migrate:dev` | Run Prisma migrations (dev)       |
| `npm run db:seed`     | Seed database with default users     |
| `npm run db:studio`   | Open Prisma Studio                   |
| `npm run worker`      | Start BullMQ worker                  |

## Docker Deployment

```bash
# Build and start all services
docker compose up -d --build

# View logs
docker compose logs -f api worker
```

## API Endpoints

### Auth
- `POST /api/auth/login` – Login (supports 2FA via PKOrg)
- `POST /api/auth/register` – Register new user
- `POST /api/auth/logout` – Logout
- `GET  /api/auth/me` – Current user info

### Items (Notenübersicht)
- `GET  /api/items` – List with filters & pagination
- `GET  /api/items/my` – My assigned items
- `GET  /api/items/missing-grades` – Items without grades
- `GET  /api/items/:kandidatId` – Detail view
- `POST /api/items/collect` – Random assignment by grade range
- `POST /api/items/:kandidatId/validate` – Mark as validated
- `POST /api/items/:kandidatId/drop` – Release assignment
- `POST /api/items/:kandidatId/change` – Upload adjustment PDF
- `POST /api/items/:kandidatId/grade` – Save grade
- `GET  /api/items/dashboard/stats` – Dashboard statistics

### Admin (ADMIN role required)
- `GET  /api/admin/users` – List users
- `PATCH /api/admin/users/:id/role` – Change user role
- `DELETE /api/admin/users/:id` – Delete user
- `GET  /api/admin/logs` – Audit logs
- `GET  /api/admin/pkorg/roles` – PKOrg roles
- `POST /api/admin/imports/notenuebersicht` – Import grades Excel from PKOrg
- `POST /api/admin/imports/durchfuehrung` – Import execution data from PKOrg
- `POST /api/admin/portfolios/download` – Trigger portfolio ZIP downloads
- `POST /api/admin/empty-database` – Clear all data
- `GET  /api/admin/keepalive` – PKOrg session keepalive
- `GET  /api/admin/last-ping` – Last keepalive timestamp

### Jobs
- `GET  /api/jobs/:jobId` – Job status & progress

### Files
- `GET  /api/files/portfolio/:kandidatId` – Download portfolio ZIP
- `GET  /api/files/template/:kandidatId` – Download correction template
- `GET  /api/files/anpassung/:anpassungId` – Download adjustment PDF
- `GET  /api/files/missing-portfolios` – List missing portfolios
- `POST /api/files/missing-portfolios` – Upload missing portfolio ZIP

## Render Deployment

Deploy as two separate **Docker Web Services** on Render Free. No Background Worker is required or used.

> **Note**: The docker-compose stack (`docker compose up`) is for local development only. Do not use it on Render.

---

### Prerequisites

An **external MySQL database** reachable from Render. Options: [PlanetScale](https://planetscale.com), [Railway](https://railway.app), [Aiven](https://aiven.io), or any MySQL host with a public connection string.

> The docker-compose value `mysql://nkuser:nkpassword@mysql:3306/notenkonferenz` resolves the hostname `mysql` inside Docker only. It will **not** work on Render.

Redis is **optional**. If `REDIS_URL` is omitted, the API falls back to an in-memory session store with a startup warning. Sessions are not persisted across restarts in this mode. Import/download job endpoints return HTTP 503. This is acceptable for a single-instance demo. For production, provide a Redis URL (e.g. [Upstash](https://upstash.com) free tier).

---

### Step 1 — Deploy the API Web Service

1. Render Dashboard → **New → Web Service** → connect this repo
2. **Dockerfile Path**: `apps/api/Dockerfile`
3. **Root Directory**: *(leave empty)*
4. Add these **Environment Variables**:

| Variable | Required | Value |
|---|---|---|
| `NODE_ENV` | Yes | `production` |
| `DATABASE_URL` | **Yes** | `mysql://USER:PASSWORD@HOST:PORT/DATABASE` |
| `SESSION_SECRET` | **Yes** | Random string ≥ 16 chars — generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CORS_ORIGIN` | Yes | `https://notenkonferenz.onrender.com` *(your web service URL)* |
| `PKORG_BASE_URL` | Yes | `https://2026.pkorg.ch` |
| `UPLOAD_DIR` | Yes | `/app/uploads` |
| `MEDIA_DIR` | Yes | `/app/media` |
| `REDIS_URL` | Optional | Redis connection string — omit to use in-memory sessions (demo only) |

> If `DATABASE_URL` or `SESSION_SECRET` are missing the API prints a clear error message and exits immediately.

5. **Run the database migration** after the first deploy. In the Render service → **Shell**:
   ```
   node -e "const {execSync}=require('child_process'); execSync('npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma', {stdio:'inherit', cwd:'/app'})"
   ```
   Or set it as a **Pre-Deploy Command** in Render settings.

---

### Step 2 — Deploy the Web Service

1. Render Dashboard → **New → Web Service** → connect this repo
2. **Dockerfile Path**: `apps/web/Dockerfile`
3. **Root Directory**: *(leave empty)*
4. No environment variables required.

The nginx config inside the web container proxies all `/api/` requests to `https://notenkonferenz-api.onrender.com` using a runtime DNS resolver (no startup-time hostname failure). If your API service URL differs, update `apps/web/nginx.conf` before deploying.

---

### Render Free tier behaviour

- Services spin down after ~15 minutes of inactivity. The first request after a cold start takes ~30 seconds.
- Uploaded files (`/app/uploads`, `/app/media`) are stored on the container's ephemeral disk and **will be lost** on each deploy or restart. For persistent file storage, mount a Render Disk or use an external object store.

---

## RBAC Roles

| Role  | Permissions                                                |
|-------|------------------------------------------------------------|
| USER  | View own items, validate, change, drop                     |
| STAFF | All USER permissions + overview, dashboard, missing grades |
| ADMIN | All STAFF permissions + user management, imports, logs     |

