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

Deploy the API and Web as two separate Docker Web Services on Render Free.
There is no Background Worker on Render Free — import/download jobs require Redis and a worker process, which is only available in the local Docker Compose setup.

### Prerequisites

- An external MySQL database (e.g. PlanetScale, Railway, Aiven, or any host with a public connection string).
  The docker-compose value `mysql://nkuser:nkpassword@mysql:3306/notenkonferenz` **only works locally** and will not work on Render.
- Optional: an external Redis instance (e.g. Upstash, Railway). Without Redis, sessions fall back to in-memory and import/download jobs are unavailable. The API will still start.

---

### Step 1 — Deploy API Web Service

1. New → **Web Service** → Connect this repo
2. **Dockerfile Path**: `apps/api/Dockerfile`
3. **Root Directory**: *(leave empty)*
4. Set the following **Environment Variables**:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `mysql://USER:PASSWORD@HOST:PORT/DATABASE` |
| `SESSION_SECRET` | *(generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`)* |
| `CORS_ORIGIN` | `https://notenkonferenz.onrender.com` |
| `PKORG_BASE_URL` | `https://2026.pkorg.ch` |
| `UPLOAD_DIR` | `/app/uploads` |
| `MEDIA_DIR` | `/app/media` |
| `REDIS_URL` | *(optional — omit or set to your Redis URL)* |

> **Important**: `DATABASE_URL` and `SESSION_SECRET` are required. The API will print a clear error and refuse to start if they are missing.

5. After first deploy, run the migration once via Render Shell (or add it as a pre-deploy command):
   ```
   node apps/api/dist/... 
   ```
   Or set a **Pre-Deploy Command**: `node -e "const {execSync}=require('child_process');execSync('npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma',{stdio:'inherit'})"` *(adjust path as needed)*

---

### Step 2 — Deploy Web Service

1. New → **Web Service** → Connect this repo
2. **Dockerfile Path**: `apps/web/Dockerfile`
3. **Root Directory**: *(leave empty)*
4. No environment variables required (the API URL is baked into nginx at build time as `https://notenkonferenz-api.onrender.com`)

---

### Notes

- Do **not** use `docker-compose` for Render production. It is only for local development.
- The Web service nginx config proxies all `/api/` requests to `https://notenkonferenz-api.onrender.com`. If your API service has a different name, update `apps/web/nginx.conf` accordingly.
- On Render Free, services spin down after inactivity. The first request after a cold start may take ~30 seconds.

---

## RBAC Roles

| Role  | Permissions                                                |
|-------|------------------------------------------------------------|
| USER  | View own items, validate, change, drop                     |
| STAFF | All USER permissions + overview, dashboard, missing grades |
| ADMIN | All STAFF permissions + user management, imports, logs     |

