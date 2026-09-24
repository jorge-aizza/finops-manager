# CLAUDE.md — FinOps Manager v4.0

**Quick reference for Claude Code.** Deployment: `README.md`. Detailed context: `~/.claude/projects/.../memory/MEMORY.md`.

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

## 📚 Modules

| Module | Focus |
|--------|-------|
| **01-STARTUP** | Boot, 12 bg tasks |
| **02-ARCHITECTURE** | Design, layers, flows |
| **03-AUTHENTICATION** | JWT, LDAP, Entra ID, SSO |
| **04-AZURE-API** | Resource Manager, Cost, Graph |
| **05-DATABRICKS-API** | OAuth M2M, System Tables |
| **06-DATABASE** | PostgreSQL, schema, indexes |
| **07-EMAIL-ALERTS** | SMTP, dedup, triggers |
| **08-FRONTEND-REACT** | Strangler fig, migration |
| **09-CALCULADORA** | Financial rules (RN-*) |
| **10-DEPLOYMENT** | Docker, cloud platforms |

See `MODULES/` for full docs.

---

## 🗂️ Key Files

| File | Purpose |
|------|---------|
| `server.js` | API, auth, DB, Excel |
| `app.js` | Wizard, login, views |
| `calculadora.js` | Cost calculator |
| `index.html` | SPA shell |
| `portal.html` | Public calc (React) |
| `styles.css` | Theme (Vivo purple) |
| `frontend/` | React app (Vite) |

---

## 💡 Detailed Guides (in Memory)

- **[[auth-and-secrets]]** — 3 auth methods, env vars, encryption
- **[[business-rules]]** — RN-* cost rules, Databricks billing
- **[[database-schema]]** — Tables, indexes, resource_id case handling
- **[[frontend-react-migration]]** — Strangler fig pattern
- **[[branding-logos]]** — Theme-aware logos, CSS filters

---

## ✅ Prod Checklist

- `JWT_SECRET`, `MASTER_KEY` (≥32 chars)
- `ALLOWED_ORIGIN` set for HTTPS
- `.env` encrypted
- `frontend/dist/` built
- PostgreSQL migrations run
- PM2/systemd auto-restart

See **DEPLOYMENT_CHECKLIST.md** for full list.
