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
Install the versioned unit file from `deploy/finops.service` at
`/etc/systemd/system/finops.service`. It defines the production working directory
and starts `server.js`; configure secrets through the deployment environment.

```bash
sudo install -o root -g root -m 644 deploy/finops.service /etc/systemd/system/finops.service
sudo systemctl daemon-reload
sudo systemctl enable --now finops
sudo systemctl status finops --no-pager
```

O unit usa `Restart=always` com intervalo de 10 segundos para recuperar o processo
se ele encerrar inesperadamente, inclusive com saída limpa ou `SIGTERM` externo.
Uma parada explícita com `systemctl stop` continua intencional e não inicia o serviço
novamente.

Use `sudo systemctl stop finops` to stop without disabling startup at boot,
`sudo systemctl disable finops` to disable startup, and
`sudo journalctl -u finops -f` to follow logs. The unit file's paths must match
the deployed checkout; review them when installing outside the repository's
current production path.

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

## O que esperar ao subir cada versão

Nada aqui é passo manual — é o que muda de comportamento no primeiro startup depois do deploy.

**Novo na v4.2** — nada manual, mas saiba o que esperar: o índice `idx_azure_costs_cat_date` é
criado em background no startup e leva ~10 min numa base de 9M linhas (telas de observabilidade
ficam lentas até terminar); a tabela `log_analytics_commitment_snapshot` nasce vazia e acumula uma
linha por workspace/dia; o agendador agora dispara **todas** as SPs due no mesmo tick (antes
`LIMIT 1`), então reveja o `max` do pool PostgreSQL se houver muitas SPs ativas.

**Depois da v4.2** — as tabelas do Mailing (`mailing_*`) e de economia (`azure_desperdicio_saving`)
nascem no startup, vazias, sem passo manual. Duas coisas a saber:

- **Onde ficam os segredos da aplicação**: no BANCO, cifrados com a `MASTER_KEY` — Service
  Principals em `azure_coleta_config`, senha do SMTP em `integracoes`. O `.env` guarda só o que o
  processo precisa antes de existir banco (conexão, `JWT_SECRET`, `MASTER_KEY`). Consequência: a
  `MASTER_KEY` faz parte do backup junto com o dump; perdê-la ou trocá-la torna todas as
  credenciais salvas ilegíveis, e elas precisam ser recadastradas uma a uma pelas telas. Quando
  isso acontece o sintoma é `[Cripto] FALHA ao decifrar um segredo` no log, e o envio falha com
  `535 Incorrect authentication data`.
- **O Mailing usa relay SMTP anônimo próprio** (`integracoes` tipo `mailing_relay`, sem senha,
  autorizado por IP), separado do SMTP de Alertas. O "Testar Conexão" pode falhar na estação e
  funcionar em produção — é liberação por IP de origem, não configuração errada.
