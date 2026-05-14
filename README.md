# FinOps Manager

Sistema web para gestão de ações FinOps com calculadora de custos Azure, dashboard executivo e exportação Excel.

**Stack:** Node.js + Express · PostgreSQL · Vanilla JS SPA · Vivo Purple UI

---

## Índice

1. [Pré-requisitos](#pré-requisitos)
2. [Variáveis de Ambiente](#variáveis-de-ambiente)
3. [Windows (local / on-premise)](#windows-local--on-premise)
4. [Linux (Ubuntu / Debian)](#linux-ubuntu--debian)
5. [Docker](#docker)
6. [Azure (App Service + PostgreSQL Flexible)](#azure)
7. [AWS (EC2 + RDS)](#aws)
8. [GCP (Cloud Run + Cloud SQL)](#gcp)
9. [SaaS / Railway · Render · Fly.io](#saas)
10. [SSL / Proxy reverso (Nginx)](#ssl--proxy-reverso)
11. [Segurança em produção](#segurança-em-produção)
12. [API Endpoints](#api-endpoints)

---

## Pré-requisitos

| Componente | Versão mínima |
|------------|---------------|
| Node.js    | 18 LTS+       |
| npm        | 9+            |
| PostgreSQL | 13+           |

---

## Variáveis de Ambiente

Crie um arquivo `.env` na raiz do projeto (ou use `.env.enc` criptografado — veja seção Segurança):

```env
# Banco de dados
DB_HOST=localhost
DB_PORT=5432
DB_NAME=finops_db
DB_USER=postgres
DB_PASSWORD=senha_segura_aqui

# Segurança — OBRIGATÓRIO alterar em produção
JWT_SECRET=troque-por-string-aleatoria-longa-em-producao
JWT_EXPIRES=8h
MASTER_KEY=chave-32-chars-para-criptografia-setup

# Servidor
PORT=3000
ALLOWED_ORIGIN=https://seu-dominio.com   # null = permite todas as origens
```

> **Padrão sem .env:** `DB_HOST=localhost`, `PORT=3000`, JWT/MASTER com valores inseguros de desenvolvimento.

---

## Windows (local / on-premise)

### 1. Instalar dependências

- [Node.js 18 LTS](https://nodejs.org/en/download) — marque "Add to PATH" no instalador
- [PostgreSQL 16](https://www.enterprisedb.com/downloads/postgres-postgresql-downloads) — anote a senha do `postgres`

### 2. Clonar / copiar os arquivos

```powershell
# Copiar pasta do projeto para, ex.:
C:\FinOps\
```

### 3. Criar banco de dados

```powershell
# Abrir SQL Shell (psql) ou pgAdmin e executar:
CREATE DATABASE finops_db;
```

### 4. Configurar variáveis

```powershell
# Criar C:\FinOps\.env com o conteúdo acima
# Ou definir no ambiente do sistema:
[System.Environment]::SetEnvironmentVariable("DB_PASSWORD","sua_senha","Machine")
```

### 5. Instalar dependências e iniciar

```powershell
cd C:\FinOps
npm install
npm start          # produção
# ou
npm run dev        # desenvolvimento com hot-reload (nodemon)
```

Acesse: `http://localhost:3000`  
Na primeira abertura o wizard de configuração é exibido automaticamente.

### 6. Executar como serviço Windows (PM2)

```powershell
npm install -g pm2
npm install -g pm2-windows-startup
pm2 start server.js --name finops-manager
pm2 save
pm2-startup install
```

Para verificar:
```powershell
pm2 status
pm2 logs finops-manager
```

---

## Linux (Ubuntu / Debian)

### 1. Instalar Node.js 18

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Instalar PostgreSQL

```bash
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### 3. Criar banco e usuário

```bash
sudo -u postgres psql <<EOF
CREATE DATABASE finops_db;
CREATE USER finops_user WITH ENCRYPTED PASSWORD 'senha_segura';
GRANT ALL PRIVILEGES ON DATABASE finops_db TO finops_user;
EOF
```

### 4. Configurar aplicação

```bash
# Clonar/copiar arquivos
sudo mkdir -p /opt/finops
sudo cp -r /caminho/dos/arquivos/* /opt/finops/
sudo chown -R $USER:$USER /opt/finops

cd /opt/finops
npm install --omit=dev

# Criar .env
cat > .env <<EOF
DB_HOST=localhost
DB_PORT=5432
DB_NAME=finops_db
DB_USER=finops_user
DB_PASSWORD=senha_segura
JWT_SECRET=$(openssl rand -hex 32)
MASTER_KEY=$(openssl rand -hex 16)
PORT=3000
ALLOWED_ORIGIN=https://seu-dominio.com
EOF
chmod 600 .env
```

### 5. Iniciar com PM2

```bash
sudo npm install -g pm2
cd /opt/finops
pm2 start server.js --name finops-manager
pm2 save
pm2 startup   # copia o comando gerado e executa com sudo
```

### 6. Systemd (alternativa ao PM2)

```bash
sudo tee /etc/systemd/system/finops.service > /dev/null <<EOF
[Unit]
Description=FinOps Manager
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
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

## Docker

### Dockerfile

Crie `Dockerfile` na raiz do projeto:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p uploads_tmp
EXPOSE 3000
CMD ["node", "server.js"]
```

Crie também `.dockerignore` (já incluso no projeto):

```
node_modules/
uploads_tmp/
.env
.env.key
.git/
*.log
```

> **Armazenamento efêmero:** em containers, a pasta `uploads_tmp/` é perdida ao reiniciar. Os arquivos CSV são deletados automaticamente após o import, portanto isso não afeta os dados — que ficam no PostgreSQL.

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
      DB_PASSWORD: senha_segura
      JWT_SECRET: troque-em-producao
      MASTER_KEY: troque-em-producao-32c
      PORT: 3000
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: finops_db
      POSTGRES_USER: finops_user
      POSTGRES_PASSWORD: senha_segura
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
docker-compose up -d
docker-compose logs -f app
```

---

## Azure

### Opção A — App Service + Azure Database for PostgreSQL Flexible

#### 1. Criar recursos

```bash
# Login e grupo de recursos
az login
az group create --name rg-finops --location brazilsouth

# PostgreSQL Flexible Server
az postgres flexible-server create \
  --resource-group rg-finops \
  --name finops-pg \
  --location brazilsouth \
  --admin-user finops_user \
  --admin-password "SenhaSegura123!" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 16 \
  --public-access 0.0.0.0   # apenas para teste; em produção use VNet integration

az postgres flexible-server db create \
  --resource-group rg-finops \
  --server-name finops-pg \
  --database-name finops_db

# App Service Plan (Linux B1 ~$13/mês)
az appservice plan create \
  --name plan-finops \
  --resource-group rg-finops \
  --sku B1 \
  --is-linux

# Web App
az webapp create \
  --resource-group rg-finops \
  --plan plan-finops \
  --name finops-manager \
  --runtime "NODE:18-lts"
```

#### 2. Configurar variáveis de ambiente

```bash
az webapp config appsettings set \
  --resource-group rg-finops \
  --name finops-manager \
  --settings \
    DB_HOST="finops-pg.postgres.database.azure.com" \
    DB_PORT="5432" \
    DB_NAME="finops_db" \
    DB_USER="finops_user" \
    DB_PASSWORD="SenhaSegura123!" \
    JWT_SECRET="$(openssl rand -hex 32)" \
    MASTER_KEY="$(openssl rand -hex 16)" \
    PORT="8080" \
    ALLOWED_ORIGIN="https://finops-manager.azurewebsites.net" \
    WEBSITE_NODE_DEFAULT_VERSION="~18"
```

#### 3. Deploy

```bash
# Via ZIP deploy
zip -r deploy.zip . --exclude="node_modules/*" --exclude=".git/*" --exclude="uploads_tmp/*"
az webapp deployment source config-zip \
  --resource-group rg-finops \
  --name finops-manager \
  --src deploy.zip
```

#### 4. SSL — gerado automaticamente pelo App Service

Acesse: `https://finops-manager.azurewebsites.net`

---

### Opção B — Azure Container Instances (Docker)

```bash
az acr create --resource-group rg-finops --name finopsacr --sku Basic
az acr build --registry finopsacr --image finops-manager:latest .
az container create \
  --resource-group rg-finops \
  --name finops-aci \
  --image finopsacr.azurecr.io/finops-manager:latest \
  --cpu 1 --memory 1.5 \
  --ports 3000 \
  --environment-variables DB_HOST=finops-pg.postgres.database.azure.com ...
```

---

## AWS

### EC2 + RDS PostgreSQL

#### 1. RDS PostgreSQL

```bash
aws rds create-db-instance \
  --db-instance-identifier finops-pg \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 16 \
  --master-username finops_user \
  --master-user-password "SenhaSegura123!" \
  --allocated-storage 20 \
  --db-name finops_db \
  --no-publicly-accessible

# Anote o endpoint gerado (finops-pg.xxxx.us-east-1.rds.amazonaws.com)
```

#### 2. EC2 (Amazon Linux 2023)

```bash
# No servidor EC2:
sudo dnf install -y nodejs20 npm
sudo npm install -g pm2

mkdir /home/ec2-user/finops
# Copiar arquivos via scp ou CodeDeploy
cd /home/ec2-user/finops
npm install --omit=dev

cat > .env <<EOF
DB_HOST=finops-pg.xxxx.us-east-1.rds.amazonaws.com
DB_PORT=5432
DB_NAME=finops_db
DB_USER=finops_user
DB_PASSWORD=SenhaSegura123!
JWT_SECRET=$(openssl rand -hex 32)
MASTER_KEY=$(openssl rand -hex 16)
PORT=3000
EOF

pm2 start server.js --name finops-manager
pm2 startup && pm2 save
```

#### 3. Usar AWS Secrets Manager (recomendado)

```bash
aws secretsmanager create-secret \
  --name finops/env \
  --secret-string '{"DB_PASSWORD":"...","JWT_SECRET":"...","MASTER_KEY":"..."}'
```

Opção A: exportar os secrets como variáveis de ambiente antes de iniciar via script de bootstrap na instância EC2.  
Opção B: usar o parâmetro `--environment-file` do ECS / App Runner para injetar os valores automaticamente.

---

## GCP

### Cloud Run + Cloud SQL

#### 1. Cloud SQL PostgreSQL

```bash
gcloud sql instances create finops-pg \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=southamerica-east1

gcloud sql databases create finops_db --instance=finops-pg
gcloud sql users create finops_user \
  --instance=finops-pg \
  --password=SenhaSegura123!
```

#### 2. Build e push da imagem

```bash
gcloud builds submit --tag gcr.io/SEU_PROJETO/finops-manager
```

#### 3. Deploy no Cloud Run

```bash
gcloud run deploy finops-manager \
  --image gcr.io/SEU_PROJETO/finops-manager \
  --platform managed \
  --region southamerica-east1 \
  --allow-unauthenticated \
  --add-cloudsql-instances SEU_PROJETO:southamerica-east1:finops-pg \
  --set-env-vars \
    DB_HOST="/cloudsql/SEU_PROJETO:southamerica-east1:finops-pg",\
    DB_NAME=finops_db,\
    DB_USER=finops_user,\
    DB_PASSWORD=SenhaSegura123!,\
    JWT_SECRET=troque,\
    MASTER_KEY=troque,\
    PORT=8080
```

> Cloud Run escala automaticamente para zero — ideal para ambientes sem tráfego constante.

---

## SaaS

### Railway

```bash
# railway.app — mais simples para começar
npm install -g @railway/cli
railway login
railway init
railway add --plugin postgresql   # provisiona PostgreSQL automaticamente
railway up
# Variáveis de ambiente: Railway Dashboard → Variables
# DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD preenchidos automaticamente pelo plugin
```

### Render

1. Criar conta em [render.com](https://render.com)
2. **New → Web Service** → conectar repositório Git
3. Build command: `npm install`
4. Start command: `node server.js`
5. **New → PostgreSQL** → criar instância gratuita
6. Em **Environment**, adicionar `JWT_SECRET` e `MASTER_KEY` — `DATABASE_URL` é preenchido automaticamente pelo Render
7. `DATABASE_URL` é suportado nativamente pelo server.js: se presente e `DB_HOST` não estiver definido, as variáveis individuais são extraídas automaticamente

### Fly.io

```bash
npm install -g flyctl
fly auth login
fly launch --name finops-manager --region gru   # São Paulo
fly postgres create --name finops-pg --region gru
fly postgres attach finops-pg
fly secrets set JWT_SECRET=$(openssl rand -hex 32) MASTER_KEY=$(openssl rand -hex 16)
fly deploy
```

---

## SSL / Proxy reverso

### Nginx + Certbot (Let's Encrypt)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

# /etc/nginx/sites-available/finops
sudo tee /etc/nginx/sites-available/finops > /dev/null <<EOF
server {
    listen 80;
    server_name seu-dominio.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_cache_bypass \$http_upgrade;
        client_max_body_size 600M;   # uploads de CSV grandes
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/finops /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Certificado SSL gratuito
sudo certbot --nginx -d seu-dominio.com
```

---

## Segurança em produção

### Criptografar .env

```bash
# 1. Configure o .env com as variáveis reais
# 2. Criptografe
node encrypt-env.js encrypt
# → gera .env.enc (criptografado) e .env.key (chave)

# 3. Apague o .env original
rm .env

# 4. Guarde .env.key em local seguro (cofre, Secrets Manager, Key Vault)
# NUNCA envie .env.key para o repositório Git

# 5. Iniciar o servidor com env criptografado
node encrypt-env.js run
# ou via npm:
# "start": "node encrypt-env.js run"
```

### .gitignore recomendado

```gitignore
.env
.env.key
.env.enc
.finops_setup
node_modules/
uploads_tmp/
*.log
```

### Checklist de produção

- [ ] `JWT_SECRET` — string aleatória de 32+ caracteres (`openssl rand -hex 32`)
- [ ] `MASTER_KEY` — string aleatória de 32+ caracteres
- [ ] `DB_PASSWORD` — senha forte, usuário PostgreSQL com acesso mínimo
- [ ] `ALLOWED_ORIGIN` — domínio exato da aplicação (não `null`)
- [ ] SSL/TLS ativo — Nginx + Certbot ou certificado do provedor cloud
- [ ] PostgreSQL — não exposto publicamente (acesso via VPC/rede privada)
- [ ] Porta 3000 — não exposta diretamente; servir via Nginx na 443
- [ ] `uploads_tmp/` — fora do repositório, com espaço suficiente (CSVs podem ter 500 MB+)
- [ ] Backups do banco — automáticos via RDS/Cloud SQL ou `pg_dump` agendado

---

## API Endpoints

Todos os endpoints (exceto `/api/auth/*` e `/api/health`) exigem header:
```
Authorization: Bearer <jwt_token>
```

### Autenticação
| Método | Rota                | Descrição                         |
|--------|---------------------|-----------------------------------|
| POST   | /api/auth/login     | Login local (email + senha)       |
| POST   | /api/auth/ad        | Login Active Directory (LDAP)     |
| GET    | /api/auth/entra/redirect | Inicia OAuth Microsoft Entra  |
| GET    | /api/auth/entra/callback | Callback OAuth                |

### Projetos
| Método | Rota              | Descrição         |
|--------|-------------------|-------------------|
| GET    | /api/projetos     | Listar projetos   |
| POST   | /api/projetos     | Criar projeto     |
| PUT    | /api/projetos/:id | Atualizar         |
| DELETE | /api/projetos/:id | Excluir           |

### Ações FinOps
| Método | Rota           | Descrição                         |
|--------|----------------|-----------------------------------|
| GET    | /api/acoes     | Listar (suporta filtros via query) |
| POST   | /api/acoes     | Criar ação                        |
| PUT    | /api/acoes/:id | Atualizar                         |
| DELETE | /api/acoes/:id | Excluir                           |

### Dashboard / Export
| Método | Rota              | Descrição                          |
|--------|-------------------|------------------------------------|
| GET    | /api/dashboard    | Estatísticas agregadas             |
| GET    | /api/export/excel | Download .xlsx (3 abas)            |

### Calculadora Azure
| Método | Rota                             | Descrição                           |
|--------|----------------------------------|-------------------------------------|
| GET    | /api/calculadora/subscriptions   | Lista assinaturas (do cache)        |
| GET    | /api/calculadora/resource-groups | Lista RGs por assinatura (do cache) |
| GET    | /api/calculadora/recursos        | Recursos com custo/hora calculado   |
| POST   | /api/calculadora/estimar         | Estimativa de custo por horas       |
| POST   | /api/azure-costs/import          | Upload CSV ou Parquet               |

### Sistema
| Método | Rota          | Descrição                      |
|--------|---------------|--------------------------------|
| GET    | /api/health   | Status da conexão com o banco  |
| GET    | /api/usuarios | Listar usuários (admin)        |
| POST   | /api/usuarios | Criar usuário (admin)          |
