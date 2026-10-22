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

## Armadilhas conhecidas

Coisas que já custaram bug em produção. O índice resumido de todas fica em `CLAUDE.md`.

**Sem transporte configurado, NENHUM alerta sai — e nada na tela diz isso.**
`_getSmtpConfig()` devolve `null` quando o relay (`alertas_relay`) não está cadastrado/ativo E o
`smtp` está inativo; aí todo `_sendEmail` é no-op silencioso. Estado atual desta base: é
exatamente esse. Antes de investigar "por que o alerta X não chegou", confira os dois tipos em
`integracoes` — a causa quase sempre é transporte, não a regra do alerta.

**O liga/desliga de alerta vale no ENVIO, não na detecção.**
A guarda `_alertaAtivo(chave)` fica no trecho que manda e-mail. Em mudança de propriedade e
anomalia de crescimento ela cobre só o ramo de e-mail, porque o sino precisa continuar
registrando: "não quero o e-mail" é diferente de "não quero saber". E o banco guarda os
**desativados**, não os ativos — alerta novo nasce ligado, em vez de ficar mudo até alguém
lembrar de marcá-lo. Qualquer falha de leitura devolve `true` pelo mesmo motivo.

**A seleção de alertas aparece em dois cards e é a MESMA configuração.**
Relay e SMTP mostram o bloco `.js-alertas-tipos`; `carregarAlertasTipos()` renderiza em todos de
uma vez, marcar num espelha no outro na hora, e `salvarAlertasTipos(botão)` lê o bloco DO BOTÃO —
nunca um id fixo, senão salvar por um card ignoraria o que foi marcado no outro.

**E-mail só para o que é acionável, com prazo, em volume limitado e para quem pode agir.**
Os quatro critérios juntos. Alerta por item dentro de laço de coleta vira rajada sem teto — foi o
caso de mudança de propriedade (hoje só sino) e de anomalia de crescimento (hoje um resumo único;
eram ~157/dia para um destinatário, e de forma recorrente, porque o dedup libera a chave a cada
24h e a janela de detecção são 35 dias). Para rotear ao responsável use `_destinatariosPara()`.

---
