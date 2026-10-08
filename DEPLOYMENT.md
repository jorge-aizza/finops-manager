# Deployment Guide — FinOps Manager v4.2.1

**Status:** ✅ Ready for production  
**Last Updated:** 2026-10-08  
**Branch:** `main` (GitHub: jorge-aizza/finops-manager)

---

## 🚀 Quick Deploy

```bash
# 1. Get latest code
git pull origin main

# 2. Install & build
npm install
npm run frontend:build

# 3. Update .env (PRODUCTION SECRETS ONLY)
# JWT_SECRET=<secure-32-chars>
# MASTER_KEY=<secure-32-chars>
# NODE_ENV=production

# 4. Start app
npm start
# OR: pm2 start npm --name "finops" -- start
```

---

## 📋 Full Deployment Checklist

### Pre-Deployment
- [ ] Pull latest code: `git pull origin main`
- [ ] Review `.env` — use **production secrets** (≥32 chars)
  - `JWT_SECRET` — unique to prod
  - `MASTER_KEY` — unique to prod
  - `DB_PASSWORD` — secure password
  - `ALLOWED_ORIGIN` — HTTPS URL only
  - `NODE_ENV=production`

### Build
- [ ] Install deps: `npm install`
- [ ] Build frontend: `npm run frontend:build`
  - Expected: `frontend/dist/react-app.js` (~490KB)
  - Verify: no TypeScript errors
- [ ] Encrypt .env: `node encrypt-env.js` (if using encryption)

### Deploy
- [ ] Migrate DB (if needed): `npm run migrate`
- [ ] Start app:
  - **PM2** (recommended): `pm2 start npm --name "finops" -- start`
  - **Systemd**: `sudo systemctl restart finops-manager`
  - **Direct**: `NODE_ENV=production npm start`
- [ ] Verify startup: logs show no errors

### Post-Deploy Validation
- [ ] API responds: `curl https://your-domain.com/api/azure-coleta/status`
  - Expected: `{"em_execucao":false, "execucoes":[], ...}`
- [ ] Frontend loads: open https://your-domain.com in browser
- [ ] Agendamento shows new UI:
  - Horário: `[HH] : [MM]` format
  - Badge: "☀ Dia" or "🌙 Noite"
  - Option: "A cada 1 dia" radio button
- [ ] Test with 2+ SPs scheduled → verify parallel execution
- [ ] Monitor logs: `tail -f /var/log/finops.log`

---

## 📦 What's New (v4.2.1)

### Features
1. **Parallel Coletas** (v4.2.0)
   - Multiple Service Principals run simultaneously
   - Map-based mutex per SP (type:id)
   - Safety valve: 6h timeout for stuck executions
   - GET `/status` exposes `execucoes[]` array

2. **Frontend Updates** (v4.2.0)
   - ColetaMonitor: multi-card layout
   - AgendamentoModal: SP-specific validation
   - WizardColetaModal: SP-specific check
   - Tests: 377/380 passing

3. **Scheduling UI** (v4.2.1)
   - Horário: HH:MM format (not just H)
   - Badge: Visual day/night indicator
   - Option: "A cada 1 dia" (every day) radio button
   - Backward compatible: old data still works

### Database
- No schema changes required
- Existing `hora_execucao` (INTEGER) still works
- `dias_semana` (TEXT) now receives "0,1,2,3,4,5,6" for daily schedules

---

## 🔍 Verification Commands

```bash
# Check Git status
git log --oneline HEAD~5

# Verify build artifacts
ls -lh frontend/dist/

# Test API endpoint (requires JWT token)
curl -H "Authorization: Bearer <TOKEN>" \
  https://your-domain.com/api/azure-coleta/status

# Watch logs
tail -f /var/log/finops.log

# PM2 status (if using PM2)
pm2 status
pm2 logs finops
```

---

## ⚠️ Important Notes

- **Frontend build is mandatory** for production
- **Use production secrets** — never use dev values in prod
- **HTTPS required** for `ALLOWED_ORIGIN`
- **Database must be running** before app start
- **Multiple instances:** if using load balancing, only ONE scheduler should run (configure via env var if needed)

---

## 📞 Support

- **Docs:** See `CLAUDE.md` and `MODULES/` directory
- **Issues:** GitHub Issues or contact team lead
- **Logs:** `/var/log/finops.log` (or PM2 logs)

---

## 🔄 Rollback

If issues occur:
```bash
git log --oneline  # Find previous stable commit
git checkout <commit-hash>
npm install && npm run frontend:build
npm start
```

---

**Deploy completed by:** Jorge Aizza  
**Date:** 2026-10-08  
**Commits:** 5 (coletas simultâneas + agendamento UI)
