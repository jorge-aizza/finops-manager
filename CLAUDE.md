# CLAUDE.md — FinOps Manager v4.3

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
| `MODULES/` | Documentação detalhada por subsistema (01–15) |
| `tests/` | Jest/Playwright test suite |
| `fonts/`, `libs/` | Static assets & libraries |

---

## 🏗️ System Layers

Uma linha por subsistema; os detalhes (funções, tabelas, decisões) ficam no módulo.

| Component | Tech / escopo | Módulo |
|-----------|---------------|--------|
| **Backend API** | Node.js + Express | `01-STARTUP`, `02-ARCHITECTURE` |
| **Authentication** | JWT, LDAP, Entra ID | `03-AUTHENTICATION` |
| **Azure Integration** | Resource Manager, Cost API, Resource Graph; coleta por API e por Storage; multi-SP com coleta simultânea e filtro global de Tenant | `04-AZURE-API` |
| **Databricks** | OAuth M2M, System Tables | `05-DATABRICKS-API` (setup não-técnico: `05-DATABRICKS-SETUP-GUIA`) |
| **Database** | PostgreSQL, tabelas particionadas | `06-DATABASE` |
| **Alerts** | SMTP e relay anônimo, dedup, gatilhos; liga/desliga por alerta | `07-EMAIL-ALERTS` |
| **Frontend** | React (Vite), Strangler fig pattern | `08-FRONTEND-REACT` |
| **Cost Rules** | Fórmulas RN-* | `09-CALCULADORA` |
| **Deployment** | Docker, PM2, systemd | `10-DEPLOYMENT` |
| **Log Analytics FinOps** | Workspace/tabela/retenção/custo real, Diagnostic Settings, DCR, App Insights, auditoria KQL, Sentinel e Commitment Tier separados, sugestão de tier, progresso e backfill | `11-LOG-ANALYTICS` |
| **Desperdício & Economia** | Órfão identificado + excluído + custo faturado = saving auditável | `12-DESPERDICIO-ECONOMIA` |
| **Mailing de Comunicados** | Broadcast via relay SMTP próprio, contatos em grupos, editor visual (TipTap) com hyperlinks e tabelas editáveis, acompanhamento por destinatário | `13-MAILING` |
| **Reservas** | Reservas e Savings Plans; cadastro manual, sync por SP, export via Storage e upload de CSV pela tela convergindo na mesma linha | `14-RESERVAS` |

---

## ⚠️ Armadilhas conhecidas

Coisas que já custaram bug em produção. Cada linha abaixo é o **gatilho** — se for mexer na
área, pare e leia o módulo antes. O porquê, a medição que sustenta a regra e o histórico de
cada uma ficam no módulo indicado, não aqui.

**Coleta Azure & Multi-SP** — `MODULES/04-AZURE-API.md`
- **O token de uma SP devolve 403 nas assinaturas de outra.** Nunca misture assinaturas de SPs diferentes numa só chamada ARM/Resource Graph: `_getInventarioEscopos()`, ou `_resourceGraphQueryTodasSps()` para rodar em todas.
- **Atribuição de SP é por `subscription_id`, nunca por `sp_id`.** `azure_costs` não tem coluna de SP.
- **Coletas simultâneas: estado por execução, não global.** `_coletasEmExecucao` é um Map (`api:7`, `storage:3`); os getters globais resolvem para a PRIMEIRA entrada. Passe `progresso`/`isCancelada` por parâmetro — `_logColeta(msg, progresso)` exige o 2º argumento.
- **`azure_price_list` está inteiro em USD** (`retail_price_brl` é NULL nas 546 mil linhas). Nunca escreva "R$" na frente de `retail_price`; o catálogo só serve para a FORMA da escada de preço, a escala vem da fatura.

**Log Analytics** — `MODULES/11-LOG-ANALYTICS.md`
- **Pedir período maior que a retenção NÃO dá erro — devolve vazio.** Toda janela parametrizável passa pelo clamp de `_laRetencaoTabela()` antes de sair. Use `retencao_dias`, nunca `retencao_total_dias`. Clamp do volume é por workspace; o da atribuição por recurso é por TABELA.
- **A janela do mês corrente corta no último dia com custo fechado**, não em hoje (`_janelaLogAnalytics()`, `async`). Tela nova que soma custo precisa usar a MESMA janela.
- **A coleta própria de GB começou em 30/08/2026.** Mês anterior é cobertura parcial, não consumo baixo — a tela avisa via `dias_com_gb` vs `dias_janela`.

**Desperdício & Economia** — `MODULES/12-DESPERDICIO-ECONOMIA.md`
- **Métrica nova tem que usar a MESMA base de recorte da métrica irmã.** Divergência proposital se expõe na tela, não se omite.
- **`custo_mensal_estimado === null` é "não achamos o billing", NUNCA "é grátis".** O recorte é por TIPO que não fatura (`_DESP_CATEGORIAS_SEM_CUSTO`), não por custo nulo.
- **Economia só conta exclusão após 30 dias como órfão** (`_SAVING_DIAS_MIN_ORFAO`). Quem não cumpre o piso continua visível no detalhe, marcado.
- **Dado que só existe no Resource Graph precisa ser gravado na DETECÇÃO** — depois de excluído, o recurso some do ARG.
- **"Dias como órfão" usa `desde_orfao_em`, nunca `primeira_deteccao_em` direto.** A leitura é por `diasOrfaoNaExclusao()` (`savingOrfaos.js`) — não reabra a conta na mão.

**Alertas por e-mail** — `MODULES/07-EMAIL-ALERTS.md`
- **Sem transporte configurado, NENHUM alerta sai — e nada na tela diz isso.** Antes de investigar "por que o alerta X não chegou", confira `alertas_relay` e `smtp` em `integracoes`.
- **O liga/desliga de alerta vale no ENVIO, não na detecção** — o sino continua registrando. E o banco guarda os DESATIVADOS, para alerta novo nascer ligado.
- **A seleção de alertas aparece em dois cards e é a MESMA configuração.** `salvarAlertasTipos(botão)` lê o bloco DO BOTÃO, nunca um id fixo.
- **E-mail só para o que é acionável, com prazo, em volume limitado e para quem pode agir** — os quatro critérios juntos. Alerta por item dentro de laço vira rajada sem teto.

**Mailing de Comunicados** — `MODULES/13-MAILING.md`
- **Imagem em e-mail NUNCA vai por URL — vai embutida (`cid:`).** `_mailingEmbutirImagens()` dentro de `_sendMailingEmail()`. Marcar o remetente como confiável NÃO resolve: confiar autoriza o download, não cria rota. Como o arquivo vai em CADA mensagem, imagem de template é dimensionada para o e-mail.
- **Tabela de dados é HTML estruturado, nunca texto alinhado por espaços.** O editor oferece modelos e ajuste de linhas/colunas; hyperlinks devem ser anchors com `href`. O envelope preserva espaços repetidos e aplica grade às tabelas de dados, mas não à tabela com imagem da assinatura.
- **Contato pode estar em vários grupos.** A lista do Mailing exibe todos os grupos por contato; a API agrega os nomes em uma consulta.

**Reservas** — `MODULES/14-RESERVAS.md`
- **Reserva vinda de relatório precisa colidir com a mesma reserva vinda via SP, não duplicar.** Vale para o export lido do Storage e para o CSV subido pela tela — os dois usam o mesmo mapeador, que reconstrói o `azure_id` no formato da API ARM para cair no mesmo `uq_reservas_azure_id`. Via nova de importação só evita duplicar se reconstruir o MESMO formato de id.
- **Do export Azure, só o cabeçalho e uma linha real estão confirmados.** `Status`/`Scope` fora dos casos já vistos seguem por casamento de substring com fallback pela data — ajuste ali, não é bug de lógica.
- **`azureReservas.js` tem seu PRÓPRIO desempate de data M/D vs D/M** — é uma cópia portada, não o `_toDate()` de `server.js`. Mudar uma não muda a outra.

**Plataforma** — `MODULES/02-ARCHITECTURE.md`
- **`server.js` NÃO roda em modo estrito**, apesar do `'use strict'` na linha 3 (BOM + código antes da diretiva). Variável sem `const`/`let` vira global solta em silêncio; `node --check` não pega.
- **Rota literal depois de rota com `:param` no mesmo prefixo é engolida em silêncio.** Express casa por ordem de registro — o sintoma é "salvou e não persistiu", só aparece em teste que RELÊ o estado.
- **`frontend/dist/` é gitignored.** Deploy sem `npm run frontend:build` serve tela em branco.

**Banco** — `MODULES/06-DATABASE.md`
- **Regex no Postgres é POSIX, não PCRE.** `~` e `regexp_match()` tratam `\d` como `d` literal — use `[0-9]`. Uma junção com `\d` casa zero linhas em silêncio.

---

## 💡 Memory Topics

- **[[auth-and-secrets]]** — JWT/LDAP/env-vars/encryption
- **[[business-rules]]** — RN-* rules, Databricks billing, Azure reservations, Microsoft/Marketplace imposto split
- **[[database-schema]]** — PostgreSQL tables, indexes, resource_id case
- **[[frontend-react-migration]]** — Strangler fig, bridge, checklist
- **[[branding-logos]]** — Theme-aware assets, CSS filters
- **[[mailing-comunicados]]** — Relay anônimo separado do SMTP de Alertas; unificação pendente
- **[[feedback-consistencia-metricas]]** — Conferir base de recorte entre métricas irmãs

---

## ✅ Prod Deployment

Before shipping:
- `JWT_SECRET`, `MASTER_KEY` (≥32 chars)
- `ALLOWED_ORIGIN` set for HTTPS
- `.env` encrypted
- `npm run frontend:build` executed
- PostgreSQL migrations completed
- PM2/systemd auto-restart configured

O que muda de comportamento no primeiro startup de cada versão (índice criado em
background, tabelas que nascem vazias, agendador disparando todas as SPs), onde ficam os
segredos e por que o relay do Mailing é separado: **`MODULES/10-DEPLOYMENT.md`**,
`DEPLOYMENT_CHECKLIST.md`.

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

Quando a suíte do frontend flakar (pool de forks no Windows), e como provar comportamento
de função embutida em `server.js` sem subir o servidor: **`MODULES/15-TESTING.md`**.
