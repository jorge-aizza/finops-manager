# DEPLOYMENT_CHECKLIST — Production Ship

## Secrets & Configuration

- ☐ `JWT_SECRET` set to random string (≥32 chars) via `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- ☐ `MASTER_KEY` set to random string (≥32 chars, same method)
- ☐ `ALLOWED_ORIGIN` matches frontend domain (e.g., `https://finops.example.com`)
- ☐ `.env` encrypted: `node encrypt-env.js encrypt` → `.env.enc` + `.env.key`
- ☐ `.env.key` stored securely (separate from repo, backed up)
- ☐ `.env.example` remains in repo (no secrets, pure template)

## Build & Bundle

- ☐ `npm install` (backend deps)
- ☐ `npm run frontend:install && npm run frontend:build` (React bundle required)
- ☐ `frontend/dist/react-app.js` + `.css` generated and **not committed** (built on deploy)
- ☐ Run `node --check server.js` (syntax validation)
- ☐ Run `npm run frontend:test` or `tsc -b` (type check) if TypeScript present

## Database

- ☐ PostgreSQL 13+ accessible
- ☐ Database created: `createdb finops_db` (or via cloud provider)
- ☐ Schema migrations run automatically on first `npm start` (via `initDB()`)
- ☐ Verify all 18 performance indexes created: `SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'azure_costs'`
- ☐ Connection pooling defaults acceptable (max 20 connections, 30s idle)

## File System

- ☐ `uploads_tmp/` directory writable by app (for CSV/Parquet imports)
- ☐ `.finops_setup` file can be written (encryption key storage)
- ☐ `mascote.png` present in app root (not in git, copy manually)

## Authentication

- ☐ At least one auth method configured:
  - **Local**: run app once, create user via UI setup wizard
  - **LDAP**: `LDAP_URL`, `LDAP_BASE_DN`, etc. set in `.env`
  - **Entra ID**: `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_REDIRECT_URI`
- ☐ JWT tokens have 8-hour expiry (`JWT_EXPIRES`)
- ☐ Rate limiting: 20 req/15 min on `/api/auth/login` and `/api/auth/ad`

## Azure & Databricks (Optional)

- ☐ Azure Service Principal created with `Reader` role (if using Azure Coleta)
  - `AZURE_TENANT_ID`, `AZURE_SP_CLIENT_ID`, `AZURE_SP_CLIENT_SECRET`
  - `AZURE_SUBSCRIPTION_IDS` (comma-separated)
- ☐ Databricks credentials (if using Databricks Coleta)
  - `DATABRICKS_ACCOUNT_ID`, `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`, `DATABRICKS_WORKSPACE_HOST`
  - **OR** `DATABRICKS_PAT` (Personal Access Token, lower security)

## Email (Optional)

- ☐ SMTP server accessible from app (if email alerts desired)
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`
  - `SMTP_FROM_ADDRESS`, `SMTP_DEFAULT_RECIPIENTS`
- ☐ "Testar Conexão" in Admin Settings succeeds (proves SMTP works)

## Network & HTTPS

- ☐ Node runs on port 3000 (or `PORT` env var override)
- ☐ Reverse proxy (Nginx/Caddy) configured for HTTPS termination
  - `proxy_pass http://localhost:3000`
  - SSL certificate valid (e.g., Let's Encrypt)
- ☐ `ALLOWED_ORIGIN` header validates frontend domain
- ☐ CORS enabled for API calls from frontend

## Service Restart

Choose one:
- ☐ **PM2**: `pm2 start server.js --name finops-manager && pm2 startup && pm2 save`
- ☐ **systemd** (Linux): service file in `/etc/systemd/system/`, `systemctl enable finops-manager`
- ☐ **Cloud platform** (Railway/Render/Azure): platform restart policy configured
- ☐ **Docker**: app restarts via compose or orchestrator (Kubernetes, etc.)

## Deployment Modes

### Docker (Local or Cloud)
- ☐ `docker build -t finops:v4.0 .`
- ☐ `docker compose up -d` or `docker run ... finops:v4.0`
- ☐ Database accessible from container (host network or DNS)

### Railway
- ☐ GitHub repo connected
- ☐ PostgreSQL resource created → `DATABASE_URL` auto-injected
- ☐ Env vars set: `JWT_SECRET`, `MASTER_KEY`, `ALLOWED_ORIGIN`, SMTP vars
- ☐ Build: `npm install && npm run frontend:install && npm run frontend:build`
- ☐ Start: `node server.js`

### Azure App Service
- ☐ PostgreSQL Flexible Server created
- ☐ App Service created with Node 18+ runtime
- ☐ Key Vault or App Settings store secrets
- ☐ Startup file: `node server.js`
- ☐ Deploy via zip, git, or CLI

### On-Premises (Linux)
- ☐ Node.js 18+ installed
- ☐ PostgreSQL running
- ☐ app directory has `.env.enc` + `.env.key` (encrypted secrets)
- ☐ Firewall allows port 3000 (or reverse proxy port)
- ☐ Service auto-restart via PM2 or systemd

## Testing

- ☐ Login works (at least one auth method)
- ☐ Dashboard loads (verifies React bridge mounted)
- ☐ Create a project → view it in list
- ☐ Navigate to Azure Coleta (if configured) → verify no auth errors
- ☐ Email test (if SMTP configured): Admin Settings → "Testar Conexão"

## Monitoring & Backups

- ☐ App logs captured (PM2 logs, systemd journal, Docker logs)
- ☐ Database backups scheduled (daily, weekly)
- ☐ `.env.key` backed up separately (NOT in repo or backup with `.env.enc`)
- ☐ `.finops_setup` file (encryption key) backed up
- ☐ Alert: monitor for `ERROR` logs and unusual API error rates

## Final Steps

1. ☐ Run `npm start` once manually — verify migrations complete without error
2. ☐ Test login + navigate to 2-3 views
3. ☐ Start service via PM2/systemd/Docker
4. ☐ Monitor logs for errors (first 5 minutes especially)
5. ☐ Announce to users — new version live

---

**See CLAUDE.md Module 10-DEPLOYMENT** for detailed Docker, Railway, Render, and Azure instructions.
