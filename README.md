# FinOps Manager — v4.0.0

Sistema web corporativo para gestão FinOps com inventário de recursos Azure, alocação de custos por tag, dashboard Databricks, e calculadora de custos Azure em tempo real.

**Stack:** Node.js 18+ · Express · PostgreSQL 13+ · Vanilla JS SPA · Vivo Purple UI

---

## Índice

1. [O que há de novo na v2.0](#o-que-há-de-novo-na-v20)
2. [Pré-requisitos](#pré-requisitos)
3. [⚠️ Pré-produção — passo a passo obrigatório](#️-pré-produção--passo-a-passo-obrigatório)
4. [Variáveis de Ambiente](#variáveis-de-ambiente)
5. [Windows (local / on-premise)](#windows-local--on-premise)
6. [Linux (Ubuntu / Debian)](#linux-ubuntu--debian)
7. [Docker](#docker)
8. [Azure (App Service + PostgreSQL Flexible)](#azure)
9. [AWS (EC2 + RDS)](#aws)
10. [GCP (Cloud Run + Cloud SQL)](#gcp)
11. [SaaS — Railway · Render · Fly.io](#saas)
12. [SSL / Proxy reverso (Nginx)](#ssl--proxy-reverso)
13. [Segurança em produção](#segurança-em-produção)
14. [APIs Externas — Liberação de Firewall](#apis-externas--liberação-de-firewall)
15. [API Endpoints](#api-endpoints)

---

## O que há de novo na v4.0.0

### 🏢 Inventário de Recursos Azure (Novo)
- **Recurso Graph Change Analysis** — rastreamento de criação, atualização e exclusão de recursos
- **Reconciliação automática** — backfill de recursos que existiam antes da ativação da coleta
- **Timeline de mudanças** — histórico completo de alterações de propriedades (SKU de VM, tags, etc.)
- **Conformidade de tags** — verificação de tags obrigatórias por recurso
- **Anomalia Detection** — Z-score de crescimento acelerado de recursos
- **Desperdício** — identificação de discos órfãos, snapshots antigos, IPs públicos sem uso, NICs desacopladas

### 💰 Alocação & Otimização
- **Showback por tag** — rateio de custos por projeto/squad/centro de custo
- **Cobertura RI/SP** — medida em horas (não R$), comparação com benchmark de mercado (60-80%)
- **Orçamentos por scope** — limite global, por workspace Databricks, ou por tag (projeto/squad)
- **Forecast com tendência linear** — projeção de 3 meses baseada em padrão histórico

### 📊 Coleta Databricks (Novo)
- **System Tables** — coleta de billing, consumo por job/cluster/usuário, anomalias
- **Quotas Genie** — controle de limite de uso do Genie (AI Gateway) com bloqueio automático
- **Detecção de anomalias** — Z-score de custo diário + crescimento por usuário
- **Dashboard próprio** — drill-down por workspace/SKU/usuário, forecasting
- **Importação manual** — CSV/Parquet/ZIP para ambientes sem credenciais de API

### 📋 Azure Retail Price List (v2.0+)
- Sincronização automática com a [Azure Retail Prices API](https://prices.azure.com/api/retail/prices)
- ~100 mil SKUs sincronizados
- Cobertura para todos os tipos: hora, dia, período (disco/storage), reserva

### 🔒 Reservas Cloud (v2.0+)
- Controle de reservas (Azure, AWS, GCP, Oracle, Multicloud)
- Alertas automáticos para reservas expirando em ≤ 90 dias
- Badges por severidade: Expirada / Crítico / Atenção / Aviso

### 🔐 Segurança & Secrets (v4.0.0)
- **Secrets em `.env`, nunca no banco** — todas as credenciais (Azure, Databricks, SMTP, Entra ID) carregadas em boot
- `MASTER_KEY` para criptografia AES-256-GCM de dados sensíveis
- SSO via Microsoft Entra ID + OAuth 2.0 completo
- Controle de acesso (`adminMiddleware`) em rotas de administração
- SMTP com timeouts explícitos e log de tentativas

### 🔁 Reservas Cloud — sincronização com a Azure
- Botão **Sincronizar com Azure** na tela de Reservas importa reservas e Savings Plans usando a Service Principal configurada (Coleta Azure); o cadastro manual continua disponível
- Permissões da SP: **Reservations Reader** (escopo `/providers/Microsoft.Capacity`) e **Savings plan Reader**
- Custos digitados manualmente são preservados nas próximas sincronizações

### 🔤 Fontes e UI (v2.0+)
- IBM Plex Sans/Mono self-hosted (zero dependência externa)
- Tema Vivo Purple (roxo corporativo) + tema claro alternativo
- Responsive design (funciona em mobile)
- Logo FinOps por tema: claro usa `finops-logo.png`, escuro usa `finops-logo-dark.png` (top-bar, login, portal público e telas de FAQ)
- Tela de FAQ com logo centralizado e título "FinOps Manager · FAQ" abaixo

---

## Pré-requisitos

| Componente | Versão mínima |
|---|---|
| Node.js | 18 LTS+ |
| npm | 9+ |
| PostgreSQL | 13+ |

---

## Variáveis de Ambiente

**IMPORTANT:** All Service Principal credentials, API keys, and secrets are **loaded from `.env` at boot — never stored in the database.**

### Quick Start

1. **Copy `.env.example` as a template:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` with real values:**
   - Database credentials: `DB_PASSWORD`, `DATABASE_URL`
   - Secrets: `JWT_SECRET`, `MASTER_KEY` (generate fresh ones with the script below)
   - Azure: `AZURE_TENANT_ID`, `AZURE_SP_CLIENT_ID`, `AZURE_SP_CLIENT_SECRET`
   - Databricks (optional): `DATABRICKS_ACCOUNT_ID`, `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET`
   - SMTP (optional): `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`

3. **Never commit `.env` to git:**
   ```bash
   # Already in .gitignore, but verify:
   grep .env .gitignore
   ```

4. **Always commit `.env.example`:**
   - This is the reference template
   - Contains no real secrets, only variable names and docs
   - Helps AI systems understand what variables are available

### All Possible Variables

See **`.env.example`** in the project root for the complete list of supported environment variables, including optional features like LDAP, Entra ID SSO, and feature flags.

For detailed documentation on the environment secrets strategy, see `CLAUDE.md` section "**Environment Secrets Strategy**".

### Generate Secrets

Never use the defaults in production. Generate strong random values:

```bash
# Generate both JWT_SECRET and MASTER_KEY
node -e "
  const c = require('crypto');
  console.log('JWT_SECRET=' + c.randomBytes(48).toString('hex'));
  console.log('MASTER_KEY=' + c.randomBytes(48).toString('hex'));
"
```

---

## ⚠️ Pré-produção — passo a passo obrigatório

Execute **todos** os passos desta seção antes de expor o sistema a usuários reais. Cada item é obrigatório.

---

### Passo 1 — Gerar segredos criptograficamente seguros

Nunca use os valores padrão em produção. Gere valores únicos:

```bash
# Node.js (recomendado — já disponível no servidor)
node -e "
  const c = require('crypto');
  console.log('JWT_SECRET=' + c.randomBytes(48).toString('hex'));
  console.log('MASTER_KEY=' + c.randomBytes(48).toString('hex'));
"
```

```powershell
# PowerShell (Windows)
# Execute duas vezes — uma para JWT_SECRET, outra para MASTER_KEY
[System.Convert]::ToBase64String(
  [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
)
```

**Regras:**
- Mínimo 32 caracteres (os comandos acima geram 96)
- `JWT_SECRET` — quem tiver esse valor pode forjar tokens de login. Nunca expor.
- `MASTER_KEY` — se mudar após o setup, o arquivo `.finops_setup` torna-se ilegível. Guarde em cofre.
- O servidor imprime **AVISO** no console se algum estiver com o valor padrão

---

### Passo 2 — Criar e proteger o arquivo `.env`

```bash
# Linux/macOS
cat > .env <<EOF
DB_HOST=seu-host-postgres
DB_PORT=5432
DB_NAME=finops_db
DB_USER=finops_user
DB_PASSWORD=senha_forte_do_banco

JWT_SECRET=<gerado_no_passo_1>
JWT_EXPIRES=8h
MASTER_KEY=<gerado_no_passo_1>

PORT=3000
ALLOWED_ORIGIN=https://seu-dominio.com
EOF

chmod 600 .env   # apenas o dono pode ler
```

```powershell
# PowerShell (Windows)
@"
DB_HOST=seu-host-postgres
DB_PORT=5432
DB_NAME=finops_db
DB_USER=finops_user
DB_PASSWORD=senha_forte_do_banco
JWT_SECRET=<gerado_no_passo_1>
JWT_EXPIRES=8h
MASTER_KEY=<gerado_no_passo_1>
PORT=3000
ALLOWED_ORIGIN=https://seu-dominio.com
"@ | Set-Content .env -Encoding UTF8
```

---

### Passo 3 — Criptografar o `.env` (recomendado)

```bash
# Criptografa .env → .env.enc + .env.key (AES-256-GCM)
node encrypt-env.js encrypt

# Apaga o .env em texto plano
rm .env          # Linux
Remove-Item .env # PowerShell

# Guarde .env.key em local seguro (Azure Key Vault, AWS Secrets Manager, cofre)
# NUNCA envie .env.key para o repositório Git
```

Para iniciar o servidor com env criptografado:
```bash
node encrypt-env.js run
```

Ou altere o script `start` no `package.json`:
```json
"start": "node encrypt-env.js run"
```

---

### Passo 4 — Configurar o PostgreSQL com acesso mínimo

```sql
-- Execute como superusuário (postgres)
CREATE DATABASE finops_db;
CREATE USER finops_user WITH ENCRYPTED PASSWORD 'senha_forte_aqui';
GRANT ALL PRIVILEGES ON DATABASE finops_db TO finops_user;

-- Após o primeiro start (tabelas criadas), restringir ao mínimo:
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO finops_user;
```

**Regras de rede PostgreSQL:**
- Nunca expor a porta 5432 publicamente (`0.0.0.0/0`)
- Liberar apenas o IP/VPC da aplicação no `pg_hba.conf` ou firewall
- Usar SSL: `?sslmode=require` na connection string

---

### Passo 5 — Verificar o arquivo `.gitignore`

Confirme que os arquivos sensíveis estão no `.gitignore` antes de qualquer `git push`:

```gitignore
.env
.env.key
.env.enc
.finops_setup
node_modules/
uploads_tmp/
*.log
*.png
```

Verificar arquivos acidentalmente commitados:
```bash
git ls-files .env .env.key .env.enc .finops_setup
# Se retornar algo, remova do histórico com: git rm --cached <arquivo>
```

---

### Passo 6 — HTTPS obrigatório

O Node.js serve apenas HTTP. Coloque um terminador TLS na frente:

**Opção A — Nginx + Certbot (Linux):**
```bash
sudo apt install -y nginx certbot python3-certbot-nginx

sudo tee /etc/nginx/sites-available/finops > /dev/null <<'EOF'
server {
    listen 80;
    server_name seu-dominio.com;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 600M;   # uploads CSV/Parquet grandes
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/finops /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Certificado gratuito (Let's Encrypt)
sudo certbot --nginx -d seu-dominio.com
```

**Opção B — Plataformas gerenciadas:**
- Azure App Service → HTTPS automático em `*.azurewebsites.net`
- Railway / Render / Fly.io → HTTPS automático
- AWS ALB → ACM certificate listener na porta 443

---

### Passo 7 — Configurar reinício automático

**PM2 (recomendado para Linux e Windows):**
```bash
npm install -g pm2
pm2 start server.js --name finops-manager --max-restarts 10 --restart-delay 5000
pm2 save
pm2 startup   # Linux/Mac — siga o comando impresso para registrar no systemd/launchd
```

**Windows — `pm2 startup` não funciona nativamente** (é feito para systemd/launchd). Use o pacote
`pm2-windows-startup`, que registra `pm2 resurrect` (restaura a lista salva por `pm2 save`) no login do
Windows via `HKCU\...\Run`:
```powershell
npm install -g pm2-windows-startup
pm2-startup install
```
Isso só roda no login do usuário atual (não é um serviço Windows que sobe antes do login) — suficiente para
uma máquina onde o usuário sempre inicia sessão. Para rodar como serviço Windows de verdade (sobe no boot,
sem precisar de login), use NSSM em vez de PM2 — ver seção "Windows Service — NSSM" mais abaixo.

**systemd (Linux, alternativa robusta):**
```bash
sudo tee /etc/systemd/system/finops.service > /dev/null <<'EOF'
[Unit]
Description=FinOps Manager v4.0.0
After=network.target postgresql.service

[Service]
Type=simple
User=finops
WorkingDirectory=/opt/finops
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/opt/finops/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable finops
sudo systemctl start finops
sudo journalctl -u finops -f   # logs em tempo real
```

---

### Passo 8 — Verificar saúde da aplicação

Após o deploy, confirme que tudo está funcionando:

```bash
# Health check (sem autenticação)
curl https://seu-dominio.com/health

# Resposta esperada:
# {"status":"ok","db":"connected","uptime":42,"timestamp":"2025-01-01T00:00:00.000Z"}
```

Se retornar `{"status":"degraded","db":"unavailable"}`, o servidor subiu mas não conseguiu conectar ao PostgreSQL — verifique as variáveis `DB_*`.

---

### Passo 9 — Configurar backup do banco

```bash
# Backup manual
pg_dump -h localhost -U finops_user -d finops_db -F c -f finops_backup_$(date +%Y%m%d).dump

# Cron diário às 2h (Linux)
sudo crontab -e
# Adicionar:
0 2 * * * pg_dump -h localhost -U finops_user -d finops_db -F c -f /backups/finops_$(date +\%Y\%m\%d).dump

# Testar restore
pg_restore -h localhost -U finops_user -d finops_db_restore -F c finops_backup.dump
```

**Plataformas gerenciadas:** habilitar backups automáticos no painel do RDS / Azure Database / Cloud SQL (retenção mínima 7 dias).

---

### Passo 10 — Copiar o mascote.png

O arquivo `mascote.png` (mascote Vivo exibido na tela de login) **não é versionado no Git** (listado em `.gitignore`). Você deve copiá-lo manualmente para a pasta raiz da aplicação em cada servidor/ambiente.

```powershell
# Windows — copiar para a pasta da aplicação
Copy-Item "C:\caminho\original\mascote.png" "C:\FinOps\mascote.png"
```

```bash
# Linux
cp /caminho/original/mascote.png /opt/finops/mascote.png
```

```bash
# Docker — inclua no build ou monte como volume
# Opção 1 — copiar antes do build (sem git):
cp mascote.png ./mascote.png
docker build -t finops-manager .

# Opção 2 — volume (persiste entre atualizações):
docker run -d ... -v /caminho/mascote.png:/app/mascote.png finops-manager
```

> **Por que não está no Git?** O `.gitignore` exclui `*.png` para evitar que assets binários grandes aumentem o histórico do repositório. Se preferir versioná-lo, remova a entrada `*.png` do `.gitignore` e execute `git add mascote.png`.

**Comportamento sem o arquivo:** A tela de login exibe apenas o logo SVG "vivo" em roxo, sem o mascote ao lado. O sistema funciona normalmente — o arquivo é apenas visual.

---

### Passo 11 — Configurar monitoramento de disponibilidade

Configure um monitor externo para ser alertado se o sistema cair.

**UptimeRobot (gratuito, recomendado):**

1. Acesse [uptimerobot.com](https://uptimerobot.com) e crie uma conta gratuita
2. **New Monitor → HTTP(s)**
3. Preencha:
   - **URL:** `https://seu-dominio.com/health`
   - **Monitoring Interval:** 5 minutos
   - **Alert Contacts:** seu e-mail ou canal Slack/Teams
4. Resposta esperada: HTTP `200` com corpo `{"status":"ok"}`
5. Se retornar `503` ou `{"status":"degraded"}`, o banco não está acessível — verifique as variáveis `DB_*`

**Alternativas:**

| Serviço | Plano gratuito | Intervalo mínimo |
|---|---|---|
| [UptimeRobot](https://uptimerobot.com) | 50 monitores | 5 min |
| [Better Uptime](https://betteruptime.com) | 10 monitores | 3 min |
| [Freshping](https://freshping.io) | 50 monitores | 1 min |
| Azure Monitor / AWS CloudWatch | Pago | 1 min |

**PM2 — monitoramento local:**
```bash
pm2 monit                   # dashboard em tempo real
pm2 logs finops-manager     # logs do processo
pm2 status                  # resumo de todos os processos
```

---

### Passo 12 — Checklist final

```
Segredos
[ ] JWT_SECRET definido com string aleatória ≥ 32 chars
[ ] MASTER_KEY definido com string aleatória ≥ 32 chars
[ ] DB_PASSWORD forte e único
[ ] .env criptografado com encrypt-env.js ou injetado via plataforma
[ ] .env.key guardado em cofre (não no servidor)

Rede e acesso
[ ] ALLOWED_ORIGIN = https://seu-dominio.com (não null)
[ ] HTTPS ativo — Nginx/Caddy/terminador da plataforma
[ ] Porta 3000 não exposta diretamente (só via proxy)
[ ] PostgreSQL porta 5432 não exposta publicamente
[ ] Firewall: apenas porta 80/443 aberta ao público
[ ] Liberações de firewall outbound para APIs externas (ver seção "APIs Externas")

Operação
[ ] npm run frontend:build executado com sucesso — frontend/dist/react-app.js e frontend/dist/portal-app.js existem (senão, todas as telas migradas ficam em branco)
[ ] PM2 ou systemd configurado (auto-restart)
[ ] /health retorna {"status":"ok"} após deploy
[ ] Backup automático do banco configurado
[ ] Monitoramento de logs ativo (pm2 logs / journalctl)
[ ] Monitor externo configurado (UptimeRobot ou similar) apontando para /health
[ ] Price List sincronizado (Configurações → Price List → Sincronizar)
[ ] Usuário administrador criado via wizard de setup

Assets
[ ] mascote.png copiado manualmente para a pasta raiz da aplicação
```

---

## Variáveis de Ambiente

| Variável | Obrigatória | Padrão inseguro | Descrição |
|---|---|---|---|
| `JWT_SECRET` | ✅ Prod | `finops-secret-2024` | Chave de assinatura JWT — quem tiver pode forjar tokens |
| `MASTER_KEY` | ✅ Prod | `finops-master-key-...` | Chave AES para criptografar `.finops_setup` |
| `DB_PASSWORD` | ✅ | — | Senha do PostgreSQL |
| `DB_HOST` | ✅ | `localhost` | Host do PostgreSQL |
| `DB_PORT` | — | `5432` | Porta do PostgreSQL |
| `DB_NAME` | — | `finops_db` | Nome do banco |
| `DB_USER` | — | `postgres` | Usuário do banco |
| `PORT` | — | `3000` | Porta HTTP do servidor Node |
| `ALLOWED_ORIGIN` | ✅ Prod | `null` (permite tudo) | Origin CORS — ex: `https://finops.vivo.com.br` |
| `JWT_EXPIRES` | — | `8h` | TTL do token JWT |
| `DATABASE_URL` | — | — | Connection string completa (Railway/Render/Fly) — substitui DB_* |

**Prioridade de configuração:** variáveis de ambiente do sistema → `.env.enc` + `.env.key` → `.env` → `.finops_setup` (wizard)

---

## Windows (local / on-premise)

### 1. Instalar dependências

- [Node.js 18 LTS](https://nodejs.org/en/download) — marque "Add to PATH" no instalador
- [PostgreSQL 16](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads) — anote a senha do `postgres`

### 2. Configurar banco e aplicação

```powershell
# Criar banco (psql ou pgAdmin)
CREATE DATABASE finops_db;
CREATE USER finops_user WITH ENCRYPTED PASSWORD 'senha_segura';
GRANT ALL PRIVILEGES ON DATABASE finops_db TO finops_user;

# Na pasta do projeto
cd C:\FinOps
npm install

# Build do frontend React (obrigatório — sem isso as telas migradas ficam em branco)
npm run frontend:install
npm run frontend:build
```

### 3. Criar `.env` e iniciar

```powershell
# Gerar segredos
$jwt  = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
$mkey = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))

@"
DB_HOST=localhost
DB_PORT=5432
DB_NAME=finops_db
DB_USER=finops_user
DB_PASSWORD=senha_segura
JWT_SECRET=$jwt
MASTER_KEY=$mkey
PORT=3000
ALLOWED_ORIGIN=http://localhost:3000
"@ | Set-Content .env -Encoding UTF8

npm start
```

Acesse `http://localhost:3000` — o wizard de configuração abre automaticamente na primeira execução.

### 4. Executar como serviço Windows (PM2)

```powershell
npm install -g pm2 pm2-windows-startup
pm2 start server.js --name finops-manager
pm2 save
pm2-startup install
```

---

## Linux (Ubuntu / Debian)

### 1. Instalar Node.js 18 e PostgreSQL

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql postgresql-contrib

sudo systemctl enable --now postgresql
```

### 2. Criar banco e usuário

```bash
sudo -u postgres psql <<EOF
CREATE DATABASE finops_db;
CREATE USER finops_user WITH ENCRYPTED PASSWORD 'senha_segura';
GRANT ALL PRIVILEGES ON DATABASE finops_db TO finops_user;
EOF
```

### 3. Instalar e configurar aplicação

```bash
sudo mkdir -p /opt/finops
sudo cp -r /caminho/dos/arquivos/* /opt/finops/
sudo chown -R $USER:$USER /opt/finops
cd /opt/finops
npm install --omit=dev

# Build do frontend React (obrigatório — sem isso as telas migradas ficam em branco)
npm run frontend:install
npm run frontend:build

# Gerar segredos e criar .env
JWT=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
MKEY=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

cat > .env <<EOF
DB_HOST=localhost
DB_PORT=5432
DB_NAME=finops_db
DB_USER=finops_user
DB_PASSWORD=senha_segura
JWT_SECRET=$JWT
MASTER_KEY=$MKEY
PORT=3000
ALLOWED_ORIGIN=https://seu-dominio.com
EOF

chmod 600 .env
```

### 4. PM2 ou systemd

**PM2:**
```bash
sudo npm install -g pm2
pm2 start server.js --name finops-manager
pm2 save && pm2 startup
```

**systemd:**
```bash
sudo tee /etc/systemd/system/finops.service > /dev/null <<'EOF'
[Unit]
Description=FinOps Manager v2.0
After=network.target postgresql.service

[Service]
Type=simple
User=finops
WorkingDirectory=/opt/finops
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/opt/finops/.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now finops
sudo journalctl -u finops -f
```

---

## Docker

### Dockerfile

Build em dois estágios: o primeiro compila o frontend React (`frontend/`, bundle Vite — precisa do `node_modules`
completo do Vite/TypeScript, que não deve ir para a imagem final); o segundo monta a imagem de produção só com
o backend + o resultado já compilado (`frontend/dist/`). **Sem esse build, a aplicação sobe e o login funciona,
mas todas as telas migradas para React ficam em branco.**

```dockerfile
# ── Estágio 1: build do frontend React ──
FROM node:18-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ── Estágio 2: imagem de produção ──
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
RUN mkdir -p uploads_tmp
EXPOSE 3000
CMD ["node", "server.js"]
```

### docker-compose.yml

```yaml
version: "3.9"
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DB_HOST: db
      DB_PORT: 5432
      DB_NAME: finops_db
      DB_USER: finops_user
      DB_PASSWORD: ${DB_PASSWORD}
      JWT_SECRET: ${JWT_SECRET}
      MASTER_KEY: ${MASTER_KEY}
      PORT: 3000
      ALLOWED_ORIGIN: ${ALLOWED_ORIGIN}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: finops_db
      POSTGRES_USER: finops_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U finops_user -d finops_db"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  pgdata:
```

```bash
# Criar .env com segredos reais antes de executar
docker compose up -d
docker compose logs -f app
```

> **Upload de arquivos grandes:** o multer grava temporariamente em `uploads_tmp/` e apaga após o import. Em containers, monte um volume se precisar de persistência entre restarts.

---

## Azure

### App Service + Azure Database for PostgreSQL Flexible

```bash
az login
az group create --name rg-finops --location brazilsouth

# PostgreSQL Flexible Server
az postgres flexible-server create \
  --resource-group rg-finops --name finops-pg \
  --location brazilsouth --version 16 \
  --admin-user finops_user --admin-password "SenhaSegura123!" \
  --sku-name Standard_B1ms --tier Burstable

az postgres flexible-server db create \
  --resource-group rg-finops --server-name finops-pg --database-name finops_db

# App Service
az appservice plan create --name plan-finops --resource-group rg-finops \
  --sku B1 --is-linux

az webapp create --resource-group rg-finops --plan plan-finops \
  --name finops-manager --runtime "NODE:18-lts"

# Variáveis de ambiente
az webapp config appsettings set --resource-group rg-finops --name finops-manager \
  --settings \
    DB_HOST="finops-pg.postgres.database.azure.com" \
    DB_PORT="5432" DB_NAME="finops_db" DB_USER="finops_user" \
    DB_PASSWORD="SenhaSegura123!" \
    JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
    MASTER_KEY="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
    PORT="8080" \
    ALLOWED_ORIGIN="https://finops-manager.azurewebsites.net"

# Build do frontend React ANTES de zipar (obrigatório — sem isso as telas migradas ficam em branco)
npm run frontend:install
npm run frontend:build

# Deploy via ZIP (mantém frontend/dist, exclui node_modules/src de dev)
zip -r deploy.zip . --exclude="node_modules/*" --exclude="frontend/node_modules/*" \
  --exclude="frontend/src/*" --exclude=".git/*" --exclude="uploads_tmp/*" --exclude=".env*"
az webapp deployment source config-zip \
  --resource-group rg-finops --name finops-manager --src deploy.zip
```

HTTPS automático em `https://finops-manager.azurewebsites.net`. Para domínio próprio: **Custom Domains → App Service Managed Certificate**.

---

## AWS

### EC2 + RDS PostgreSQL

```bash
# RDS
aws rds create-db-instance \
  --db-instance-identifier finops-pg \
  --db-instance-class db.t3.micro --engine postgres --engine-version 16 \
  --master-username finops_user --master-user-password "SenhaSegura123!" \
  --allocated-storage 20 --db-name finops_db --no-publicly-accessible

# EC2 (Amazon Linux 2023)
sudo dnf install -y nodejs20 npm
sudo npm install -g pm2
mkdir /home/ec2-user/finops && cd /home/ec2-user/finops
npm install --omit=dev

# Build do frontend React (obrigatório — sem isso as telas migradas ficam em branco)
npm run frontend:install
npm run frontend:build

JWT=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
MKEY=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
cat > .env <<EOF
DB_HOST=finops-pg.xxxx.us-east-1.rds.amazonaws.com
DB_PORT=5432 DB_NAME=finops_db DB_USER=finops_user DB_PASSWORD=SenhaSegura123!
JWT_SECRET=$JWT MASTER_KEY=$MKEY PORT=3000
ALLOWED_ORIGIN=https://seu-dominio.com
EOF

pm2 start server.js --name finops-manager && pm2 startup && pm2 save
```

**Recomendado:** usar AWS Secrets Manager para `JWT_SECRET`, `MASTER_KEY` e `DB_PASSWORD` em vez de `.env` no servidor.

---

## GCP

### Cloud Run + Cloud SQL

```bash
gcloud sql instances create finops-pg \
  --database-version=POSTGRES_16 --tier=db-f1-micro --region=southamerica-east1
gcloud sql databases create finops_db --instance=finops-pg
gcloud sql users create finops_user --instance=finops-pg --password=SenhaSegura123!

# Secrets
echo -n "<jwt>" | gcloud secrets create JWT_SECRET --data-file=-
echo -n "<mkey>" | gcloud secrets create MASTER_KEY --data-file=-

gcloud builds submit --tag gcr.io/SEU_PROJETO/finops-manager
# usa o Dockerfile do repositório (seção Docker acima) — já builda o frontend React
# em estágio separado, então nenhum passo extra é necessário aqui.

gcloud run deploy finops-manager \
  --image gcr.io/SEU_PROJETO/finops-manager \
  --region southamerica-east1 --allow-unauthenticated \
  --add-cloudsql-instances SEU_PROJETO:southamerica-east1:finops-pg \
  --set-env-vars DB_HOST="/cloudsql/SEU_PROJETO:southamerica-east1:finops-pg",\
    DB_NAME=finops_db,DB_USER=finops_user,PORT=8080,\
    ALLOWED_ORIGIN=https://finops-manager-xxx.run.app \
  --set-secrets DB_PASSWORD=DB_PASSWORD:latest,JWT_SECRET=JWT_SECRET:latest,\
    MASTER_KEY=MASTER_KEY:latest \
  --memory 512Mi --min-instances 0 --max-instances 5
```

---

## Cloud Deployment (v4.0.0)

### Railway

```bash
npm install -g @railway/cli
railway login && railway init
railway add --plugin postgresql   # DATABASE_URL injetado automaticamente
railway up
```

**Environment Variables** no painel Railway:
- `JWT_SECRET` — gerado via `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `MASTER_KEY` — gerado via `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `ALLOWED_ORIGIN` — seu domínio de produção (ex: `https://seu-dominio.com`)
- Opcionais: `AZURE_TENANT_ID`, `AZURE_SP_CLIENT_ID`, `AZURE_SP_CLIENT_SECRET` (para Coleta Azure)
- Opcionais: `DATABRICKS_ACCOUNT_ID`, `DATABRICKS_CLIENT_ID`, `DATABRICKS_CLIENT_SECRET` (para Coleta Databricks)
- Opcionais: `SMTP_*` (para alertas por e-mail)

⚠️ **Build do frontend** — Railway usa Nixpacks e por padrão só roda `npm install`. As telas migradas (Dashboard, Projetos, Estimativas) ficam em branco sem o build React. **No painel Railway:**
- Settings → Build → Build Command: `npm install && npm run frontend:build`

### Render

1. **New → Web Service** → conectar repositório Git
2. **Build Command**: `npm install && npm run frontend:build`
3. **Start Command**: `node server.js`
4. **Environment**: adicionar variáveis (ver lista Railway acima)
5. **New → PostgreSQL** → `DATABASE_URL` será injetado automaticamente

### Fly.io

```bash
fly launch --name finops-manager --region gru
fly postgres create --name finops-pg --region gru
fly postgres attach finops-pg

# Gerar secrets criptograficamente seguros
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")

fly secrets set \
  JWT_SECRET="$JWT_SECRET" \
  MASTER_KEY="$MASTER_KEY" \
  ALLOWED_ORIGIN=https://finops-manager.fly.dev

fly deploy
```

✅ Fly.io usa o Dockerfile do repositório, que já builda o frontend React no primeiro estágio — nenhum passo extra necessário.

### Azure App Service + PostgreSQL Flexible Server

Deploy em PaaS nativo do Azure:

```bash
# Criar grupo de recursos
az group create --name rg-finops --location brazilsouth

# PostgreSQL Flexible Server
az postgres flexible-server create \
  --resource-group rg-finops \
  --name finops-pg \
  --location brazilsouth \
  --version 16 \
  --admin-user pgadmin \
  --admin-password '<senha-forte>' \
  --sku-name Standard_B1ms \
  --tier Burstable

# Database
az postgres flexible-server db create \
  --resource-group rg-finops \
  --server-name finops-pg \
  --database-name finops_db

# App Service Plan
az appservice plan create \
  --resource-group rg-finops \
  --name finops-plan \
  --sku B1 \
  --is-linux

# Web App
az webapp create \
  --resource-group rg-finops \
  --plan finops-plan \
  --name finops-manager \
  --runtime 'NODE:18-lts'

# Configurar startup
az webapp config set \
  --resource-group rg-finops \
  --name finops-manager \
  --startup-file 'node server.js'

# Build command do frontend (obrigatório!)
az webapp config appsettings set \
  --resource-group rg-finops \
  --name finops-manager \
  --settings \
  PRE_BUILD_COMMAND='npm install && npm run frontend:build'

# Variáveis de ambiente (secrets)
az webapp config appsettings set \
  --resource-group rg-finops \
  --name finops-manager \
  --settings \
  DATABASE_URL='postgresql://pgadmin:<senha>@finops-pg.postgres.database.azure.com:5432/finops_db?sslmode=require' \
  JWT_SECRET='<gerado-randomicamente>' \
  MASTER_KEY='<gerado-randomicamente>' \
  ALLOWED_ORIGIN='https://finops-manager.azurewebsites.net' \
  NODE_ENV='production' \
  TZ='America/Sao_Paulo'

# Deploy via Git (configure repositório Git local)
az webapp deployment user set --user-name <seu-usuario> --password <sua-senha>
git remote add azure https://<seu-usuario>@finops-manager.scm.azurewebsites.net:443/finops-manager.git
git push azure main
```

✅ App Service injeta `DATABASE_URL` automaticamente do PostgreSQL Flexible Server. O frontend é buildado via `PRE_BUILD_COMMAND`.

---

## SSL / Proxy reverso

### Nginx + Certbot (Let's Encrypt)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

sudo tee /etc/nginx/sites-available/finops > /dev/null <<'EOF'
server {
    listen 80;
    server_name seu-dominio.com;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 600M;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/finops /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d seu-dominio.com
```

---

## Segurança em produção

### Criptografar `.env`

```bash
node encrypt-env.js encrypt   # .env → .env.enc + .env.key
rm .env                       # apaga texto plano
# Guarda .env.key fora do servidor (Key Vault, Secrets Manager, cofre)
node encrypt-env.js run       # inicia com env criptografado
```

### Vulnerabilidades conhecidas (npm audit)

| Pacote | Severidade | Status | Mitigação |
|---|---|---|---|
| `thrift` (via `@dsnp/parquetjs`) | 🔴 High | Sem fix disponível | Import Parquet requer autenticação; arquivo deletado após uso |
| `uuid` (via `exceljs ≥3.5`) | 🟡 Moderate | Fix = downgrade exceljs (breaking) | Risco baixo — uso interno para gerar IDs em exports |

Execute `npm audit` periodicamente e aplique `npm audit fix` quando disponível.

### Headers de segurança (configurados automaticamente)

O servidor usa `helmet` com CSP desabilitado (para compatibilidade com o SPA inline):

- `X-Frame-Options` — DENY (sem iframes)
- `X-Content-Type-Options` — nosniff
- `Referrer-Policy` — strict-origin-when-cross-origin
- `X-DNS-Prefetch-Control` — off
- `X-Download-Options` — noopen

> **HSTS (Strict-Transport-Security):** não é configurado pelo Node — deve ser adicionado no proxy reverso (Nginx/Caddy). Exemplo para Nginx: `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;`

### Arquivos que NÃO são acessíveis via HTTP (v2.0)

`server.js` · `package.json` · `.env` · `.env.key` · `.env.enc` · `.finops_setup` · `schema.sql` · `*.sql`

**Arquivos servidos estaticamente:** `index.html` · `app.js` · `calculadora.js` · `styles.css` · `favicon.svg` · `mascote.png` · `fonts/*.woff2` · `libs/xlsx.full.min.js`

### Atualizar as fontes tipográficas

As fontes IBM Plex são open-source (SIL OFL 1.1) e distribuídas via [`@fontsource`](https://fontsource.org). Para atualizar para uma versão mais nova:

```bash
# 1. Instalar pacotes fontsource temporariamente
npm install --save-dev @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono

# 2. Copiar apenas os subsets latin e latin-ext que o sistema usa
# Linux / macOS
BASE_SANS="node_modules/@fontsource/ibm-plex-sans/files"
BASE_MONO="node_modules/@fontsource/ibm-plex-mono/files"

for w in 300 400 500 600 700; do
  cp "$BASE_SANS/ibm-plex-sans-latin-${w}-normal.woff2"     "fonts/ibm-plex-sans-latin-${w}.woff2"
  cp "$BASE_SANS/ibm-plex-sans-latin-ext-${w}-normal.woff2" "fonts/ibm-plex-sans-latin-ext-${w}.woff2"
done
for w in 400 500 600; do
  cp "$BASE_MONO/ibm-plex-mono-latin-${w}-normal.woff2"     "fonts/ibm-plex-mono-latin-${w}.woff2"
  cp "$BASE_MONO/ibm-plex-mono-latin-ext-${w}-normal.woff2" "fonts/ibm-plex-mono-latin-ext-${w}.woff2"
done
```

```powershell
# Windows (PowerShell)
$baseSans = "node_modules\@fontsource\ibm-plex-sans\files"
$baseMono = "node_modules\@fontsource\ibm-plex-mono\files"

foreach ($w in @(300,400,500,600,700)) {
  Copy-Item "$baseSans\ibm-plex-sans-latin-$w-normal.woff2"     "fonts\ibm-plex-sans-latin-$w.woff2"
  Copy-Item "$baseSans\ibm-plex-sans-latin-ext-$w-normal.woff2" "fonts\ibm-plex-sans-latin-ext-$w.woff2"
}
foreach ($w in @(400,500,600)) {
  Copy-Item "$baseMono\ibm-plex-mono-latin-$w-normal.woff2"     "fonts\ibm-plex-mono-latin-$w.woff2"
  Copy-Item "$baseMono\ibm-plex-mono-latin-ext-$w-normal.woff2" "fonts\ibm-plex-mono-latin-ext-$w.woff2"
}
```

```bash
# 3. Remover pacotes temporários
npm uninstall @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono

# 4. Commitar os novos arquivos
git add fonts/
git commit -m "chore: atualizar IBM Plex fonts para versao X.X"
```

> Os `@font-face` em `styles.css` não precisam ser alterados — os nomes dos arquivos são estáveis entre versões do fontsource.

### Atualizar o XLSX.js

O arquivo `libs/xlsx.full.min.js` é a versão `0.18.5` da biblioteca SheetJS Community Edition (última versão open-source gratuita). Para atualizar:

```bash
# Linux / macOS
curl -sL "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" \
  -o libs/xlsx.full.min.js

git add libs/xlsx.full.min.js
git commit -m "chore: atualizar xlsx.js para versao X.X.X"
```

```powershell
# Windows (PowerShell)
Invoke-WebRequest "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js" `
  -OutFile "libs\xlsx.full.min.js"

git add libs/xlsx.full.min.js
git commit -m "chore: atualizar xlsx.js para versao X.X.X"
```

> **Atenção:** versões acima de `0.18.5` são comerciais (SheetJS Pro). Verifique a licença antes de atualizar. A versão `0.18.5` é suficiente para leitura de `.xlsx`/`.xls` e não tem planos de descontinuação.

---

## Production Checklist

Antes de implantar em produção:

- [ ] `JWT_SECRET` definido com string aleatória (≥ 32 chars)
  - Gerar com: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
  - Máxima segurança: qualquer um com este valor pode forjar tokens de login
- [ ] `MASTER_KEY` definido com string aleatória (≥ 32 chars)
  - Gerar com: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
  - Aviso: se mudar após setup, arquivo `.finops_setup` torna-se ilegível — guardar em cofre seguro
- [ ] `DB_PASSWORD` configurado e diferente do padrão
- [ ] `ALLOWED_ORIGIN` ajustado para o domínio exato de produção
- [ ] `.env` criptografado (`node encrypt-env.js encrypt`) — `.env.key` armazenado seguramente fora do servidor
- [ ] `uploads_tmp/` com permissões de escrita para o processo Node
- [ ] PostgreSQL 13+ instalado, banco e usuário criados com permissões mínimas
- [ ] PostgreSQL acessível desde o host do Node no `DB_HOST:DB_PORT` configurado
- [ ] `mascote.png` presente no diretório da aplicação (não rastreado pelo git — copiar manualmente)
- [ ] Reverse proxy (Nginx/Caddy) configurado com HTTPS (Let's Encrypt Certbot) e headers de segurança (HSTS, CSP)
- [ ] PM2 ou systemd configurado para auto-restart em crash/reboot
- [ ] Frontend React buildado: `npm install && npm run frontend:build` concluído com sucesso
- [ ] Node rodando com `NODE_ENV=production` (desabilita verbose logging)
- [ ] Firewall corporativo liberado para outbound: Azure APIs, SMTP (se alertas habilitados), LDAP/Entra ID (se auth externa)
- [ ] Se **Portal Público** ativado: `PORTAL_SUBSCRIPTION_IDS` configurado — sem isso, nenhum dado é exposto
- [ ] Se **Portal Público** ativado: `PORTAL_SOLICITAR_IDENTIFICACAO=true` ou `PORTAL_DOMINIOS_ACEITOS` configurado para restringir acesso
- [ ] Se **Coleta Azure** ativada: Azure Service Principal credenciado em `AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET`
- [ ] Se **Coleta Databricks** ativada: OAuth M2M ou PAT configurado em `DATABRICKS_*` variables
- [ ] Se **Alertas SMTP** ativados: servidor SMTP testado (`POST /api/integrations/smtp/testar`)
- [ ] Se **SSO Entra ID** ativado: aplicação registrada no Azure AD e `ENTRA_*` configurado

---

## APIs Externas — Liberação de Firewall

O sistema realiza chamadas externas tanto a partir do **servidor Node.js** quanto a partir do **navegador do usuário**. Ambas as direções precisam ser liberadas na infraestrutura de rede.

### Servidor → Internet (Outbound do servidor)

| Serviço | URL / Destino | Porta | Protocolo | Quando é usado |
|---|---|---|---|---|
| **Azure Retail Prices** | `https://prices.azure.com` | 443 | HTTPS | Sincronização do Price List (Configurações → Price List → Sincronizar) |
| **Azure Management API** | `https://management.azure.com` | 443 | HTTPS | Coleta Automática de custos (lista subscriptions, RGs e aciona export) |
| **Microsoft Entra ID (login)** | `https://login.microsoftonline.com` | 443 | HTTPS | Autenticação SSO OAuth 2.0 (se Entra ID estiver configurado) |
| **Azure Storage (Blobs)** | `https://*.blob.core.windows.net` | 443 | HTTPS | Download dos arquivos de export gerados pela Coleta Automática |
| **Active Directory / LDAP** | Servidor AD corporativo | 389 (LDAP) / 636 (LDAPS) | TCP | Autenticação via Active Directory (se AD estiver configurado) |

> **LDAPS (porta 636) é fortemente recomendado em produção.** Usar LDAP simples (389) transmite credenciais sem criptografia.

### Navegador → Internet (Outbound do browser do usuário)

**Nenhuma chamada externa necessária.** Todas as bibliotecas e fontes são self-hosted:

| Asset | Local | Observação |
|---|---|---|
| IBM Plex Sans / Mono | `fonts/*.woff2` | Self-hosted — sem Google Fonts |
| XLSX.js 0.18.5 | `libs/xlsx.full.min.js` | Self-hosted — sem cdnjs/Cloudflare |

> O browser do usuário **não faz nenhuma request para domínios externos**. Zero regras de firewall outbound necessárias para o frontend.

### Resumo de portas e direções

```
SERVIDOR (outbound)
  443/TCP  → prices.azure.com
  443/TCP  → management.azure.com
  443/TCP  → login.microsoftonline.com
  443/TCP  → *.blob.core.windows.net
  389/TCP  → [AD server]    ← LDAP simples (evitar em prod)
  636/TCP  → [AD server]    ← LDAPS (recomendado)

NAVEGADOR (outbound)
  (sem saída externa — fontes e xlsx.js são self-hosted)

INBOUND (para o servidor Node.js)
  3000/TCP ← apenas do proxy reverso (Nginx/Caddy) — nunca expor ao público
  80/TCP   ← público (redireciona para HTTPS via Nginx)
  443/TCP  ← público (terminado no Nginx, encaminhado para :3000)
  5432/TCP ← apenas da aplicação Node.js (PostgreSQL — nunca expor ao público)
```

### Observações para ambientes com saída restrita

- **Price List:** se `prices.azure.com` estiver bloqueado, a sincronização falha silenciosamente e a calculadora usa apenas o custo histórico de billing (sem coluna PL/h e sem badges de desconto).
- **Coleta Automática:** requer acesso a `management.azure.com` e ao `*.blob.core.windows.net` da subscription configurada. Sem acesso, a coleta falha e registra erro no histórico.
- **SSO Entra ID:** sem acesso a `login.microsoftonline.com`, o botão "Entrar com Microsoft" não funciona. O login local (e-mail + senha) e o AD continuam funcionando.
- **Fontes e XLSX.js:** 100% self-hosted (`fonts/` e `libs/`) — sem dependência externa no browser. Nenhuma regra de firewall necessária para o frontend.

---

## API Endpoints

Todos os endpoints (exceto `/health`, `/api/auth/*` e `/api/setup/*`) exigem:
```
Authorization: Bearer <jwt_token>
```

### Sistema

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/health` | ❌ | Status do servidor e banco — para monitoramento |
| GET | `/api/usuarios` | ✅ admin | Listar usuários |
| POST | `/api/usuarios` | ✅ admin | Criar usuário |

### Autenticação

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/auth/login` | Login local (email + senha) — rate limit 20/15min |
| POST | `/api/auth/ad` | Login Active Directory (LDAP) — rate limit 20/15min |
| GET | `/api/auth/entra/redirect` | Inicia OAuth Microsoft Entra ID |
| GET | `/api/auth/entra/callback` | Callback OAuth Entra ID |

### Projetos e Ações FinOps

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/projetos` | Listar projetos |
| POST | `/api/projetos` | Criar projeto |
| PUT | `/api/projetos/:id` | Atualizar projeto |
| DELETE | `/api/projetos/:id` | Excluir projeto |
| GET | `/api/acoes` | Listar ações (filtros: `projeto_id`, `status`, `cloud`) |
| POST | `/api/acoes` | Criar ação |
| PUT | `/api/acoes/:id` | Atualizar ação |
| DELETE | `/api/acoes/:id` | Excluir ação |

### Dashboard e Export

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/dashboard` | Estatísticas agregadas por status e cloud |
| GET | `/api/export/excel` | Download `.xlsx` — Sumário / Ações / Retorno Mensal |

### Calculadora Azure

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/calculadora/subscriptions` | Subscriptions (cache — < 5 ms) |
| GET | `/api/calculadora/resource-groups` | Resource Groups por subscription (cache) |
| GET | `/api/calculadora/recursos` | Recursos com custo/h, Price List e desconto |
| POST | `/api/calculadora/estimar` | Estimativa consolidada por período |
| GET | `/api/calculadora/reconciliacao` | Reconciliação por subscription/RG/período |

### Custos Azure (Import)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/azure-costs/import` | Upload CSV, Parquet ou ZIP — aceita até 500 MB |
| GET | `/api/azure-costs/import-status` | Status do import em andamento |

### Azure Retail Price List *(novo v2.0)*

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/price-list/status` | Total de registros, data da última sync e status |
| POST | `/api/price-list/sync` | Inicia sincronização com `prices.azure.com` (fire-and-forget) |

### Reservas Cloud *(novo v2.0)*

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/reservas` | Listar reservas (filtros: `cloud`, `status`) |
| POST | `/api/reservas` | Criar reserva |
| PUT | `/api/reservas/:id` | Atualizar reserva |
| DELETE | `/api/reservas/:id` | Excluir reserva |
