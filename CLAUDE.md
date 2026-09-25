# CLAUDE.md — FinOps Manager v4.0

**Quick reference.** Full docs: `MODULES/` | Memory: `~/.claude/projects/.../memory/MEMORY.md`

## 🚀 Quick Start

```bash
npm install              # Backend dependencies
npm run frontend:install # Frontend React (Vite)
npm run frontend:build   # Build React bundle (REQUIRED before prod)
npm run dev:all          # Dev: Express (3000) + Vite dev server
npm start                # Prod: node server.js
```

⚠️ **Critical**: Prod deploys MUST run `frontend:install` + `frontend:build`. Without the bundle, React screens render blank.

---

## 📁 Project Structure

| Path | Purpose |
|------|---------|
| `server.js` | Express API, auth, database, Excel exports |
| `app.js` | Legacy wizard & login views (being replaced by React) |
| `calculadora.js` | Cost calculator logic & formulas |
| `encrypt-env.js` | Environment variable encryption utility |
| `frontend/` | React app (Vite) — main UI, replaces legacy |
| `MODULES/` | Detailed architecture docs (01–10) |
| `tests/` | Jest/Playwright test suite |
| `fonts/`, `libs/` | Static assets & libraries |

---

## 🏗️ System Layers

| Component | Tech | Module |
|-----------|------|--------|
| **Backend API** | Node.js + Express | 01-STARTUP, 02-ARCHITECTURE |
| **Authentication** | JWT, LDAP, Entra ID | 03-AUTHENTICATION |
| **Azure Integration** | Resource Manager, Cost API, Graph | 04-AZURE-API |
| **Databricks** | OAuth M2M, System Tables | 05-DATABRICKS-API |
| **Database** | PostgreSQL, partitioned tables | 06-DATABASE |
| **Alerts** | SMTP, dedup, smart triggers | 07-EMAIL-ALERTS |
| **Frontend** | React (Vite), Strangler fig pattern | 08-FRONTEND-REACT |
| **Cost Rules** | RN-* financial formulas | 09-CALCULADORA |
| **Deployment** | Docker, PM2, systemd | 10-DEPLOYMENT |

---

## 💡 Memory Topics

- **[[auth-and-secrets]]** — JWT/LDAP/env-vars/encryption
- **[[business-rules]]** — RN-* rules, Databricks billing, Azure reservations
- **[[database-schema]]** — PostgreSQL tables, indexes, resource_id case
- **[[frontend-react-migration]]** — Strangler fig, bridge, checklist
- **[[branding-logos]]** — Theme-aware assets, CSS filters

---

## ✅ Prod Deployment

Before shipping:
- `JWT_SECRET`, `MASTER_KEY` (≥32 chars)
- `ALLOWED_ORIGIN` set for HTTPS
- `.env` encrypted
- `npm run frontend:build` executed
- PostgreSQL migrations completed
- PM2/systemd auto-restart configured

See `MODULES/10-DEPLOYMENT` for full checklist.

---

## 🧪 Testing

```bash
npm run frontend:test    # Jest + Playwright
npm test                 # Backend tests (if configured)
```
