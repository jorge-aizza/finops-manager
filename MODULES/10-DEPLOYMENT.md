# 10-DEPLOYMENT — Docker, Azure, Railway, PM2

## Local / Development

```bash
npm install              # Backend deps
npm run frontend:install # Frontend deps
npm run frontend:build   # Vite bundle
npm run dev:all          # Express + Vite dev server together
```

**Requirements**:
- Node.js 18+
- PostgreSQL 13+ (or `postgresql://localhost:5432/finops_db`)
- `.env` file with real secrets (or `.env.example` + fill in values)

## Production Build

```bash
# Build MUST happen before deploy
npm install              # all deps
npm run frontend:install
npm run frontend:build   # creates frontend/dist/*
npm start                # node server.js (port 3000, expects PORT env var override)
```

**Critical**: Without `frontend/dist/react-app.js`, all React views render blank (404).

## Docker

**Dockerfile**:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production

# Pre-build React (must happen in build step)
COPY frontend/ frontend/
RUN npm install --prefix frontend
RUN npm run build --prefix frontend

COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

**Docker Compose** (local Postgres):
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: finops_db
    volumes:
      - db_data:/var/lib/postgresql/data

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@db:5432/finops_db
      JWT_SECRET: your-secret
      MASTER_KEY: your-key
    depends_on:
      - db
    volumes:
      - ./uploads_tmp:/app/uploads_tmp
      - ./.finops_setup:/app/.finops_setup

volumes:
  db_data:
```

**Run**:
```bash
docker compose up -d
# App available at http://localhost:3000
```

## Cloud Platforms

### Railway (Quickest)
1. Connect GitHub repo
2. **+ New Resource > Database > PostgreSQL** → auto-injected `DATABASE_URL`
3. **Add environment variables**: `JWT_SECRET`, `MASTER_KEY`, `ALLOWED_ORIGIN`
4. **Build command**: `npm install && npm run frontend:install && npm run frontend:build`
5. **Start command**: `node server.js`
6. Deploy

### Render
1. **New Web Service** from GitHub
2. Build: `npm install && npm run frontend:install && npm run frontend:build`
3. Start: `node server.js`
4. **Add PostgreSQL database** → copy Internal Database URL to `DATABASE_URL`
5. Set env vars

### Azure App Service + PostgreSQL Flexible
```bash
az postgres flexible-server create --name finops-pg ...
az webapp create --name finops-app ...
az webapp config set --startup-file "node server.js"
az webapp config appsettings set --settings \
  DATABASE_URL="postgresql://user:pass@finops-pg...finops_db?sslmode=require" \
  JWT_SECRET=... MASTER_KEY=... ALLOWED_ORIGIN=https://finops-app.azurewebsites.net
```

## Service Management (Linux / Windows)

### PM2 (Recommended)
```bash
npm install -g pm2
pm2 start server.js --name finops-manager
pm2 save
pm2 startup
# Restart auto-starts on reboot
```

**Commands**: `pm2 status`, `pm2 logs finops-manager`, `pm2 restart finops-manager`

### systemd (Linux)
Create `/etc/systemd/system/finops-manager.service`:
```ini
[Unit]
Description=FinOps Manager
After=network.target postgresql.service

[Service]
User=finops
WorkingDirectory=/opt/finops-manager
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/opt/finops-manager/.env

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable finops-manager
systemctl start finops-manager
```

### Windows Service (NSSM)
```powershell
nssm install FinOpsManager "C:\Program Files\nodejs\node.exe" "C:\finops\server.js"
nssm set FinOpsManager AppDirectory "C:\finops"
nssm set FinOpsManager AppParameters "server.js"
nssm start FinOpsManager
```

## Secrets Management

**Development**: `.env` file (gitignored)

**Production**:
```bash
node encrypt-env.js encrypt   # .env → .env.enc + .env.key
# Store .env.key securely (separate from repo)
node encrypt-env.js run       # Loads .env.enc and starts server
```

**Cloud platforms**: Use native secret stores:
- **Railway**: Environment variables (UI)
- **Render**: Secrets (masked in UI)
- **Azure**: Key Vault or App Service secrets

## Reverse Proxy (HTTPS)

**Node runs HTTP only** — termination at reverse proxy.

**Nginx**:
```nginx
server {
  listen 443 ssl;
  server_name finops.example.com;

  ssl_certificate /etc/letsencrypt/live/finops.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/finops.example.com/privkey.pem;

  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Checklist

- ☐ `JWT_SECRET` set (≥32 random chars)
- ☐ `MASTER_KEY` set (≥32 random chars)
- ☐ `ALLOWED_ORIGIN` matches frontend domain
- ☐ PostgreSQL accessible, migrations run (`npm start` does this auto)
- ☐ `frontend/dist/` built (not committed, built on deploy)
- ☐ HTTPS termination configured (reverse proxy or cloud platform)
- ☐ `uploads_tmp/` writable by app (for CSV imports)
- ☐ `mascote.png` present (not in git, copy manually)
- ☐ SMTP optional but recommended (email alerts)
- ☐ Service auto-restart configured (PM2, systemd, or cloud platform native)
- ☐ Backups configured (DB dumps, `.finops_setup` file, encryption key)

---

See **02-ARCHITECTURE.md** for system overview; **03-AUTHENTICATION.md** for secrets strategy; **01-STARTUP.md** for boot requirements.
