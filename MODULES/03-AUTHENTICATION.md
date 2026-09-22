# 03-AUTHENTICATION — JWT, LDAP, Entra, SSO

## Token Lifecycle

**JWT payload** (all three auth methods issue the same):
```json
{
  "id": "user_id",
  "nome": "User Name",
  "email": "user@example.com",
  "perfil": "admin|finops|reader"
}
```

**Storage**:
- `sessionStorage['finops_token']` (priority)
- `localStorage['finops_token']` (fallback)

**Expiration**: `JWT_EXPIRES` (default 8h)
**Refresh**: `GET /api/auth/refresh` → re-reads `usuarios` table, returns new token if user still `ativo=true`

**Revocation**: deactivate user in database → next refresh returns 401 (no token expiry wait needed)

## Authentication Methods

### 1. Local (Database)

```javascript
POST /api/auth/login { usuario, senha }
├─ hash senha with bcrypt
├─ compare against usuarios.senha_hash
└─ if match → issue JWT
```

**Stored in**: `usuarios` table, `tipo='local'`

### 2. Active Directory (LDAP)

```javascript
POST /api/auth/ad { usuario, senha }
├─ ldapjs.createClient() → AD server
├─ ldapBind(usuario, senha) → verify credentials
├─ ldapSearch() → find user, read memberOf
├─ map memberOf GUIDs → perfil via grp_admin / grp_finops config
├─ upsert into usuarios (tipo='ad')
└─ issue JWT
```

**Config**: `integracoes` table (`tipo='ad'`), fields `host`, `dn_base`, `grp_admin`, `grp_finops`

**Rate limit**: 20 req/15 min (same as local)

### 3. Microsoft Entra ID (OAuth 2.0)

```javascript
GET /api/auth/entra/url
├─ generate random state (CSRF, 10 min TTL, single-use)
├─ return authorize URL (Microsoft identity platform)
└─ state stored in _entraStates Map

GET /auth/callback?code=<auth_code>&state=<state>
├─ validate state (must exist, unused)
├─ POST /token → Microsoft
├─ verify id_token signature vs tenant JWKS (RS256)
├─ validate issuer, audience
├─ extract groups claim (group Object IDs)
├─ map groups → perfil (same as AD)
├─ upsert usuarios (tipo='entra')
├─ issue our own JWT
├─ redirect to /?entra_handoff=<code> (one-time handoff code)
└─ SPA consumes: GET /api/auth/entra/consume?code= → {token, user}

# Auth failure → redirect to /?entra_error=<msg>
```

**Config**: `integracoes` table (`tipo='entra'`), fields `client_id`, `client_secret`, `redirect_uri`, `grp_admin`, `grp_finops`

**Handoff codes**: `_entraHandoffs` Map, 60s TTL (one-time, single-use)

**Groups overage** ⚠️: When user belongs to many groups, Microsoft sends `_claim_names`/`_claim_values` instead of `groups` array. **Not implemented** — falls back to `perfil='reader'`. Fix: add `GroupMember.Read.All` scope + Microsoft Graph call.

**Admin prerequisite**: "Add groups claim" under App registration → Token configuration (must be configured by account admin, not this server)

### Permission Gates

```javascript
authMiddleware    // verifies Bearer token, sets req.user
adminMiddleware   // verifies perfil === 'admin' (added 2026-08-24)
dbMiddleware      // returns 503 if pool is null (pre-setup)
```

**Vulnerability fixed 2026-08-24**: `POST/PUT/DELETE /api/usuarios/*` and credential endpoints now require `adminMiddleware` (were only `authMiddleware` → any user could self-promote or mint admin tokens)

## Rate Limiting

```
/api/auth/login   → 20 req / 15 min
/api/auth/ad      → 20 req / 15 min
/api/auth/entra/* → NOT rate-limited (state validation gates brute force)
```

Implemented via `express-rate-limit`.

## Session Management

**Invalidation on**:
- User deactivated in database (`ativo=false`)
- Token expires (no auto-renew; user must re-login)
- `DELETE /api/sessoes/:id` called by admin (remove a user's session)

**Session table** (`sessoes`):
- `usuario_id`, `token_hash`, `ip`, `user_agent`, `criado_em`, `expira_em`
- Rows are informational only; actual auth via JWT verification, not DB lookup

---

See `server.js:200–600` for implementation, line by line.
