# CLAUDE.md — FinOps Manager v4.2

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
| **Databricks** | OAuth M2M, System Tables | 05-DATABRICKS-API (setup não-técnico: 05-DATABRICKS-SETUP-GUIA) |
| **Database** | PostgreSQL, partitioned tables | 06-DATABASE |
| **Alerts** | SMTP, dedup, smart triggers | 07-EMAIL-ALERTS |
| **Frontend** | React (Vite), Strangler fig pattern | 08-FRONTEND-REACT |
| **Cost Rules** | RN-* financial formulas | 09-CALCULADORA |
| **Log Analytics FinOps** | Workspace/tabela/retenção/custo real, Diagnostic Settings, DCR, App Insights, Auditoria de Consultas KQL, Sentinel e Commitment Tier separados, sugestão de tier | `server.js` ("LOG ANALYTICS FINOPS" block) |
| **Multi-SP (v4.2)** | Coleta simultânea por Service Principal, filtro global de Tenant | `_getInventarioEscopos()`, `_coletasEmExecucao` |
| **Deployment** | Docker, PM2, systemd | 10-DEPLOYMENT |

---

## ⚠️ Armadilhas conhecidas

Coisas que já custaram bug em produção — confira antes de mexer nas áreas correspondentes.

**Multi-SP — o token de uma SP devolve 403 nas assinaturas de outra.**
`_getInventarioEscopos()` é a abstração central: devolve uma entrada por assinatura carregando a credencial da SP dona. Nunca misture assinaturas de SPs diferentes numa só chamada ARM/Resource Graph. Para rodar a mesma consulta em todas, use `_resourceGraphQueryTodasSps()`.

**Atribuição de SP é por `subscription_id`, nunca por `sp_id`.**
`azure_costs` não tem coluna de SP. As SPs não compartilham assinaturas, então o `subscription_id` já identifica a dona (ver `TenantFilterContext.tsx` e `_subsDaSp()`).

**Coletas simultâneas: estado por execução, não global.**
`_coletasEmExecucao` é um Map com chave `tipo:id` (`api:7`, `storage:3`). Os getters globais (`_coletaProgresso`, `_coletaCancelada`) existem só para compatibilidade e resolvem para a **primeira entrada do Map** — usá-los dentro do fluxo de coleta mistura o progresso de uma SP com o de outra. Toda função auxiliar (`_gerarRelatorioAPI`, `_importarArquivosAPI`, `_comRetentativa`) recebe `progresso`/`isCancelada` por parâmetro; `_logColeta(msg, progresso)` exige o segundo argumento.

**`azure_price_list` está inteiro em USD — `retail_price_brl` é NULL nas 546 mil linhas.**
Nunca escreva "R$" na frente de `retail_price`. Esta conta tem desconto de contrato muito abaixo da tabela pública (medido: ~31% na ingestão, ~68% no Sentinel), então o catálogo só serve para a **forma** da escada de preço; a escala vem da fatura (ver `_sugerirCommitmentTier`, que calibra pelo preço real por GB).

**Regex no Postgres é POSIX, não PCRE.**
O operador `~` e `regexp_match()` tratam `\d` como `d` literal. Use `[0-9]`. Uma junção com `\d` casa zero linhas em silêncio.

**A janela do mês corrente corta no último dia com custo fechado.**
`_janelaLogAnalytics()` é `async` e termina no `_ultimoDiaCustoFechado()`, não em hoje — o billing da Azure atrasa. Qualquer tela nova que some custo precisa usar a mesma janela, senão os números não fecham entre cards.

**A coleta própria de GB (`log_analytics_ingestao_diaria`) começou em 30/08/2026.**
Meses anteriores têm cobertura parcial. Número em GB para mês antigo é parcial, não baixo — a tela avisa via `dias_com_gb` vs `dias_janela`.

**`frontend/dist/` é gitignored.** Deploy sem `npm run frontend:build` serve tela em branco.

---

## 💡 Memory Topics

- **[[auth-and-secrets]]** — JWT/LDAP/env-vars/encryption
- **[[business-rules]]** — RN-* rules, Databricks billing, Azure reservations, Microsoft/Marketplace imposto split
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

**Novo na v4.2** — nada manual, mas saiba o que esperar: o índice `idx_azure_costs_cat_date` é
criado em background no startup e leva ~10 min numa base de 9M linhas (telas de observabilidade
ficam lentas até terminar); a tabela `log_analytics_commitment_snapshot` nasce vazia e acumula uma
linha por workspace/dia; o agendador agora dispara **todas** as SPs due no mesmo tick (antes
`LIMIT 1`), então reveja o `max` do pool PostgreSQL se houver muitas SPs ativas.

See `MODULES/10-DEPLOYMENT`, `DEPLOYMENT_CHECKLIST.md` for full checklist.

---

## 🧪 Testing

```bash
npm run frontend:test                      # Vitest + Testing Library (frontend/src/**/*.test.tsx)
cd frontend && npx vitest run <arquivo>    # Um arquivo só
npm test                                   # Backend — node:test em tests/*.test.js (8 skipped: pedem servidor vivo)
node --check server.js                     # Sanidade de sintaxe — server.js tem ~19k linhas
```

Ao escrever teste de tela: envolver o render em `TenantFilterProvider` e mockar `listSPs`, senão
o componente quebra no contexto. `setupTests.ts` já stuba `Element.prototype.scrollIntoView`.
Texto duplicado na tela (mesmo número em dois cards) resolve por `role`, não por `getByText`.

A suíte leva ~4 min e às vezes cospe `[vitest-pool]: Timeout waiting for worker to respond` em
alguns arquivos — é o pool de forks estourando no Windows, não teste quebrado; o exit code segue 0
e a contagem de arquivos fecha. Só investigue se algum arquivo aparecer como `failed`.
