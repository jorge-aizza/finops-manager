# 07-EMAIL-ALERTS — SMTP, Dedup, Event Triggers

## SMTP Configuration

**Stored in**: `integracoes` table, `tipo='smtp'`, `config` field (JSONB, encrypted)

**Fields**:
```javascript
{
  host: "smtp.mailtrap.io",
  port: 587,
  secure: true,      // false for port 587 (STARTTLS), true for 465 (implicit TLS)
  username: "user",
  password: "pass",  // encrypted with MASTER_KEY
  from_address: "alerts@example.com",
  default_recipients: ["admin@example.com", "ops@example.com"]
}
```

**Encryption**: Same as Azure/Databricks secrets → `_encryptSecret()` / `_safeDecrypt()`

**Never returned by GET**: `_maskSensitiveFields()` returns `password: undefined`

## Deduplication (24h Cooldown)

**Table**: `email_alertas_enviados` (`tipo`, `chave`, `enviado_em`, UNIQUE(tipo,chave))

**Logic**:
```sql
INSERT INTO email_alertas_enviados (tipo, chave) VALUES ($1, $2)
ON CONFLICT (tipo, chave) DO UPDATE SET enviado_em = NOW()
WHERE enviado_em < NOW() - INTERVAL '24 hours'
RETURNING id  -- empty if still in cooldown
```

**Key formats**:
- Coleta error: `coleta_erro:azure|databricks`
- Orçamento: `orcamento:{id}:{YYYY-MM}` (monthly, re-warns if still over)
- Reserva: `reserva:{id}`
- Ação: `acao:{id}` (warns daily until vencida is fixed)

## Event Triggers (4 types)

| Trigger | Event | Gate | Cooldown |
|---------|-------|------|----------|
| **Coleta error** | Coleta completes with `error` status | Always | No (1x per failure) |
| **Orçamento** | Budget crosses 75%/90%/100% threshold | Scheduled (_iniciarAlertasEmail hourly) | 24h per threshold |
| **Reserva** | `data_vencimento - NOW() ≤ 90 days` | Scheduled | 24h |
| **Ação** | `data_vencimento - NOW() ≤ 5 days` | Scheduled | 24h |

## Scheduled Checks

**`_iniciarAlertasEmail()`** — `setInterval` separate from coleta scheduler:
- First run: 3 min after boot
- Repeat: every hour
- Gates: `_checkOrcamentosDatabricks()`, `_checkReservasVencendo()`, `_checkAcoesVencendo()`, `_checkRelatorioDiarioInventario()`

## SMTP Details

**Timeouts** (if exceeded, backoff retry or fail):
```javascript
connectionTimeout: 10_000,    // TCP connect
greetingTimeout: 10_000,      // Server greeting
socketTimeout: 10_000         // Per-command
```

**Optional**: `POST /api/integrations/smtp/testar` — test credentials without saving.

## Destinations

**Infrastructure alerts** (coleta, orçamento):
- `integracoes.config.default_recipients` (admin list from SMTP config)

**Personal alerts** (reserva, ação):
- `{table}.criado_por` (FK to `usuarios`, use `.email`) when exists
- Fallback: search `usuarios.nome ILIKE responsavel` (loose text match)
- No match: `default_recipients`

## Fallback (No SMTP)

If SMTP not configured or `ativo=false`:
- All functions silently return (no-op)
- Alerts still appear in bell icon (notification panel)
- Email gates are not hit

## Ring Buffer

**`_emailLog`** (50-entry in-memory buffer): every send attempt logged (test or real)

```javascript
_logEmailAttempt({ type, destinatarios, error });
// { type: 'Teste' | 'Envio', timestamp, destinatarios, error, status }
```

**Route**: `GET /integrations/smtp/log` (admin-only) — exposes last 50 in reverse chronological order.

---

See **01-STARTUP.md** for timer lifecycle; **03-AUTHENTICATION.md** for how credentials are stored securely.
