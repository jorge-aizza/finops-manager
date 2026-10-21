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
| **Mailing de Comunicados** | Broadcast corporativo via relay SMTP anônimo, cadastro único de contatos, editor visual (TipTap), acompanhamento por destinatário | `server.js` ("MAILING DE COMUNICADOS" block), `frontend/src/views/Mailing*` |
| **Economia realizada** | Órfão identificado + excluído + custo faturado = saving auditável | `_apurarSavingOrfaos()`, `_resumoSavingOrfaos()`, `azure_desperdicio_saving` |
| **Progresso de coleta (LA)** | Fase/atual/total por tipo, consultado de 2 em 2s pela tela | `_laProgresso` (Map), `GET /log-analytics/progresso`, `LogAnalyticsProgressoBar.tsx` |
| **Backfill sob demanda (LA)** | Período maior que o padrão, limitado pela retenção real da Azure | `_backfillVolumeLogAnalytics()`, `_backfillAtribuicaoRecursoLogAnalytics()` |
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
Meses anteriores têm cobertura parcial. Número em GB para mês antigo é parcial, não baixo — a tela
avisa via `dias_com_gb` vs `dias_janela`. Dá pra ampliar até onde a Azure ainda guarda, pelo
backfill sob demanda da tela (ver armadilha de retenção abaixo).

**Pedir período maior que a retenção NÃO dá erro — devolve vazio.**
É a armadilha central de qualquer coleta de Log Analytics: a Query API não reclama de um período
já expurgado, só retorna menos, e isso vira "consumo zero" quando o certo é "não sabemos" (mesma
família do `null` vs zero acima). Toda consulta com janela parametrizável precisa passar pelo
clamp contra a retenção REAL antes de sair — `_laRetencaoTabela()`. Medido: 91% das tabelas desta
base retêm 30 dias, `Usage` retém 90 em 188 workspaces e 365 em 3. Use `retencao_dias`
(interativa), nunca `retencao_total_dias`: o total inclui Archive Tier, que exige search job
assíncrono e cobrado por GB varrido — usá-lo prometeria alcance que a consulta não entrega.
O clamp do volume é por workspace; o da atribuição por recurso é **por tabela**, porque cada
tabela do top-N tem retenção própria dentro do mesmo workspace.

**`server.js` NÃO roda em modo estrito, apesar do `'use strict'` na linha 3.**
O arquivo começa com BOM e com código executável (`process.env.TZ = ...`) antes da diretiva — e
diretiva só vale como primeira instrução. Confirmado lendo os bytes (`od -c`). Consequência:
variável sem `const`/`let` vira global solta em vez de lançar `ReferenceError`, então esse tipo
de erro passa despercebido por anos. `node --check` também não pega.

**`frontend/dist/` é gitignored.** Deploy sem `npm run frontend:build` serve tela em branco.

**Métrica nova tem que usar a MESMA base de recorte da métrica irmã.**
O usuário pegou isto antes dos testes: o card de economia contava disco de PVC/AKS que a tela de
desperdício ao lado já excluía, e o único recurso com custo apurado era justamente um
`pvc-*` num RG `mc_*` — 100% do número exibido estava errado. Antes de mostrar qualquer número
novo, procure a métrica irmã, veja que filtros ela aplica, e ou aplique os mesmos ou explique na
tela por que não. Divergência proposital se expõe ("1 em validação dentro do total"), não se omite.

**`custo_mensal_estimado === null` é "não achamos o billing", NUNCA "é grátis".**
Por isso o recorte do que aparece na visão de FinOps é por TIPO de recurso que não fatura
(`_DESP_CATEGORIAS_SEM_CUSTO`, hoje só `nic_orfa`), não por custo nulo. Medido amostrando 300
recursos vivos de cada tipo: NIC 0/300 faturam; IP público 287/300; disco 293/300; snapshot
273/300. Filtrar por `null` esconderia 182 discos e snapshots reais, um deles órfão há 1242 dias.

**Economia só conta exclusão após 30 dias como órfão (`_SAVING_DIAS_MIN_ORFAO`).**
É o prazo do fluxo real: o time espera isso antes de agir, então exclusão mais rápida veio do
ciclo de vida da infra, não do processo. Vale para todas as categorias. Quem não cumpre o piso
continua visível no detalhe, marcado — "não contabilizamos" é diferente de "não economizamos", e
esconder impediria calibrar o piso. Exceções que a regra não pega têm marcação manual, com motivo
e autor obrigatórios (`ignorado_*` em `azure_desperdicio_saving`).

**Dado que só existe no Resource Graph precisa ser gravado na DETECÇÃO.**
Depois que o recurso é excluído ele some do ARG. `origem_resource_id` (disco que gerou o snapshot,
usado para não contar a mesma economia duas vezes) e `primeira_deteccao_em` são gravados na hora
da detecção/apuração justamente por isso — e `primeira_deteccao_em` fica congelado: "dias como
órfão na data da exclusão" é fato histórico, não algo que deva mudar depois.

**E-mail só para o que é acionável, com prazo, em volume limitado e para quem pode agir.**
Os quatro critérios juntos. Alerta por item dentro de laço de coleta vira rajada sem teto — foi o
caso de mudança de propriedade (hoje só sino) e de anomalia de crescimento (hoje um resumo único;
eram ~157/dia para um destinatário, e de forma recorrente, porque o dedup libera a chave a cada
24h e a janela de detecção são 35 dias). Para rotear ao responsável use `_destinatariosPara()`.

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

**Novo na v4.2** — nada manual, mas saiba o que esperar: o índice `idx_azure_costs_cat_date` é
criado em background no startup e leva ~10 min numa base de 9M linhas (telas de observabilidade
ficam lentas até terminar); a tabela `log_analytics_commitment_snapshot` nasce vazia e acumula uma
linha por workspace/dia; o agendador agora dispara **todas** as SPs due no mesmo tick (antes
`LIMIT 1`), então reveja o `max` do pool PostgreSQL se houver muitas SPs ativas.

**Depois da v4.2** — as tabelas do Mailing (`mailing_*`) e de economia (`azure_desperdicio_saving`)
nascem no startup, vazias, sem passo manual. Duas coisas a saber:

- **Onde ficam os segredos da aplicação**: no BANCO, cifrados com a `MASTER_KEY` — Service
  Principals em `azure_coleta_config`, senha do SMTP em `integracoes`. O `.env` guarda só o que o
  processo precisa antes de existir banco (conexão, `JWT_SECRET`, `MASTER_KEY`). Consequência: a
  `MASTER_KEY` faz parte do backup junto com o dump; perdê-la ou trocá-la torna todas as
  credenciais salvas ilegíveis, e elas precisam ser recadastradas uma a uma pelas telas. Quando
  isso acontece o sintoma é `[Cripto] FALHA ao decifrar um segredo` no log, e o envio falha com
  `535 Incorrect authentication data`.
- **O Mailing usa relay SMTP anônimo próprio** (`integracoes` tipo `mailing_relay`, sem senha,
  autorizado por IP), separado do SMTP de Alertas. O "Testar Conexão" pode falhar na estação e
  funcionar em produção — é liberação por IP de origem, não configuração errada.

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

Quando o pool flaka a ponto de a CONTAGEM variar entre execuções (já aconteceu: 54 arquivos numa
rodada, 39 com 15 erros na seguinte), não adianta reler a saída — peça relatório estruturado, que
não depende do stdout:

```bash
cd frontend && npx vitest run --reporter=json --outputFile=<caminho>.json --pool=threads --maxWorkers=2
```

Confirmar comportamento de função embutida em `server.js` sem subir o servidor: extrair o trecho
por linha e executá-lo com `new Function(...deps)`, injetando dependências stubadas. Foi assim que
se provou que 157 anomalias viram 1 e-mail e que o resumo de economia trata os dois portais com
bases diferentes. **Vale o esforço**: `node --check` passa em código sintaticamente válido e
semanticamente errado — um bloco de resumo acabou DENTRO do laço que deveria agregar, e só o teste
pegou.

Servidor de desenvolvimento: se uma mudança não refletir, confira se o processo na porta 3000 não
é um node órfão (nodemon morre e deixa o filho rodando, servindo código antigo indefinidamente).
`Get-NetTCPConnection -LocalPort 3000 -State Listen` mostra o PID e a hora de início.
