# CLAUDE.md

Developer reference for Claude Code. Deployment instructions are in `README.md`.

## Commands

```bash
npm install          # install backend dependencies
npm start            # production (node server.js)
npm run dev          # development (nodemon server.js)
node --check <file>  # syntax check before running
```

**Frontend (React, `frontend/`) — separate Node project, own `package.json`/`node_modules`:**
```bash
npm run frontend:install  # npm install --prefix frontend
npm run frontend:build    # vite build → frontend/dist/react-app.js + .css + portal-app.js
npm run frontend:test     # npm test --prefix frontend (Vitest)
npm run dev:all           # Express (3000) + Vite dev server together, via concurrently
```
**Production deploys must run `frontend:install` + `frontend:build` before starting the server** — without
`frontend/dist/*`, the app boots and login works, but every migrated screen (Dashboard, Calculadora, Reservas,
Ações, Coleta Azure, Estimativas, Projetos, Portal Público) renders blank (404 on the bundle, no obvious error
outside the browser console). See `README.md`/`docs-implementacao.html` for per-platform build steps.

**Encrypted env:**
```bash
node encrypt-env.js encrypt   # .env → .env.enc + .env.key (AES-256-GCM)
node encrypt-env.js run       # load .env.enc and start server
```

---

## File Map

```
server.js               (~6 500 lines)  All API routes, auth, DB init, middleware, Excel export
app.js                  (~5 030 lines)  Setup wizard, login, projects/actions CRUD, reservas, portal config, session mgmt
calculadora.js          (~5 600 lines)  Azure cost calculator — self-contained IIFE
index.html              (~3 650 lines)  SPA shell — all views toggled by showView()
portal.html             (~335 lines)    Portal público — 100% migrado pra React (chrome + calculadora, ver ## Frontend React)
styles.css              (~1 650 lines)  Dark/light-mode CSS, Vivo purple theme
encrypt-env.js          (139 lines)     AES-256-GCM .env encryption utility
favicon.svg                             App icon (SVG)
mascote.png                             Vivo mascot used in login screen (not tracked by git — keep locally)
.finops_setup                           AES-256-CBC encrypted setup config — do not delete
uploads_tmp/                            Multer temp dir — CSVs deleted automatically after import
frontend/                               React + Vite — migração incremental tela por tela (ver ## Frontend React abaixo)
```

**Documentação (v2.4):**
```
docs-implementacao.html   Guia técnico: On-Premises (Linux/Windows), Docker, IaaS VM, PaaS (Railway/Render/Azure App Service), variáveis de ambiente, checklist produção
docs-usuario.html         Manual do usuário: todos os módulos + regras de negócio (RN-006, RN-007, RN-DB-001, pico, Databricks, Reservas, Portal Público) — versão para impressão
docs-faq.html             FAQ interativo para usuários autenticados — busca + filtro por categoria (Calculadora, Importação, Administração, Reservas, Portal Público, Databricks)
docs-portal-faq.html      FAQ simplificado para usuários do portal público — linguagem simples, busca por texto
```

**Integração dos FAQs no sistema:**
- `index.html` top-bar: botão `?` abre `docs-faq.html` em nova aba; "← Voltar ao sistema" aponta para `/`
- `portal.html` header: botão `Ajuda` abre `docs-portal-faq.html` em nova aba; "← Voltar à calculadora" chama `window.close()` (preserva sessão do portal)

**SQL reference** (manual maintenance — schema managed by server.js at startup):
```
schema.sql                   Core tables reference
init.sql                     DB init reference
azure_costs_migration.sql    azure_costs full schema (80+ fields)
indices_performance.sql      Functional index reference
migration_fix_nulls.sql      NULL deduplication / data cleanup
normalizar_resource_group.sql  resource_group_name case normalisation
```

---

## Frontend React — migração incremental (strangler fig)

Exigência de produção: migrar a UI pra React, sem tirar o sistema do ar. Plano completo em
`C:\Users\jorge\.claude\plans\magical-gliding-gem.md`. Resumo do que já existe:

- **Stack**: Vite + React + TypeScript, sem SSR (SPA pura — o sistema é 100% autenticado). TanStack Query
  pra chamadas de API. Vitest + Testing Library pros testes (`npm run test --prefix frontend`).
- **`frontend/`** é um projeto Node separado (seu próprio `package.json`/`node_modules`) — nada aí interfere
  no `server.js`/`app.js`/`calculadora.js` legados.
- **Build**: `npm run frontend:build` (raiz) → `frontend/dist/react-app.js` + `.css` (nomes fixos, sem hash —
  `frontend/vite.config.ts`). `server.js` serve isso em `/react-app/*`; bloqueia `/frontend/*` (fonte) exceto
  `frontend/dist/*` — sem isso, `frontend/package.json` etc. ficariam publicamente acessíveis.
- **Ponte com o shell legado**: `index.html` tem `<div id="react-root" class="view">` como mais uma `.view`
  (mesmo CSS `display:none`/`.active` das demais). `showView()` (app.js) tem `MIGRATED_VIEWS` — pra view
  migrada, ativa `#react-root` e chama `window.__reactBridge.mount(view)` (exposto por `frontend/src/bridge.ts`)
  em vez de ativar a antiga `#view-<nome>` (que fica no HTML vazia até a migração terminar).
  **Bug real reportado pelo usuário e corrigido — Dashboard (ou qualquer view) em branco na primeira
  entrada**: `app.js` é `<script src="app.js">` clássico (bloqueia o parsing, executa na hora); `react-app.js`
  é `<script type="module">`, sempre adiado pro fim do parsing do documento (equivalente a `defer`) — executa
  bem depois. A IIFE de restauração de sessão no fim de `app.js` chama `enterApp()` → `showView('dashboard')`
  **assim que o script carrega**, sem esperar nenhum evento — se isso acontece antes de `react-app.js` rodar
  (típico: usuário já logado abrindo a aba de novo), `window.__reactBridge` ainda não existe e
  `window.__reactBridge?.mount(view)` era um no-op silencioso — a view escolhida se perdia pra sempre e
  `#react-root` ficava em branco (só a *primeira* navegação após o load era afetada; a partir daí o bridge já
  existe, por isso "só na primeira vez"). Corrigido com fila de um item: `showView()` guarda
  `window.__reactBridgeQueuedView = view` quando o bridge ainda não existe; `bridge.ts` drena essa fila
  (chama `mount()` com o valor guardado) assim que inicializa. Comportamento comprovado empiricamente com uma
  reprodução isolada (dois `<script>` — um clássico, um `type="module"` — replicando a mesma ordem real de
  carregamento): sem a fila, `mount()` nunca era chamado (array de chamadas vazio); com a fila, `mount()` era
  chamado corretamente assim que o módulo carregava.
- **Auth compartilhada, sem duplicar login**: login/logout continuam 100% no `app.js`. O cliente de API do
  React (`frontend/src/api/client.ts`) lê o mesmo `sessionStorage`/`localStorage` `'finops_token'` (mesma
  prioridade do `api()`/`_api()` legados) e chama `window.logout(false)` em 401 — reaproveita, não reimplementa.
- **CSS**: o bundle React **não** porta o design system — herda `styles.css` (já carregado globalmente pelo
  shell) e usa as classes existentes (`.btn-primary`, `.data-table`, `.modal`, `.form-group`...) direto.
  **Bug real reportado pelo usuário e corrigido — toda a toolbar da Calculadora (autenticada e Portal
  Público) renderizava sem nenhum estilo, bordas retas pretas padrão do browser, sem cor de destaque**:
  as classes `.ci`/`.cs`/`.cl`/`.cfg`/`.cbtn-sec`/`.cbtn-go`/`.cth`/`.cbadge`/`.cspinner` — usadas por
  `CalculadoraView.tsx`, `PublicCalculadoraView.tsx`, `ConfigurarEstimativaOverlay.tsx`, `InvoiceModal.tsx`,
  `InvoicePreviewModal.tsx`, `WizardColetaModal.tsx`, `AgendamentoModal.tsx`, `ExpurgoModal.tsx`,
  `DiagnosticoModal.tsx`, `CheckboxSearchList.tsx`, `RecursosTable.tsx`, `DetalheDiarioTable.tsx`,
  `PorServicoTable.tsx` (8+ arquivos, confirmado por grep) — nunca existiram em `styles.css`. Elas só
  existiam no `<style>` que o próprio `calculadora.js` injetava dentro de `_html()`, ativo só enquanto
  `Calculadora.init()` rodava; quando `<script src="calculadora.js">` foi removido de `index.html`/
  `portal.html` (ver "Calculadora Fase B" abaixo), essas regras pararam de existir em qualquer lugar, mas
  os componentes React (escritos ANTES dessa remoção, copiando os mesmos nomes de classe do HTML legado
  verbatim) continuaram referenciando os mesmos nomes de classe — nunca foi um bug de remoção acidental,
  foi um gap desde a Fase A da Calculadora: essas classes nunca estiveram em `styles.css`, só funcionavam
  visualmente enquanto o script antigo ainda carregava em paralelo. `.cms-*` (dropdown Assinatura/RG) foi a
  exceção — já tinha sido portado pra `styles.css` desde a migração de Reservas, por isso só os dropdowns
  continuavam com alguma aparência de estilo nos relatos do usuário, e o resto (inputs, botões, cabeçalhos de
  tabela) parecia completamente "cru". Corrigido portando essas classes verbatim pra `styles.css` (mesmo
  bloco `.cms-*`) — como todas usam `var(--bg)`/`var(--border-light)`/`var(--accent)` etc. (tokens já
  theme-aware), funcionam em claro/escuro sem overrides extras. Confirmado visualmente com uma reprodução
  HTML estática + Playwright (claro e escuro) antes de reportar — não só type-check/build, já que é uma
  mudança 100% visual sem teste automatizado que a cubra.
- **Dev**: `npm run dev:all` (raiz) sobe Express (porta 3000) + Vite dev server juntos via `concurrently`;
  proxy do Vite encaminha `/api/*` pro Express (`frontend/vite.config.ts`).
- **Migrado até agora**:
  - `projetos` (`frontend/src/views/ProjetosView.tsx`) — CRUD completo, endpoints `/api/projetos` inalterados.
    Corrigido de passagem: a tabela legada lia `p.created_at` (campo que não existe — a coluna real é
    `criado_em`), então a coluna "Criado em" nunca funcionou; a versão React usa o campo certo.
  - `reservas` (`frontend/src/views/ReservasView.tsx` + `ReservaModal.tsx`) — CRUD completo, endpoints
    `/api/reservas` inalterados. Porta fiel de `_RSV_SCOPE_CONFIG`/`_RSV_TIPOS`/`_RSV_DEFAULT_SCOPE`
    (`frontend/src/config/reservaScopes.ts`) e do dropdown de busca CMS pra Subscription/Resource Group Azure
    (`frontend/src/components/CmsSelect.tsx`, reaproveitado pelos dois campos) — mesmo padrão pending→commit
    do original (`rsvToggleDrop`/`rsvConfirmDrop`). RG agora recarrega via `useQuery` chaveada pela subscription
    committed (React Query cuida do refetch — não precisa mais do `_loadRsvRGs()` imperativo). Auto-cálculo
    Prazo→Vencimento portado de `onRsvPrazoChange()`.
  - `acoes` (`frontend/src/views/AcoesView.tsx` + `AcaoModal.tsx`) — CRUD completo, endpoints `/api/acoes`
    inalterados. As 24 colunas de retorno mensal (`atual_janeiro..dezembro`, `proximo_janeiro..dezembro`) viram
    um componente `MonthGrid` (`frontend/src/components/MonthGrid.tsx`) reaproveitado pros dois blocos —
    porta fiel do "replicar valor" (`replicarTodos`/`toggleChipAuto`/`selecionarTodosChips`/`replicarSelecionados`
    em app.js). Igual ao original, `retorno_ano_atual`/`retorno_proximo_ano` **não são recalculados pelo
    servidor** — o cliente soma os 12 meses antes de cada save (`AcaoModal.handleSubmit`); se um campo novo
    de retorno for adicionado, essa soma precisa ser atualizada nos dois lugares (server.js não valida).
    Simplificação: a tela de detalhe somente-leitura (`viewAcao()`) não foi portada — "ver" e "editar" abrem
    o mesmo modal (o de edição já mostra tudo); avaliar se vale portar o read-only quando fizer sentido.
  - `coleta` (`frontend/src/views/ColetaView.tsx`) — **Fase A apenas** (CRUD + relatórios), escopo reduzido
    escolhido explicitamente pelo usuário dado o tamanho real da tela legada (~90-110 campos, 7 modais,
    wizard de 4 passos, chamadas ao vivo à Azure). Cobre: Service Principals (`SPModal.tsx` — CRUD básico:
    nome/tenant/client/secret/expiração/modo de coleta/billing account+profile/ativo; preserva
    `subscription_ids` existente sem editar), Storage Accounts (`StorageModal.tsx` — CRUD básico: nome/storage
    account/container/prefixo/prefixo do price list/SP vinculado/ativo), Cobertura por Mês
    (`frontend/src/components/CoberturaGrid.tsx` — porta fiel de `loadCoberturaMeses()`: agrega por
    YYYY-MM → 12 células/ano, cor por `maxDiasSub/diasNoMes` com mês atual sempre azul, clique expande
    detalhe por subscription), Histórico de Execuções (abas API/Storage/Manual — a aba Manual usa
    `GET /api/azure-costs/imports`, endpoint diferente do `GET /api/azure-coleta/historico` das outras duas)
    e Pendentes (lista + exclusão apenas — não existe criação fora do wizard, que é Fase B).
    **Fase B** — wizard de 4 passos, monitor de coleta ao vivo, botões "Testar SP"/"Testar Storage"/"Coletar
    agora" e o seletor de subscriptions ao vivo do modal de SP. Tudo isso depende de chamadas reais à API da
    Azure (`_managementGetToken`/`_storageGetToken`/ARM), que não há credencial disponível pra exercitar neste
    ambiente — verificado até onde dá sem Azure real: `tsc -b`, `vite build`, e 22 testes novos (Vitest,
    mockando `api/coleta.ts`) cobrindo navegação de passos, construção de payload, bloqueio quando já há coleta
    em execução, e o ciclo de vida do monitor. Os botões que chamam a Azure de verdade (Testar SP/Storage,
    Iniciar Coleta, Coletar agora) precisam de verificação manual do usuário com credenciais reais — não
    reivindicado como testado E2E aqui, diferente das fases anteriores desta sessão.
    - `frontend/src/components/CheckboxSearchList.tsx` — lista com busca + "Selecionar todos", usada pelo
      wizard (assinaturas/RGs) e pelo seletor de subscriptions do `SPModal.tsx`. Diferente de
      `CmsMultiSelect.tsx` (dropdown pending→commit): aqui a seleção é sempre visível, sem "OK" pra confirmar —
      mais adequado a uma etapa de wizard de tela cheia do que a um filtro compacto de toolbar.
      **Bug real reportado pelo usuário e reproduzido/corrigido numa validação seguinte**: os checkboxes
      apareciam "andando" pra direita conforme o texto da linha ficava mais curto (`[FINOPS] - RESERVA01` com
      checkbox colado à esquerda, `CONNECTIVITY` com checkbox quase no fim da linha). Causa: `.form-group
      input { width:100% }` (styles.css) cascateia pra QUALQUER `<input>` dentro de um `.form-group` ancestral
      (`SPModal.tsx` envolve este componente com `<div className="form-group">`) — o checkbox (sem classe
      própria) herdava `width:100%`, virando um box invisível gigante que absorve todo o espaço sobrando na
      linha flex (confirmado via `getBoundingClientRect()`: a largura do checkbox variava de ~270 a ~360px
      dependendo do texto ao lado); o quadradinho visível renderiza em algum ponto dentro desse box invisível,
      daí a aparência de "deriva" horizontal. Reproduzido isoladamente (HTML estático + Playwright, comparando
      antes/depois) antes de aplicar a correção, pra confirmar a causa raiz sem depender de login. Corrigido
      com `style={{width:'auto', flexShrink:0}}` no `<input>` — mesmo padrão já usado (e agora confirmado
      como necessário) nos checkboxes "Ativo" de `SPModal.tsx`/`StorageModal.tsx`. Aplicado defensivamente
      também nos radios/checkboxes "soltos" (sem classe própria) de `WizardColetaModal.tsx`, `AgendamentoModal.tsx`,
      `ExpurgoModal.tsx` e `ConfigurarEstimativaOverlay.tsx` — mesmo risco latente se algum dia ficarem dentro
      de um `.form-group`. `CmsMultiSelect.tsx`/`CmsSelect.tsx` **não precisaram do fix**: seus checkboxes já
      usam a classe `.cms-option`, que tem uma regra própria em styles.css (`.cms-option input[type=checkbox]
      { width:14px; ... }`) com especificidade maior que `.form-group input` — proteção já existente, só
      confirmada aqui.
    - `frontend/src/views/WizardColetaModal.tsx` — porta de `#modal-wizard-coleta`/`_wizard*` (app.js:5206-5764):
      Assinaturas → Resource Groups → Período → Confirmar+Agendamento. Modo `billing_profile` pode escolher
      entre esse escopo (pula direto pro período) ou "Assinaturas específicas" (mesmo fluxo do modo
      `subscription`). RGs de múltiplas assinaturas com o mesmo nome são deduplicados por nome (o corpo de
      `coletar-api` aceita só uma lista plana de nomes, não pares assinatura+RG). Antes de iniciar, revalida
      `GET /azure-coleta/status` (`em_execucao`) pra evitar corrida com outra coleta já rodando — o servidor
      também rejeita com 409, mas a checagem client-side dá um erro mais claro antes de gastar a chamada.
    - `frontend/src/views/AgendamentoModal.tsx` — porta simplificada de `#modal-editar-agend` (app.js:4126+):
      edita hora/dias da coleta recorrente e oferece "Coletar agora" (janela rolante de
      `hoje − granularidade_dias`). **Decisão deliberada**: não porta o seletor de assinaturas ao vivo próprio
      desse modal (`agendBuscarSubs`/`_agendRenderSubs` no legado) — mudar o ESCOPO de assinaturas/RGs é feito
      pelo wizard ("Iniciar Coleta"), que já cobre isso; duplicar o picker aqui fragmentaria onde o escopo é
      editado em vez de simplificar. Este modal foca só em agendamento + coleta pontual com o escopo já salvo.
    - `frontend/src/components/ColetaMonitor.tsx` — porta de `#coleta-monitor`/`loadColetaStatus()`/
      `_coletaPolling`: card de progresso ao vivo (fase, sub atual, chunk, inseridos/atualizados/erros, log,
      circuit breaker) via `useQuery` com `refetchInterval` dinâmico (3s enquanto `em_execucao`, 20s ocioso —
      detecta coletas disparadas pelo agendador sem precisar de ação do usuário nesta aba, sem manter polling
      rápido o tempo todo). Fica em "estado final" colorido após terminar até o usuário clicar "Fechar" — mesmo
      padrão do legado. Renderiza `null` quando não há `progresso` (nunca rodou nada nesta instância do
      servidor) — não polui a tela pra quem nunca mexeu em coleta.
      **Bug real reportado pelo usuário e corrigido — "Fechar" não durava, o card reaparecia a cada F5/nova
      entrada no sistema**: o "fechado" vivia só num `useState(false)` — perdido a cada remount do componente
      (trocar de view e voltar, reload, login/sessão restaurada), enquanto `GET /azure-coleta/status` continua
      devolvendo o mesmo job já concluído (`ultimo_api`/`ultimo_storage`) até uma coleta nova rodar de verdade.
      Corrigido persistindo em `localStorage` (`coleta_monitor_dismissed`) a chave `${tipo}:${id}` do job
      fechado (tipo+id do `HistoricoItem`, nunca só um boolean) — ao montar, o componente compara essa chave
      contra o job atual; um job novo (id diferente) sempre reabre o card mesmo com um fechamento antigo
      persistido, sem precisar limpar a chave manualmente. O efeito existente "nova coleta começou → reabre o
      monitor mesmo se a anterior tinha sido fechada" (`wasRunning` ref) também limpa a chave persistida,
      redundante com a comparação por id mas mantido por clareza.
      **Segundo bug real, achado ao ler o mesmo screenshot do usuário — todo log da coleta aparecia com
      `[Invalid Date]` no lugar do horário**: `_coletaProgresso.log.push({ ts: new Date().toISOString().slice(11,19), ... })`
      (server.js) grava `ts` já como string `"HH:MM:SS"`, não uma data completa — o legado (`app.js`) sempre
      renderizou `${l.ts}` direto. O componente React envolvia isso em `new Date(l.ts).toLocaleTimeString('pt-BR')`,
      e `new Date("14:32:07")` é `Invalid Date` (não é um formato de data reconhecido pelo construtor `Date`).
      Corrigido removendo o `new Date(...)` — renderiza `l.ts` como veio do servidor, igual ao legado.
    - `frontend/src/views/DiagAgendadorModal.tsx` — porta de `diagAgendador()` (app.js:4356): dump read-only de
      por que cada SP/Storage "deveria rodar" ou não segundo o agendador. Só consulta Postgres (sem Azure) —
      **verificado end-to-end viável sem credenciais Azure**, mas não exercitado nesta fase por falta de sessão
      autenticada no ambiente (endpoint exige `authMiddleware`).
    - `SPModal.tsx` ganhou o seletor de subscriptions ao vivo (`modo_coleta='subscription'`) que a Fase A
      deixou de fora deliberadamente: SP existente busca via `listarSubsSP`; SP nova precisa das credenciais já
      preenchidas no formulário pra usar `listarSubsPreview` (mesmo endpoint que o wizard usa, sem precisar
      salvar antes). Ao salvar, `subscription_ids` passa a refletir a seleção do picker em vez de preservar o
      valor antigo verbatim (Fase A só preservava, nunca editava).
    - **Purge/Diagnóstico portados nesta rodada (`ExpurgoModal.tsx`/`DiagnosticoModal.tsx`)** — descoberta real
      que motivou a mudança: `abrirPurgeAzure()`/`abrirDiagnosticoAzure()` (app.js) só eram acionados pelos
      botões "Diagnóstico"/"Limpar Dados" dentro de `#view-coleta` (index.html) — e `'coleta'` já estava em
      `MIGRATED_VIEWS` desde a Fase A daquela tela. Ou seja, essas duas features ficaram **completamente
      inacessíveis no app** desde que a Fase A da Coleta Azure foi ao ar (React passou a ser dono de
      `#view-coleta`, tornando-o `display:none` permanente) — não uma regressão desta sessão, mas um bug
      real pré-existente só agora corrigido. `ExpurgoModal.tsx` porta `abrirPurge()`/`verificarPurge()`/
      `executarPurge()`/`_purgeOnModo()` (fluxo período/arquivo/tudo, preview antes de habilitar "Confirmar",
      mais um `window.confirm()` novo antes de executar — o legado não tinha esse segundo gate, só o preview;
      adicionado por ser uma operação destrutiva em `azure_costs`, mesmo padrão já usado pelos outros deletes
      de `ColetaView.tsx`). `DiagnosticoModal.tsx` porta `abrirDiagnostico()`/`_diagFiltrar()` (busca livre +
      filtro por charge_type/unit_of_measure sobre `GET /calculadora/diagnostico`). As funções e o HTML dos
      dois modais foram removidos de `calculadora.js` (dead code confirmado — grep não encontra mais nenhuma
      referência); o export da API pública do IIFE foi atualizado. `abrirDiagnosticoAzure()`/`abrirPurgeAzure()`
      em `app.js` e os botões correspondentes em `index.html` **não foram removidos** (ficam dentro do bloco
      gigante de `#view-coleta`, já morto por inteiro — não vale isolar essas poucas linhas sem limpar o resto).
    - **Ações por-célula da grade de Cobertura portadas** — `CoberturaGrid.tsx` ganhou props opcionais
      `onColetarAgora`/`onAgendarPendente`; `ColetaView.tsx` implementa a resolução de SP (`_coberturaGetSP`
      portado: SP ativa preferindo `is_padrao` pra "Coletar Agora", exigindo também `auto_coleta=true` pra
      "Agendar Pendente"), o `confirm()` com o mesmo texto do legado, e as chamadas a `coletarAPI`/`criarPendente`.
    - **Design da grade de Cobertura corrigido — bug real reportado pelo usuário (as células ficaram sem cor
      de fundo/borda desde a migração, só o texto do %/mês continuava colorido)**: `cellColor()` retornava uma
      string `var(--green, #22c55e)` e o componente concatenava um sufixo de alfa hex direto nela
      (`cellColor(...) + '22'` pro background, `+ '55'` pra borda) — prática que funciona quando a cor de base
      é um literal `#RRGGBB` (vira um `#RRGGBBAA` válido de 8 dígitos, padrão já usado em `ReservasView.tsx`/
      `AcoesView.tsx`/`EstimativasView.tsx`/`ColetaView.tsx` sem problema, confirmado por grep), mas quebra
      quando a cor de base é um `var(...)`: `var(--green, #22c55e)22` não é um token de cor válido em CSS (o
      `var()` já é seu próprio token, "22" vira um token numérico solto colado nele) — o browser descarta a
      declaração inteira. Confirmado empiricamente com uma reprodução isolada (HTML estático + Playwright,
      `getComputedStyle` antes/depois): o background computava pra `rgba(0,0,0,0)` (totalmente transparente,
      exatamente o "washed-out" reportado) e a borda "herdava" a cor do texto por acidente (`border-color`
      cai pra `currentColor` quando a declaração de `border` é rejeitada por inteiro) — nenhuma das duas
      nunca teve alfa de verdade. Corrigido trocando `cellColor()` por `cellStatus()`, que retorna
      `{hex, rgb}` (mesmos tons de `--green/--orange/--danger/--blue`) — background e borda agora usam
      `rgba(r,g,b,alpha)` literal. Aproveitado pra também restaurar, como no legado
      (`loadCoberturaMeses()`, app.js), a 3ª linha por célula com o total de registros formatado (`fmtNum`:
      "3.6k"/"1.2M") e a legenda de cores abaixo da grade (`≥95%`/`70–94%`/`<70%`/`Mês atual` + texto
      explicativo) — nenhuma das duas existia na versão React antes desta correção. Tooltip/texto do %
      mantidos idênticos ao que já existia (testado por `ColetaView.test.tsx`) — não portado o rótulo "atual"
      do legado pro mês corrente (troca `pct%` por "atual" só nesse mês), pra não quebrar esse teste existente
      sem necessidade; é uma nuance comportamental à parte do bug de design relatado.
    - **Granularidade "Livre" portada em `SPModal.tsx`** — select 7/15/30/Livre; no modo Livre mostra um
      range de datas e calcula `granularidade_dias` a partir da diferença (`+1`, inclusivo) ao salvar, com
      validação de range inválido. **Bug real encontrado e corrigido pelo próprio teste**: o handler de troca
      de modo comparava `v === 'livre'`, mas o `<select>` emite o valor da `<option>` (`'0'`), nunca a string
      `'livre'` — a comparação nunca era verdadeira e o modo Livre não abria o picker de datas. Corrigido pra
      `v === '0'`.
    - `GET /api/azure-coleta/agendamentos` não tem chamador nem no legado nem aqui (aparenta ser código morto
      do lado do servidor) — não portado.
    - **Import Manual (upload CSV/Parquet/ZIP) portado — mesma causa raiz do bug do Purge/Diagnóstico, achado
      numa rodada seguinte enquanto investigava o fix do botão "Atualizar"**: a ÚNICA lógica funcional de
      upload (`_setupImport()`, listener de `change` em `#cfile`, o `fetch` real pra
      `POST /api/azure-costs/import`) vivia em `calculadora.js`, registrada por `Calculadora.init()` — chamada
      só por `_ensureCalcIniciado()`, só acionada pelo botão "Selecionar Arquivos" dentro de `#view-coleta`.
      O listener equivalente em `app.js` (`loadColeta()`, dentro do também-nunca-executado — `loadColeta()` só
      roda via `switchSettingsTab('coleta')`, e nenhuma aba de Configurações chama isso mais) era só uma barra
      de progresso decorativa (setInterval falso, nunca chega a 100%), não fazia upload de verdade. Ou seja,
      **a importação manual de custos Azure estava 100% inacessível** — pior que Purge/Diagnóstico, já que é
      o único caminho de ingestão pra quem não tem credenciais de API Azure configuradas (a coleta automática
      via wizard não serve de substituto nesse caso). `frontend/src/components/ImportManualPanel.tsx` porta
      `_setupImport()`/`_aguardarImport()` fielmente: validação de extensão (.csv/.parquet/.zip) client-side,
      loop sequencial por arquivo com `POST /azure-costs/import` (multipart) → polling de
      `GET /azure-costs/import-status` a cada 900ms até `status !== 'running'`, tratamento de 409 (import já
      em andamento — espera 4s e tenta de novo, mesmo arquivo) e 401 (chama `window.logout`), barra de
      progresso real (não decorativa) baseada em `linhas`/`inseridos+atualizados+erros` do job, resumo final e
      tabela de erros detalhados (`erros_det`, antes um modal separado `_abrirImportErros()` — aqui é só uma
      seção expansível "Ver N erro(s)" dentro do próprio card, sem duplicar UI de modal).
      `frontend/src/api/client.ts` exportou `getToken`/`API_BASE` (antes privados) — o upload precisa montar
      seu próprio `fetch` com `FormData` (multipart), incompatível com o `Content-Type: application/json` fixo
      e o timeout de 30s do `apiFetch()` normal (arquivos de até 2 GB; `server.js` desabilita timeout de
      propósito nessa rota). Renderizado como um novo card `📥 Importação Manual` em `ColetaView.tsx`, entre
      Storage Accounts e Histórico de Execuções — a estrutura de 3 abas do legado (`#ctab-panel-api/storage/
      manual`, alternadas por `switchColetaTab()`) não foi replicada; SPs/Storages já são listados como
      cards/tabelas com botões de ação, então a importação manual entra como mais um card no mesmo padrão.
    Pegadinha real evitada em `frontend/src/api/coleta.ts` (`setStorageAtivo`): a rota `PUT /api/azure-coleta/storages/:id`
    não tem PATCH parcial — o handler grava **todos** os campos do body, inclusive como `null` os que faltarem.
    Um toggle ingênuo (`PUT {ativo}`) zeraria `nome`/`storage_account`/etc. — `setStorageAtivo` reenvia a linha
    inteira já carregada no cliente com só o `ativo` trocado, sem precisar mudar `server.js`. Confirmado via
    Playwright que o campo `storage_account` sobrevive ao toggle.
    **Histórico de Execuções perdeu 5 colunas/recursos na Fase A, achado numa auditoria completa (não
    reportado pelo usuário — achado por um agente de pesquisa comparando `loadColetaHistorico()`/
    `verDetalhesColeta()`/`verValidacaoColeta()`/`revalidarColeta()` de `app.js:6159-6438` linha a linha
    contra `ColetaView.tsx`)**: faltavam **Origem** (badge ⏰ Agendada/👤 Manual), **Duração** (calculada de
    `iniciado_em`/`concluido_em`), **Validação** (badge ✅ OK/⚠ Aviso/❌ Falha/— S/dados + botão "Revalidar" —
    `POST /azure-coleta/historico/:id/validar` não tinha nenhum chamador vivo) e **Log** (histórico passo a
    passo de uma execução JÁ concluída — diferente do log ao vivo de `ColetaMonitor.tsx`, que só existe
    enquanto a coleta está rodando/acabou de rodar nesta sessão), além do badge **Tipo** (💲 Price List/
    🗄 Storage/⚡ API) na aba Storage. Sem essas colunas não havia como auditar por que uma coleta antiga
    trouxe menos/mais dados que o esperado. Todos os campos necessários já vinham do servidor
    (`h.origem`/`h.detalhes`/`h.validacao_status`/`h.validacao_json` em `GET /azure-coleta/historico`) — só
    não estavam no tipo `HistoricoItem` nem renderizados. Portado como dois modais novos
    (`ColetaLogModal.tsx`/`ColetaValidacaoModal.tsx`, mesmo padrão de outros modais de Coleta) mais as 4
    colunas na tabela principal — nenhum endpoint novo no servidor foi necessário.
  - `estimativas` (`frontend/src/views/EstimativasView.tsx`) — tela **read/manage-only**: listar, buscar/filtrar
    por projeto, aprovar/reprovar/resetar status, ver detalhe (metadados + até 150 linhas de `recursos`, igual
    ao limite do legado), excluir, gerar PDF. **Não existe criação nesta tela** — estimativas só nascem como
    efeito colateral do fluxo "Gerar Invoice" da Calculadora (`calculadora.js`, ainda não migrada), que faz
    `POST /api/estimativas` fire-and-forget. Endpoints `/api/estimativas` inalterados. `GET /api/estimativas`
    (lista) **não retorna `recursos`** (JSONB grande) — só `GET /api/estimativas/:id` (detalhe) traz o array
    completo; a view usa `useQuery` separada por id, buscada só quando o modal de detalhe abre.
    **"Gerar PDF" continua chamando o `calculadora.js` legado, deliberadamente não portado** — `_buildPDFHtml`
    é um gerador de HTML/print de ~350 linhas, sem dependência de framework, compartilhado por dois call sites
    (o "Gerar Invoice" ao vivo da Calculadora e este botão); portar agora, antes da Calculadora ser migrada,
    criaria duas implementações de PDF divergentes. Quando a Calculadora for migrada (próxima fase depois de
    Dashboard), esse é o momento certo de portar `_buildPDFHtml`/`_abrirPreviewModal` de vez para os dois
    call sites juntos.
    **Pegadinha real encontrada e corrigida — `window.Calculadora` é sempre `undefined`**: `calculadora.js`
    declara `const Calculadora = (() => {...})()` no escopo top-level de um `<script>` clássico. Bindings
    `const`/`let` de script top-level **nunca** viram propriedade de `window` (só `var`/`function` declarations
    viram) — mas continuam resolvíveis como identificador global "solto" via escopo léxico, inclusive de dentro
    de um `<script type="module">` (módulos compartilham o global lexical environment do realm). O acesso
    correto — mesmo padrão já usado em `app.js` (`typeof Calculadora !== 'undefined'`) — é referenciar
    `Calculadora` como identificador solto, nunca `window.Calculadora`/`globalThis.Calculadora` (ambos sempre
    `undefined`). Corrigido com uma declaração ambiente `declare global { var Calculadora: {...} | undefined }`
    em `frontend/src/bridge.ts`. Confirmado via Playwright: antes da correção `#cinv-preview-modal` chegava a
    ser criado (via `Calculadora.init()` funcionando por sorte, já que o `typeof` guard também usava a forma
    certa) mas a chamada de `gerarPDFSalvo` nunca era localizada; depois, o preview abre normalmente.
    Nota pro implementador da view: `#cinv-preview-modal` alterna visibilidade via `style.display='flex'/'none'`
    diretamente, **não** via classe `.open` — não assumir o padrão `.modal-overlay.open` de outros modais do
    sistema ao inspecionar/testar esse modal específico.
    **Tabela sem card wrapper, corrigido a pedido do usuário**: diferente de `AcoesView.tsx` (`.card` >
    `.card-header` com `.card-title`+`.badge` > `.table-wrapper`), a tabela de `EstimativasView.tsx` estava solta
    dentro de só um `.table-wrapper`, sem o cartão/título/contador ao redor — pedido explícito do usuário foi
    "deixar parecido com Ações FinOps". Corrigido envolvendo a mesma tabela (sem mudar nenhuma coluna/linha/
    lógica) num `.card`/`.card-header` com título "Estimativas" + `.badge` com `{all.length}` (contagem total,
    não filtrada — mesmo padrão do badge de `AcoesView.tsx`).
  - `dashboard` (`frontend/src/views/DashboardView.tsx`) — agregação 100% client-side sobre `listAcoes()` +
    `listEstimativas()` (já existentes, nenhum endpoint novo). O `GET /api/dashboard` que existe em `server.js`
    é **código morto** — nunca foi chamado por nenhum client, nem legado nem React; não usado aqui.
    `GET /api/projetos` também é buscado pelo `loadDashboard()` legado mas nunca usado — omitido no port.
    **Duas sub-abas (Ações/Estimativas) puxadas pelo sub-nav da sidebar sem re-passar por `showView()`** —
    diferente de toda outra tela migrada (que é sempre um único painel). O sub-nav legado (`#nav-sub-acoes`/
    `#nav-sub-estimativas`, dentro do grupo `#nav-group-dashboard`) chama `showDashTab(tab)` → `showView('dashboard')`
    (remonta a mesma view, ok) → `switchDashTab(tab)`, que antes manipulava `.dash-panel` diretamente — reescrito
    pra chamar `window.__reactBridge.setDashboardTab(tab)`, um canal **separado** de `mount`/`unmount` em
    `bridge.ts` (`setDashboardTabListener`/`currentDashboardTab`, default `'acoes'`) — necessário porque duas
    telas trocando de aba sem trocar de "view" não cabe no par mount(view)/unmount() genérico usado pelas
    outras 5 telas.
    **Pegadinha real corrigida — dashboard não montava a versão React no login**: diferente das outras views,
    `#view-dashboard` já nasce com `class="view active"` **estática no HTML**, e `enterApp()` chamava
    `loadDashboard()` **direto** (nunca passava por `showView()`) — então o bridge React nunca era montado no
    login/reload de sessão, e o usuário via a tela antiga (vazia, já que o legado não foi deletado do HTML)
    em vez do dashboard novo. Corrigido trocando essa chamada por `showView('dashboard')` em `enterApp()`
    (dois call sites: login fresco e restauração de sessão — ambos passam pela mesma função). Confirmado via
    Playwright: dashboard React monta automaticamente pós-login sem precisar clicar em nada.
    **Filtro de cloud reimplementado como estado local, corrigindo um bug real de estado global "preso"**:
    o legado usava `_activeCloud`, uma variável de módulo nunca resetada — uma vez clicado um card de cloud,
    o filtro ficava aplicado silenciosamente pra sempre (inclusive em reloads futuros do dashboard via
    auto-refresh), escondendo ações de outras clouds sem indicação visível clara. Provável causa raiz do
    relato antigo do usuário "ações de FinOps não aparece mais no Dashboard" (nunca confirmado, sem
    reprodução). Na versão React, `activeCloud` é `useState` do componente — reseta sozinho sempre que
    `DashboardView` desmonta (navegar pra outra tela e voltar já limpa o filtro).
    Ícones de cloud (AWS/Azure/GCP/Oracle/Multicloud, SVG inline) portados verbatim pra
    `frontend/src/config/cloudIcons.ts`, renderizados via `dangerouslySetInnerHTML` (conteúdo estático, não
    é input de usuário). "Ver detalhes" numa linha de ação reaproveita o `AcaoModal` já existente da migração
    de Ações FinOps (mesmo padrão "ver = editar" já adotado lá) — sem duplicar formulário.
    E2E via Playwright rodou **sem nenhuma ação cadastrada no banco local** (dataset real vazio) — fluxos de
    filtro de cloud e "Ver detalhes" não puderam ser exercitados contra dados reais (ambos ficaram "[skip]" no
    script, removido depois); cobertura desses dois fluxos específicos vem só dos testes Vitest com dados
    mockados. Login automático pro dashboard, troca de aba via sidebar, e navegação "Ver todas →" pra
    Estimativas foram confirmados via Playwright contra o servidor real.
    **Card "Estimativas Recentes" adicionado a pedido do usuário** — a aba Estimativas só tinha os 3 cards de
    totais agregados + "Detalhamento por Projeto" (somas por projeto, sem linha por estimativa); a aba Ações
    já tinha uma tabela item-a-item ("Ações Recentes") desde o início. Novo card segue o mesmo padrão visual
    (`.card`/`.card-header`/`.card-title`/`.badge`/`.data-table`, mesma paleta de `StatusBadge` já usada em
    `EstimativasView.tsx`) — colunas Número/Projeto/Título/Responsável/Total Final/Status/Data, ordenado por
    `data_estimativa` mais recente primeiro, sem paginação (mesmo padrão de "Ações Recentes", que também
    lista tudo sem cap). Clicar no número da estimativa ou em "Ver todas →" navega pra tela completa
    (`window.showView('estimativas')`) — nenhum modal de detalhe próprio aqui, ao contrário de "Ações
    Recentes" (que abre `AcaoModal` inline): `EstimativaDetalheModal` vive dentro de `EstimativasView.tsx`
    (não exportado) e tem lógica própria de geração de PDF/mutation de status que não fazia sentido duplicar
    numa tela pensada como resumo/prévia — decisão deliberada de manter a interação pesada só na tela cheia.
    **Outra pegadinha real encontrada e corrigida (não específica desta tela — grep pegou em 5 arquivos)**:
    `valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })` sem `maximumFractionDigits: 2` deixa o
    `Intl.NumberFormat` livre pra mostrar até 3 casas decimais quando o número de origem tem mais precisão
    (ex: `1941.361` vira `"1.941,361"` em vez de `"1.941,36"`) — só não aparecia nos dados de teste porque
    eram valores redondos. Encontrado testando com Playwright contra um registro real (`estimado_brl` calculado
    pela Calculadora tem várias casas decimais). Corrigido adicionando `maximumFractionDigits: 2` em todo
    lugar que formata moeda: `EstimativasView.tsx`, `ReservasView.tsx`, `AcoesView.tsx`, `MonthGrid.tsx`,
    `ColetaView.tsx` (contadores inteiros como `registros`/`linhas` não precisavam do fix — só têm o problema
    valores com casas decimais).
- **Pegadinha real encontrada (corrigida em `frontend/src/api/normalize.ts`)**: colunas `NUMERIC` do Postgres
  voltam como **string** via `pg` (ex: `"416.67"`, não `416.67`), nunca como `number`. `valor.toLocaleString('pt-BR',...)`
  numa string ignora o locale (usa `String.prototype.toLocaleString`, que só devolve o texto cru) e
  `soma += valor` vira concatenação em vez de soma. `numFields()` normaliza pra `number` na borda da API
  (`api/reservas.ts`, `api/acoes.ts`) logo após o fetch — qualquer view nova com campo monetário/numérico
  precisa listar esses campos ali antes de fazer conta ou formatar como moeda. Achado testando de verdade
  com Playwright (a tabela mostrava "R$ 2400.00" em vez de "R$ 2.400,00") — os testes unitários (Vitest) não
  pegam isso porque mockam a API já com `number` de mentirinha.
  - `calculadora` (`frontend/src/views/CalculadoraView.tsx` + `ConfigurarEstimativaOverlay.tsx`) — **Fase A**:
    fluxo completo de consulta/estimativa (seleção sub/RG, busca, filtros, 3 visões, overlay "Configurar
    Estimativa" com Período/Horário Livre/Taxas/Totais). PDF, Purge, Diagnóstico, Reconciliação (modal) e
    Portal Público **ficaram no `calculadora.js` legado via bridge** nesta fase — PDF/Invoice e Reconciliação
    foram portados na Fase B (ver abaixo); Purge/Diagnóstico continuam bridgeados (não pertencem à tela
    Calculadora — ver Fase B); Portal Público continua 100% legado (fase própria, separada).
    **Motor de cálculo portado como módulo puro testável**, não reimplementado ad-hoc dentro dos componentes:
    `frontend/src/lib/calcEstimado.ts` (`_calcEstimado`/`_dbInfoParaRecurso`/`_dbComputeTaxas` — RN-DB-001, pico,
    RI/SP amortizado), `frontend/src/lib/tipoRecurso.ts` (`_tipoRecurso`, cascata de classificação),
    `frontend/src/lib/periodo.ts` (`_calcHorasPeriodo`/`_calcHorasLivres`), `frontend/src/lib/buildEstimativa.ts`
    (monta o objeto `_estimativa` — mesma fonte que os cards do overlay e o Subtotal/Total, igual ao legado).
    48 testes unitários golden-fixture cobrem esse motor (`calcEstimado.test.ts`, `periodo.test.ts`,
    `tipoRecurso.test.ts`, `buildEstimativa.test.ts`) — porta verbatim de cada fórmula, sem "melhorar" nada,
    incluindo bugs latentes preservados de propósito (ver abaixo).
    **Bug latente preservado (não corrigido)**: `_tipoRecurso` lê `r.meter_category` (singular) mas a API só
    retorna `categoria`/`meter_categories` — esse campo nunca existe na resposta, então a classificação de tipo
    depende só de `consumed_service`/`resource_group_name`/`nome_recurso`, nunca da categoria. Corrigir mudaria
    a classificação de recursos que hoje só caem nos fallbacks — porta verbatim (`cat` hardcoded como `''`
    em `tipoRecurso.ts`, com comentário explicando por quê) pra bater com o comportamento atual em produção.
    **Atualização — um bug DIFERENTE nessa mesma função foi corrigido a pedido do usuário** (não o do
    `meter_category` acima, que continua preservado): o padrão de RG Databricks em `tipoRecurso.ts` só
    reconhecia `databricks-rg-*`/`managed-rg-adbx-*`, igual ao legado, mas incompleto frente aos 3 padrões que
    `_detectManagedRg()` (server.js) já reconhece — ver detalhes na seção "RN-DB-001" mais abaixo, mesmo bug
    corrigido em paralelo no cálculo financeiro.
    **Bug latente preservado**: `_calcHorasLivres` conta dias parciais de início/fim do período como dias
    completos — pra períodos curtos pode subtrair mais horas do que o total (o `Math.max(1, ...)` no chamador
    é o único guard). Não corrigido — precisa bater com o legado.
    **Bug real encontrado numa auditoria completa (não reportado pelo usuário, achado por dois agentes de
    pesquisa comparando `calculadora.js` linha a linha contra o React) — visões "Por Data" e "Por Serviço"
    renderizavam com a maioria das colunas em branco/erradas**: `DetalheDiarioRow`/`PorServicoRow`
    (`types/calculadora.ts`) declaravam campos (`consumed_service`, `meter_name`) que **não existem** na
    resposta real de `GET /calculadora/detalhe-diario`/`GET /calculadora/por-servico` (que retornam
    `nome_recurso`/`resource_type`/`location`/`resource_group_name`/`subscription_name`/`service_name`/`meter`
    — confirmado lendo o SQL em `server.js` diretamente). Efeito: em "Por Data", Tipo ficava vazio,
    Localização/Resource Group mostravam `'—'` hardcoded, Assinatura mostrava um fragmento bruto do
    `resource_id` (`resourceId.split('/')[2]`) em vez do nome; em "Por Serviço", a própria coluna "Serviço"
    (razão da tabela existir) vinha em branco em toda linha. Nenhum teste cobria essas duas visões antes
    (`getDetalheDiario`/`getPorServico` eram mockados em `CalculadoraView.test.tsx` mas nunca tinham dados
    resolvidos nem eram exercitados), por isso passou despercebido. Corrigido os tipos + `DetalheDiarioTable.tsx`/
    `PorServicoTable.tsx` pros nomes de campo reais; adicionados `DetalheDiarioTable.test.tsx`/
    `PorServicoTable.test.tsx` (3 testes) cobrindo os dois pela primeira vez.
    **Horário Livre não persistia entre aberturas do overlay, achado na mesma auditoria**: diferente das Taxas
    (`pctImposto`/`pctCond`/`pctGordura`, que já liam/gravavam em `localStorage` desde a Fase A), o estado
    inicial de `horarioLivre` só usava `defaultHorarioLivre()` — cada vez que o overlay era reaberto (mesmo
    autenticado, fora do fluxo público travado por admin), a configuração voltava a `ativo:false`. O legado
    (`_hlSalvarPadrao`/`_hlCarregar`) tinha botões explícitos "★ Salvar como padrão"/"↺ Restaurar padrão"; a
    versão React não replicou esses botões — em vez disso, aplicado o mesmo padrão silencioso já usado pelas
    Taxas (auto-carrega no mount, auto-salva a cada mudança, sem UI extra), consistente com o resto do card,
    evitando introduzir um padrão de botão que não existe em nenhum outro lugar deste overlay. Chave
    `localStorage 'finops_horario_livre'` (mesmo nome do legado `_LS_HL`). Teste novo em
    `CalculadoraView.test.tsx` confirma que ativar Horário Livre, fechar e reabrir o overlay preserva a escolha.
    **Cards do overlay tinham perdido praticamente todo o detalhe por-recurso do legado, achado na mesma
    auditoria comparando `_ovRenderRecursos()` (calculadora.js:3230-3409) linha a linha contra
    `EstimativaCard`**: o card React só mostrava nome/RG, o RÓTULO da coluna 1 sem nenhum valor numérico (ex:
    "Custo/h" sem o "R$ 2,00" ao lado), horas e o Estimado final — faltavam os badges (categoria, charge_type
    colorido Usage/Purchase, RG com estilo/tooltip de RG gerenciado Databricks/AKS, consumed_service, "⚠ Uso
    parcial" quando o recurso ficou ligado &lt;400h no período, "⚡ Databricks"/"⚡ DBU"), a linha de metadados
    (UoM · Qtd · H.reais · Modelo de pricing) e a 4ª coluna do grid ("Cobrado" — o valor já faturado de
    verdade, pra auditar a estimativa contra o billing real). Também faltavam os tooltips ricos do rótulo da
    coluna 1 (data do pico, custo do dia do pico, taxa do workspace Databricks, etc.) — `RecursoBilling`
    não tinha `pico_data`/`pico_cluster_data`/`pico_cluster_custo_rg`/`pico_cluster_horas_dia` no tipo TS,
    apesar de o servidor já retornar esses 4 campos (`server.js:4690-4694`) — só faltavam no tipo e no
    `RECURSO_NUM_FIELDS` (os dois últimos são `NUMERIC`, precisam de normalização). Reescrito `EstimativaCard`
    com `col1Info()` (substitui `col1Label()` — porta fiel da cascata de prioridade reserva/mês/pico/pico
    cluster/Databricks/DBU/período/dia/amortizado, incluindo o VALOR e o tooltip de cada branch, não só o
    rótulo) e um `managedRgMap` novo (construído de `calc.rgOptions`, que já tem `managed_type`/`managed_label`
    — reaproveitado, não duplicado). **Não portado**: o agrupamento de cards por Resource Group com cabeçalho
    próprio (nome do RG + badge + total do RG no período + "% coberto") que existia no legado — é uma mudança
    estrutural maior (lista deixaria de ser plana), fora do escopo desta correção pontual de detalhe por-card;
    considerar como um item separado se fizer sentido no futuro. Teste novo em `CalculadoraView.test.tsx`
    confirma badges/metadados/coluna Cobrado com valores corretos pro card do recurso mockado.
    **Três diagnósticos menores da mesma auditoria, todos autenticado-only (nenhum faz sentido/funciona no
    Portal Público, que não tem JWT — `/azure-costs/diag` e `/azure-costs/refresh-cache` exigem
    `authMiddleware`)**:
    - `DiagOutrosModal.tsx` — porta de `_diagOutros()`: botão 🔍 ao lado do chip "Outros" na chip-bar de tipos,
      agrupa os recursos não classificados por `consumed_service`+`meter_categories` (campo real — `_tipoRecurso`
      lê `meter_category`, singular, que nunca existe na resposta; usar o campo real aqui só melhora um
      diagnóstico read-only, não muda a classificação em si, que continua bug-preservada em `tipoRecurso.ts`).
    - `SubDiagPanel.tsx` — porta de `_diagCache()`/`_forcarRefreshCache()`: `CmsMultiSelect.tsx` ganhou uma
      prop opcional `emptyState` (renderizada no lugar de "Nenhum resultado" quando `options.length===0`, não
      quando é só o filtro de busca que não bateu) — usada pelo dropdown de Assinatura da Calculadora pra
      mostrar se `azure_costs` está vazia, sem `subscription_id`, ou se é só o cache (`azure_subs_cache`) que
      precisa de rebuild, com um botão pra forçar isso.
    - `LegendaPanel` (dentro de `ConfigurarEstimativaOverlay.tsx`) — porta estática do painel 📖 que explica os
      selos/cores dos cards (Fonte do Preço, H.reais, Uso parcial, /mês*, Databricks, cores do Estimado).
    **Deliberadamente não portado**: a nota de rodapé automática de Reconciliação (`_atualizarNotaRodape()` —
    um aviso passivo tipo "⚠ R$X oculto" calculado em background após toda busca) — o botão "Reconciliar" já
    tinha sido removido a pedido explícito do usuário nesta mesma sessão; adicionar essa nota de volta iria
    contra esse pedido de simplificar a toolbar. `ReconciliacaoModal.tsx` continua no código (ver nota mais
    acima), só sem gatilho nenhum na UI.
    **Virtualização real em vez do truque de RAF-chunking**: a tabela de Recursos (`RecursosTable.tsx`) usa
    `@tanstack/react-virtual` (grid CSS, não `<table>` nativa — cada linha virtualizada é um `<div role="row">`
    fora da árvore de uma única `<table>`, então alinhamento de coluna só funciona porque cabeçalho e linhas
    compartilham o mesmo `gridTemplateColumns`; a primeira versão usava `<table>` aninhada por linha e
    quebrava o alinhamento entre grupos — corrigido antes de testar). `/api/calculadora/recursos` não pagina
    e ambientes com centenas/milhares de recursos são o caso esperado (o guard-rail do overlay já assume
    seleções de 500+ recursos como cenário real), então virtualização é necessária, não otimização prematura.
    **Pico (peak) é lazy** — `carregarPico()` só dispara ao abrir o overlay (`_abrirConfigStep` equivalente),
    mesclando por `resource_id+unidade` sem re-executar `computeDbTaxas()` (mesmo comportamento do legado:
    os campos que RN-DB-001 usa não mudam com o pico).
    **Pegadinha real encontrada e corrigida (Fase A) — 4 modais do `calculadora.js` ficariam inacessíveis fora
    da tela Calculadora**: `Calculadora.init()` injeta TODO o HTML da Calculadora (`_html()`) como filho de
    `#view-calculadora`. Antes desta fase, `#view-calculadora` podia ficar visível (usuário navegando pra lá),
    então modais como `#cinv-modal` (removido na Fase B), `#cpurge-modal`, `#cdiag-modal`, `#crecon-modal`
    (removido na Fase B) apareciam normalmente. Com `'calculadora'` migrada pro React, `#view-calculadora` fica
    `display:none` **permanentemente** — um filho `position:fixed` não escapa de um ancestral `display:none`.
    Isso quebraria silenciosamente os botões "Diagnóstico"/"Limpar Dados" que a tela de Coleta Azure legada
    chama via `_ensureCalcIniciado()` → `Calculadora.abrirDiagnostico()`/`abrirPurge()` — corrigido reparentando
    esses dois pro `document.body`, mesmo fix já usado por `_abrirPreviewModal`.
    **Multiselect novo, não reaproveita `CmsSelect.tsx`**: `CmsSelect.tsx` (usado em Reservas) é single-select
    (radio, pending→commit). Assinatura/RG da Calculadora são multi-select (checkbox, `Todos`/`Limpar`/`OK ✓`) —
    `frontend/src/components/CmsMultiSelect.tsx` reaproveita as mesmas classes CSS `.cms-*` mas com semântica de
    checkbox e cascata pai→filho pra RGs gerenciados (marcar `RG-WORKSPACE` auto-marca `DATABRICKS-RG-*`/`MC_*`
    filhos, dentro do estado *pending* — só confirma ao clicar OK).
  - **Calculadora Fase B** (`frontend/src/lib/buildPdfHtml.ts` + `views/InvoiceModal.tsx` +
    `components/InvoicePreviewModal.tsx` + `components/ReconciliacaoModal.tsx`) — porta PDF/Invoice e
    Reconciliação; Purge/Diagnóstico **deliberadamente ficaram de fora** (ver decisão de escopo abaixo).
    **Descoberta que mudou o escopo**: um levantamento detalhado revelou que os botões "Diagnóstico"/"Limpar
    Dados" (que abrem `abrirDiagnostico()`/`abrirPurge()`) nunca viveram dentro da tela Calculadora — sempre
    foram triggados pela tela **Coleta Azure** legada (`index.html`/`app.js`, ainda 100% vanilla). Portar essas
    duas features "como parte da Calculadora" teria exigido inventar botões novos numa tela que nunca os teve.
    Escolha: `buildPdfHtml.ts`/`InvoiceModal.tsx`/`ReconciliacaoModal.tsx` agora (pertencem de fato à
    Calculadora — o botão "Visualizar Estimativa" e o antigo "Reconciliar" sempre viveram lá), Purge/Diagnóstico
    ficam pra quando a Coleta Azure Fase B acontecer (seu lar de verdade).
    **`_buildPDFHtml` compartilhado entre DOIS call sites, não só um**: além do fluxo "Visualizar Estimativa" da
    Calculadora, `EstimativasView.tsx`'s botão "Gerar PDF" (de uma estimativa já salva) também chamava
    `Calculadora.gerarPDFSalvo()`, que reusava a mesma função de ~350 linhas. Os dois agora chamam
    `buildPdfHtml()` diretamente (função pura em `frontend/src/lib/buildPdfHtml.ts`, port verbatim de
    `_buildPDFHtml`, incluindo o `<script>` de tingimento do mascote que roda dentro do `<iframe srcdoc>` gerado)
    — nunca duas implementações divergentes de um documento financeiro real. `InvoicePreviewModal.tsx`
    (iframe + toolbar Editar/Imprimir/Fechar) também é compartilhado pelos dois.
    **Limpeza real de código morto em `calculadora.js`** (não só "deixar bridge inerte"): confirmado via
    levantamento que `abrirInvoice`, `abrirInvoiceExterno`, `_atualizarInfoProjeto`, `_atualizarPreviewInvoice`,
    `fecharInvoice`, `_buildPDFHtml`, `gerarInvoicePDF`, `gerarPDFSalvo`, `_abrirPreviewModal`,
    `fecharPreviewModal`, `voltarParaConfirmacao`, `imprimirEstimativa` (~625 linhas) e o HTML de `#cinv-modal`/
    `#cinv-preview-modal` (~107 linhas) não tinham mais nenhum chamador vivo — removidos de vez, não deixados
    como bridge morto. `_ovGerarEstimativa()` (só acionável pelo próprio `#covmodal` legado, HTML nunca exibido
    já que React é dono da tela Calculadora) virou um toast de aviso em vez de chamar uma função que não existe
    mais, evitando um `ReferenceError` morto-vivo caso algo ainda alcance esse caminho. `Calculadora` (tipo
    ambiente em `bridge.ts`) encolheu pra só `init` — nenhum código React chama mais `gerarPDFSalvo`/
    `abrirInvoiceExterno`. Confirmado via Playwright que os dois pontos de bridge que sobrevivem
    (`abrirDiagnostico`/`abrirPurge`, chamados pela Coleta Azure) continuam funcionando após a remoção.
    **Bug de tipo pré-existente corrigido em `types/estimativa.ts`**: `RecursoEstimativa.tipo_custo` nunca
    incluía `'reserva'` no union (só `'hora'|'dia'|'periodo'|'mes'`), mesmo sendo um valor real e válido vindo
    de `_calcEstimado`/`calcEstimado`. Como o `POST /api/estimativas` legado era JS solto (sem TS), esse gap
    nunca dava erro — só apareceu agora que `InvoiceModal.tsx` tenta enviar `estimativa.resultados` (tipado)
    nesse formato. Corrigido adicionando `'reserva'` ao union, alinhando com a realidade do negócio.
    **Reconciliação virou um componente novo, não um bridge**: diferente de Purge/Diagnóstico,
    `abrirReconciliacao()` não podia ser simplesmente bridgeado — `_reconciliacao` (closure legada) só era
    populado como efeito colateral da busca legada de recursos (`_carregarRecursos()`), que a tela React nunca
    chama, então ficaria eternamente `null`. `ReconciliacaoModal.tsx` busca seus próprios dados via `useQuery`
    (`getReconciliacao()`, já existia desde a Fase A mas nunca tinha sido usado), alimentado pelo
    `subsSel`/`rgsSel`/`dataInicio`/`dataFim` do `useCalculadora()` — mesmo padrão já usado por `detalheQuery`/
    `servicoQuery`. Novo botão "🔍 Reconciliar" na toolbar principal da `CalculadoraView` (não existia link
    algum antes — o trigger original vivia só dentro do HTML nunca exibido do `#view-calculadora`).
    **Botão removido a pedido do usuário durante a limpeza visual da toolbar** (`CalculadoraView.tsx` — o
    `useState` `reconOpen` e a renderização condicional de `ReconciliacaoModal` também saíram junto, já que
    nada mais os aciona). `ReconciliacaoModal.tsx` **não foi apagado** — decisão deliberada de manter só o
    componente sem nenhum jeito de abri-lo pela UI, mais fácil de restaurar (só recolocar o botão) se a
    feature voltar a ser necessária. `PublicCalculadoraView.tsx` nunca teve esse botão (fora do escopo
    público desde a Fase B), então não precisou de nenhuma mudança.
    **Bug real reportado pelo usuário e corrigido numa validação seguinte — dropdowns e modais recortados por
    `overflow:hidden`**: `CalculadoraView.tsx` tem `overflow:hidden` no `<div>` raiz (necessário pro layout
    flex-column com corpo rolável internamente). `position:absolute`/`position:fixed` continuam sendo
    recortados por QUALQUER ancestral com `overflow != visible` — não só o ancestral posicionado mais próximo —
    a menos que o elemento seja movido pra outro ponto da árvore DOM (portal). Dois sintomas reais:
    (1) `CmsMultiSelect.tsx`/`CmsSelect.tsx` (dropdown `.cms-dropdown`, `position:absolute`) tinham o rodapé
    (botão "OK ✓") cortado/inacessível ao abrir o seletor de Assinatura ou Resource Group — usuário marcava os
    checkboxes mas não conseguia confirmar a seleção, travando o fluxo logo no primeiro passo; (2) os 4 modais
    renderizados de dentro de `CalculadoraView.tsx` (`ConfigurarEstimativaOverlay.tsx`, `InvoiceModal.tsx`,
    `InvoicePreviewModal.tsx`, `ReconciliacaoModal.tsx`, todos `.modal-overlay`/`position:fixed`) ficavam
    visíveis só dentro da área de conteúdo (não cobriam sidebar/topbar) por estarem aninhados dentro desse
    mesmo container. Corrigido com `createPortal(..., document.body)` nos 5 componentes — novo hook
    `frontend/src/hooks/useCmsDropdownPosition.ts` calcula a posição do trigger via `getBoundingClientRect()`
    (recalculada em scroll/resize enquanto aberto) pros dois dropdowns; os modais só precisaram do portal em
    si, já que `.modal-overlay` usa `inset:0` (não depende da posição de um trigger). Outside-click-to-close
    ajustado nos dois componentes de dropdown pra checar cliques dentro do dropdown PORTALADO também (senão
    fecharia imediatamente ao clicar em qualquer opção, já que o clique não estaria mais "contido" no
    `wrapRef` depois do portal). Verificado que nenhuma outra `view` migrada tem esse `overflow:hidden` no
    próprio container raiz (só `CalculadoraView.tsx`) — os modais das outras telas (Coleta Azure, Reservas,
    etc.) não têm esse problema específico, então não foram portados por precaução.
  - `portal` (`frontend/src/PortalApp.tsx` + `frontend/src/views/PublicCalculadoraView.tsx`) — **Fase A (chrome)**
    cobre: cabeçalho (marca/tema/ajuda/badge "Público"), modal de identificação (nome+e-mail, validação de
    domínio, efeito de tingimento roxo do mascote via canvas — portado verbatim), toggle de tema (mesma chave
    `localStorage 'finops-theme'` do app autenticado), hero, estados de carregando/inativo.
    **Fase B (calculadora pública em si)** — reaproveita o mesmo motor da Calculadora autenticada
    (`useCalculadora`, `ConfigurarEstimativaOverlay`, `InvoiceModal`, `RecursosTable`) em vez de reimplementar
    uma tela nova do zero:
    - `useCalculadora(api, apiKey)` (`frontend/src/hooks/useCalculadora.ts`) ganhou um parâmetro `api`
      injetável (`CalculadoraApi = {listSubscriptions, listResourceGroups, getRecursos}`, default = as funções
      privadas de `api/calculadora.ts`) e um `apiKey` string só pra diferenciar a chave de cache do React Query
      entre instância privada/pública (funções não são serializáveis numa `queryKey`). `InvoiceModal` ganhou o
      mesmo padrão (`InvoiceModalApi = {listProjetos, createEstimativa}`) mais `defaultResp`/`defaultEmail`
      opcionais (pré-preenchidos com a identificação do portal, ainda editáveis).
    - `frontend/src/api/calculadoraPublica.ts` — funções espelhando `api/calculadora.ts` mas contra
      `/api/public/calculadora/*` (que no servidor delegam pros MESMOS handlers privados de `/recursos` e
      `/estimar`, só validando subscription/RG contra `portalCfg` antes — mesmo shape de resposta, reaproveita
      `RECURSO_NUM_FIELDS` exportado de `api/calculadora.ts` pra normalização). `ProjetoPublico` (sem
      `diretoria`, campo que `GET /api/public/calculadora/projetos` não retorna) é aceito por `InvoiceModal`
      via um `ProjetoOption` mais permissivo (`diretoria?`), sem duplicar o componente.
    - `ConfigurarEstimativaOverlay` ganhou uma prop opcional `publicConfig: PublicTaxConfig`
      (`{imposto, cond, horarioLivre}`) — quando presente: Imposto/Condomínio vêm travados com o valor da
      config do admin (input `disabled`, ícone 🔒), Horário Livre trava do mesmo jeito (checkbox/dias/horários
      desabilitados, nota "⚙ Configurado pelo administrador"), coluna Gordura some inteira (nunca existiu no
      fluxo público) e as taxas **não** são persistidas em `localStorage` (sessão anônima — não faz sentido
      "lembrar" preferência entre visitantes diferentes de um terminal compartilhado; o fluxo autenticado
      continua persistindo normalmente).
    - `RecursosTable` ganhou uma prop `locked?: boolean` — quando `permitir_selecao_recursos=false` na config
      do portal, os checkboxes ficam desabilitados (não escondidos) e `PublicCalculadoraView` auto-marca todos
      os recursos assim que a busca retorna (mesmo padrão de `_aplicarRestricoesPortal()`/`buscarRecursos()` no
      legado). `permitir_selecao_periodo=false` funciona sem código extra no hook — `commitSubs()` já
      pré-preenche os últimos 30 dias com dados ao confirmar a assinatura; `PublicCalculadoraView` só desabilita
      visualmente os `<input type="date">`, sem alterar a lógica de preenchimento.
    - **Achado real — `taxa_imposto`/`taxa_cond`/`horario_livre` chegam SEMPRE travados na prática, nunca
      "livres"**: a documentação original do legado (`_carregarTaxas()`) descrevia um branch onde o público
      edita livremente se o admin "não configurou" o campo (valor `null`/`undefined`). Mas
      `GET /api/public/calculadora/config` (server.js) usa desestruturação com default (`taxa_imposto = 18.65`,
      etc.) sobre `req.portalCfg` — e `POST /api/admin/portal-config` sempre grava um número concreto ao
      salvar (nunca `null`). Na prática, o branch "livre" só seria alcançável antes da primeira vez que o admin
      salva a config do portal (portal nem estaria `ativo` ainda) — inatingível em uso real. `PublicTaxConfig`
      foi construído refletindo isso: sempre travado (`imposto: cfg.taxa_imposto`, sem tentar modelar um `null`
      que o servidor não emite hoje).
    - **Pegadinha real encontrada e corrigida — `PortalConfig.horario_livre` tinha tipo incompleto**: o tipo
      `HorarioLivreConfig` (pré-existente, Fase A) só declarava `{ativo, inicio, fim, dias}`, mas a config real
      do portal SEMPRE inclui `inicio_sab`/`fim_sab`/`inicio_dom`/`fim_dom` — o admin configura um horário de
      fim de semana separado do de dias úteis (`#portal-cfg-hl-ini-sab`/`fim-sab` em app.js, gravado por
      `POST /api/admin/portal-config`). Confirmado contra o servidor local rodando: `GET /api/public/calculadora/config`
      retorna os 4 campos. Um primeiro rascunho desta fase presumiu (incorretamente, sem checar o servidor real)
      que esses campos nunca existiam e sobrescrevia sáb/dom com os valores de dia útil ao montar
      `PublicTaxConfig` — descartando silenciosamente a configuração real do admin pros fins de semana.
      Corrigido substituindo `HorarioLivreConfig` por um reexport do `HorarioLivre` de `types/calculadora.ts`
      (mesmo shape, já usado por `calcHorasLivres`) e repassando `cfg.horario_livre` direto, sem reconstrução.
    - **Regressão real encontrada e corrigida nesta fase**: a Fase B da Calculadora autenticada (commit
      anterior) removeu `abrirInvoice()`/`_buildPDFHtml()` de `calculadora.js` e reescreveu `_ovGerarEstimativa()`
      (o handler do botão "Visualizar Estimativa" dentro do HTML injetado por `_html()`) pra só mostrar um toast
      de erro — sob a premissa de que esse botão só vivia dentro do `#view-calculadora` legado, permanentemente
      `display:none` no app autenticado (React é dono da tela agora). Essa premissa é FALSA para o Portal
      Público: `PortalApp.tsx` ainda chamava `Calculadora.init()` e tornava `#view-calculadora` **visível**
      (`.active`) dentro do portal — então esse mesmo botão, no fluxo público, era o único caminho real de
      gerar uma estimativa, e ficou quebrado (toast de erro) desde aquele commit até esta fase. A causa raiz:
      avaliar "código morto" a partir só da perspectiva do app autenticado, sem considerar que o Portal
      Público reusa o mesmo HTML/JS injetado por `_html()`. Corrigido substituindo o widget legado inteiro por
      `PublicCalculadoraView.tsx` — não por restaurar o código antigo.
    - `calculadora.js` **não é mais carregado em `portal.html`** — `<script src="/calculadora.js">` removido.
      **Atualização**: a frase original aqui dizia que `index.html` "ainda precisa dele" pra Purge/Diagnóstico —
      isso deixou de ser verdade quando essas duas features foram portadas pra React na Fase B da Coleta Azure
      (ver `## Frontend React` → `coleta`). **`<script src="calculadora.js">` removido de `index.html`** numa
      passada seguinte: com Purge/Diagnóstico portados e o branch `calculadora` de `manualRefresh()` também
      corrigido (ver "Auto-refresh" abaixo — não chama mais `Calculadora.buscarRecursos()`), sobrava só
      `abrirDiagnosticoAzure()`/`abrirPurgeAzure()`/`_ensureCalcIniciado()` (app.js) e o botão "Gerar PDF" de
      `gerarPDFEstimativaSalva()` (guardado por `typeof Calculadora !== 'undefined'`, já degradava pro toast de
      erro) — todos só alcançáveis a partir de HTML dentro de `#view-coleta`/`#view-estimativas`, ambos
      permanentemente `display:none` desde que migraram. `calculadora.js` (arquivo) não foi deletado — só
      parou de ser carregado; `app.js` não foi tocado (esses wrappers dead ficam junto do resto do bloco
      `#view-coleta`, mesmo raciocínio de não isolar limpeza parcial já usado antes). A declaração ambiente
      `var Calculadora` em `bridge.ts` foi removida — sem nenhum código React restante referenciando o
      identificador solto `Calculadora`.
    **Diferença arquitetural de todas as telas anteriores**: `portal.html` é uma página standalone servida sem
    autenticação — não é uma view dentro do shell `index.html`/`app.js`/`#react-root`/`MIGRATED_VIEWS`. Decisão
    explícita do usuário: **bundle Vite separado**, não reaproveita o bundle autenticado (`react-app.js`).
    `frontend/vite.config.ts` ganhou `rollupOptions.input` com dois entries nomeados (`main` → `index.html`,
    `portal` → `portal.html`, ambos dentro de `frontend/`, arquivos **dev-only** que espelham o padrão já
    existente do `frontend/index.html`) — `entryFileNames` vira uma função (`chunk.name==='portal' ?
    'portal-app.js' : 'react-app.js'`) em vez de string fixa. Rollup extrai automaticamente as dependências
    compartilhadas (React/ReactDOM/TanStack Query) num chunk comum (`chunks/client-*.js`, importado via ES
    module por ambos os entries) — `portal-app.js` sozinho tem ~10 KB, não ~190 KB; usuários anônimos não
    baixam o código das 7 telas internas (confirmado via Playwright: `window.__reactBridge`, que só
    `bridge.ts` cria, não existe no portal). CSS não é diferenciada por entry (os dois bundles só importam o
    mesmo reset global, hoje ~0 bytes) — os dois HTMLs referenciam o mesmo `react-app.css`; tentar nomear CSS
    por entry de origem esbarrou num tipo instável do `assetFileNames` nesta versão do Vite/Rollup, não vale a
    complexidade dado que não há CSS real pra diferenciar ainda.
    `portal.html` (produção, raiz do repo) manteve **inalterados** desde a Fase A: o `<style>` inline inteiro
    (cabeçalho, modal de identificação, hero — os overrides `body.portal-mode` que escondiam Por Data/Por
    Serviço/import no widget legado ficaram órfãos depois da Fase B, mas inofensivos: nada no HTML atual usa
    esses seletores), e a pré-pintura de tema. Só o `<body>` mudou: todo o HTML estático + o script de
    orquestração (~250 linhas: `initPortal`/identificação/badge/tema) viraram `<div id="portal-root">` +
    `<script type="module" src="/react-app/portal-app.js">` — `PortalApp.tsx` reaproveita as mesmas classes CSS
    já existentes (`.portal-header`, `.ident-card`, `.portal-hero` etc.), igual ao padrão já estabelecido pro
    app autenticado (herda `styles.css`, não reimplementa design system). `<script src="/calculadora.js">`
    existiu na Fase A (calculadora pública ainda legada) e foi removido na Fase B (ver acima) — não faz mais
    parte de `portal.html`.
    **Pegadinha real encontrada e corrigida — `portal-main.tsx` esquecia o `QueryClientProvider`**: os testes
    Vitest (mockando `QueryClientProvider` manualmente no arquivo de teste) passavam mesmo com esse bug real —
    só apareceu ao testar contra o servidor de verdade via Playwright (`"No QueryClient set, use
    QueryClientProvider to set one"`, portal inteiro em branco). Corrigido adicionando o mesmo
    `QueryClient`/`QueryClientProvider` que `App.tsx` já usa pro bundle principal. Lição: um componente que só
    é exercitado via testes que já fornecem o Provider nunca prova que o *entry point real* monta esse Provider
    — vale sempre confirmar isso especificamente no passo de verificação via browser real.
    **Toast do `calculadora.js` legado precisa de `window.showToast` existir antes de `Calculadora.init()`** —
    `_toast()` (calculadora.js) chama `showToast` como identificador global solto (`typeof showToast ===
    'function'`), então `PortalApp.tsx` atribui `window.showToast = ...` num `useEffect` que roda antes do
    `useEffect` que chama `Calculadora.init()` (React executa effects na ordem em que aparecem no componente).
- **Ainda não coberto**: o botão de importação em massa de projetos (`btn-import-projetos`, modal legado) continua
  funcionando, mas não dispara refresh automático da tabela React após importar — só atualiza navegando pra
  outra view e voltando (React Query refaz o fetch ao remontar). Vale resolver quando migrar o fluxo de import.

## Architecture

Single-process Node.js + Express backend serving a vanilla-JS SPA. No build step.
`index.html` loads `styles.css`, `app.js`, `calculadora.js` directly from the same directory.

### Startup sequence
1. Load env (`loadEnv()`) — reads `.env.enc`+`.env.key` → falls back to `.env` → system env
2. Console warnings if `JWT_SECRET` or `MASTER_KEY` are using insecure defaults
3. Apply security middleware (helmet, rate-limit on auth routes, CORS)
4. `isConfigured()` — checks for `.finops_setup`; if absent, serves only the setup wizard
5. `initDB()` — creates all core tables with `IF NOT EXISTS`
6. `ensureAzureCostsTable()` — CREATE TABLE only (synchronous, fast); all CREATE INDEX run in background `_bgIdx` after 5s delay; `_azureTableReady = true` set immediately after table check
7. `ensureAzureColetaTable()` — creates `azure_coleta_historico` + `azure_coleta_sps`
8. `ensurePriceListTable()` — creates `azure_price_list` + indexes + `azure_price_list_meta` + materialized views `pl_best_mv` / `pl_sku_mv` (awaited before agendador so meta table exists on first tick)
9. `_iniciarAgendador()` — starts automated Azure cost collection scheduler (first tick at 120s)
10. `_refreshAzureCache()` — rebuilds `azure_subs_cache` + `azure_rg_cache` in background (90s delay)
11. SIGTERM/SIGINT handlers registered — close pool + clear keep-alive timer before exit

**Startup performance notes:**
- `ensureAzureCostsTable()` never blocks on CREATE INDEX — all indexes created sequentially in background; server is fully usable in < 1s after DB connect
- `_iniciarAgendador()` uses 120s initial delay to let background DDL and MV creation finish before first tick
- `_tickAgendador` silently skips Price List schedule check if `azure_price_list_meta` doesn't exist yet (transient startup race — no log spam)

### Authentication
Three methods — all issue the same JWT payload `{id, nome, email, perfil}`:
- **Local** — bcrypt password hash stored in `usuarios` table
- **Active Directory** — LDAP bind via `ldapjs`; email sanitized before filter construction to prevent LDAP injection
- **Microsoft Entra ID** — OAuth 2.0 authorization-code flow, **implemented 2026-08-24** (previously
  non-functional — `GET /api/auth/entra/url` built the redirect URL but no callback route existed; a user
  redirected to Microsoft had no route to land on afterward. This was found and left unfixed earlier the same
  day as part of the security review, then implemented later that day at explicit user request).

  **Flow**: `GET /api/auth/entra/url` generates a random `state` (CSRF, stored in-memory `_entraStates` Map,
  10 min TTL, single-use) and appends it to the Microsoft `authorize` URL. `GET /auth/callback` (no `/api/`
  prefix — it's a full-page browser navigation target set as the app registration's `redirect_uri`, never a
  SPA fetch/XHR) receives `?code=&state=`, validates `state`, exchanges `code` for tokens via
  `POST https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token`, then **verifies the `id_token`'s
  RS256 signature** against the tenant's JWKS (`jwks-rsa`, new dependency) with `issuer`/`audience` checks —
  never trusts an unverified token. Maps the `groups` claim (Object IDs) to `perfil` via `grp_admin`/
  `grp_finops` from the `integracoes` config (same pattern as the AD flow's `memberOf` mapping; unmatched or
  missing `groups` claim → `reader`, the safe default). Upserts into `usuarios` (`tipo='entra'`), issues our
  own JWT, then **hands off to the SPA via a one-time code** (`_entraHandoffs` Map, 60s TTL) instead of putting
  the JWT directly in the redirect URL — `res.redirect('/?entra_handoff=<code>')`, and the SPA's init IIFE
  (`app.js`, `_consumirEntraHandoff()`) calls `GET /api/auth/entra/consume?code=` once to retrieve
  `{token, user}`, exactly like a normal login response, then strips the query string via
  `history.replaceState`. On any failure, redirects to `/?entra_error=<msg>` instead, surfaced via the same
  `showLoginError()` used by local/AD login failures.

  **Operational prerequisite the admin must configure in the Entra app registration** (not something this
  server can do for them): "Add groups claim" under Token configuration — without it, the `id_token` never
  carries a `groups` claim and every Entra login lands as `reader` regardless of group membership. Accounts
  belonging to a very large number of groups trigger Microsoft's "groups overage" (`groups` claim replaced by
  `_claim_names`/`hasgroups`, requiring an extra Microsoft Graph call with additional scope) — **not
  implemented**; those accounts also fall back to `reader` rather than silently granting elevated access on
  an unreadable claim.

  **Not rate-limited** — `/auth/callback`/`/api/auth/entra/*` weren't added to the login rate limiter (below);
  lower priority since a valid `state` (generated server-side, unguessable) is required to reach the token
  exchange at all, unlike `/api/auth/login`'s open password-guessing surface.

Token stored in `sessionStorage` + `localStorage` (fallback).
`authMiddleware` — verifies `Authorization: Bearer <token>`. Returns 401 on failure.
`adminMiddleware` — verifies `req.user.perfil === 'admin'`, used after `authMiddleware`. **Added 2026-08-24**:
`POST/PUT/PATCH/DELETE /api/usuarios/*` and `POST /api/auth/ad/test` only had `authMiddleware` before this —
any authenticated user (any `perfil`, including the lowest) could self-promote to admin via `PUT` on their own
id, mint a brand-new admin account via `POST`, or delete/deactivate any user including admins. Same gap let any
authenticated user make the server LDAP-bind to an arbitrary host with arbitrary credentials via `/ad/test`. Real
privilege-escalation vulnerability, not theoretical — fixed by gating all 5 routes with `adminMiddleware` (same
pattern `GET /api/diag` already used). Confirmed only the legacy admin-only "Gerenciar Usuários" panel (`app.js`)
calls these routes — no self-service profile-edit flow depends on them, so no legitimate use case was broken.
Same `adminMiddleware` also applied to `GET/POST /api/integrations` (2026-08-24) — config includes the Entra
`client_secret` and AD bind credentials; before this, any authenticated user could read those in plaintext via
`GET` or overwrite the integration config via `POST`.
`dbMiddleware` — returns 503 if pool is null (pre-setup state).
Rate limiting: 20 req / 15 min on `/api/auth/login` and `/api/auth/ad`.

### Static file security
`express.static(__dirname)` com middleware de bloqueio antes:
```javascript
const _SENSITIVE = /^\/?(server\.js|encrypt-env\.js|package(-lock)?\.json|\.env(\.\w+)?|\.finops_setup|CLAUDE\.md|README\.md|.*\.sql$|.*\.key$|.*\.enc$)/i;
app.use((req, res, next) => {
  if (_SENSITIVE.test(req.path) || req.path.includes('node_modules')) return res.status(403).end();
  next();
});
// HTML: no-cache para evitar que o browser sirva versão desatualizada após deploy
app.use((req, res, next) => {
  if (/\.html?$/i.test(req.path) || req.path === '/' || req.path === '') {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname), { index: 'index.html', etag: true, lastModified: true }));
```
Blocks HTTP access to source code and secrets while serving `index.html`, `app.js`, `styles.css`, `calculadora.js`, `favicon.svg`, `mascote.png` normally.
JS/CSS served with ETag + Last-Modified for cache revalidation. HTML always bypasses cache (`no-store`) — garante que o browser nunca use versão antiga após deploy.

### Database — PostgreSQL only
Tables created by `initDB()` at startup with `IF NOT EXISTS`. No migration framework.
Schema changes go directly in `initDB()` — must be idempotent.

**Core tables:** `perfis`, `permissoes`, `usuarios`, `sessoes`, `projetos`, `acoes_finops`
- `projetos` has `status VARCHAR(20) DEFAULT 'Ativo'` — migration idempotent via `ADD COLUMN IF NOT EXISTS`

**Portal tables:**
- `portal_config` — chave/valor JSON: `key='config'`, `value=JSON`. Campos: `ativo`, `titulo`, `descricao`, `subscription_ids[]`, `resource_groups[]`, `dominios_aceitos[]`, `taxa_imposto`, `taxa_cond`, `horario_livre`, `solicitar_identificacao`
- `portal_acessos` — log de acessos do portal público: `id`, `nome`, `email`, `ip`, `user_agent`, `acessado_em`

**Reservas table:** `reservas_cloud`
- Columns: `id`, `cloud`, `nome_reserva`, `tipo_escopo`, `subscription_id`, `resource_group_name`, `tipo_recurso`, `instancia`, `quantidade`, `prazo`, `opcao_pagamento`, `custo_total`, `custo_mensal`, `data_inicio`, `data_vencimento`, `status`, `observacoes`, `criado_por`, `criado_em`, `atualizado_em`
- `GET /api/reservas?status=Ativa` — filtered by cloud and/or status, ordered by `data_vencimento ASC`

**Azure tables:**
- `azure_costs` — created lazily by `ensureAzureCostsTable()` on first import
  - UPSERT conflict key: `(subscription_id, resource_id, cost_date, meter_id, charge_type, quantity)`
  - NULL in any conflict column breaks deduplication (PostgreSQL NULL ≠ NULL)
- `azure_subs_cache` — pre-aggregated subscription list (subscription_id PK)
- `azure_rg_cache` — pre-aggregated RG list (subscription_id + resource_group_name_upper PK)

**Price List table:** `azure_price_list` — created by `ensurePriceListTable()`
- Source: Azure Retail Prices API (`prices.azure.com/api/retail/prices?currencyCode=USD`)
- Sync: USD somente; `arm_region_name` armazena a região real do item (ex: `brazilsouth`, `eastus`)
- Coluna `retail_price_brl NUMERIC(20,10)` — preço em BRL quando importado via CSV com essa coluna
- UPSERT conflict key: `(meter_id, type, reservation_term, currency_code, arm_region_name)`
- `reservation_term` is `NOT NULL DEFAULT ''` — JOIN must use `= ''` not `IS NULL`
- ON CONFLICT: `GREATEST(EXCLUDED.retail_price, current)` — nunca sobrescreve preço válido com 0; `retail_price_brl` usa `COALESCE(EXCLUDED, current)` para preservar valor existente
- `TRUNCATE TABLE azure_price_list` antes de cada sync (apaga **todas** as moedas — dados BRL importados via CSV são perdidos no próximo sync USD)
- Key indexes: `LOWER(meter_id)` functional + partial `idx_pricelist_join` + partial `idx_pricelist_sku_svc` (sku+service)

**Materialized views `pl_best_mv`/`pl_sku_mv` — removidas (eram infraestrutura morta):** existiam pra um JOIN
`azure_costs` × Price List que alimentava a UI de desconto/preço de tabela da Calculadora (`📋`, badge `▼%`,
col1 verde), removida da interface na v2.1 (ver nota abaixo — `fonte_estimado` já era sempre `'billing'`).
Confirmado por auditoria (grep completo em `server.js`) que **nenhuma query fazia esse JOIN havia tempo** — as
views continuavam sendo dropadas/recriadas a cada startup e recalculadas (`REFRESH MATERIALIZED VIEW
CONCURRENTLY`, pode ser caro em price lists grandes) a cada sync, sem nenhum consumidor. CLAUDE.md chegou a
documentar esse JOIN como se ainda existisse — estava desatualizado. Removida a criação/refresh de
`ensurePriceListTable()`/`_syncPriceList()`; a tabela `azure_price_list` em si (import/sync/diagnóstico) não
foi tocada. Bancos que já tinham essas views de execuções anteriores do servidor ficam com elas órfãs (não são
mais recriadas nem lidas — inofensivo, só ocupam espaço; `DROP MATERIALIZED VIEW IF EXISTS pl_best_mv/pl_sku_mv
CASCADE` remove manualmente se quiser limpar).

**Endpoints de diagnóstico e gestão:**
```
GET    /api/azure-costs/diag            — diagnóstico: contagens, colunas, amostra
POST   /api/azure-costs/refresh-cache   — força rebuild cache de dropdowns
GET    /api/azure-costs/resumo          — sumário geral: total registros, período, custo (cached 5 min)
GET    /api/azure-costs/imports         — lista de arquivos importados com linhas e período (cached 5 min)
GET    /api/azure-costs/purge/preview   — conta registros que seriam removidos (por período ou arquivo)
DELETE /api/azure-costs/purge           — expurgo: sem params = TRUNCATE TABLE (evita deadlock); com params = DELETE com retry 3x em deadlock (código 40P01)
GET    /api/price-list/diag             — cobertura meter_ids billing × PL
```

**Expurgo — notas importantes:**
- "Todos os dados" usa `TRUNCATE TABLE azure_costs` em vez de `DELETE FROM` — evita deadlock com imports concorrentes que fazem UPSERT por linha. TRUNCATE é DDL atômico (sem row-level locks).
- DELETE por período/arquivo tem retry automático (3x, backoff 200 ms/400 ms/600 ms) para o erro 40P01 (deadlock).
- Após qualquer expurgo: invalida `_coberturaCache`, `_resumoCache`, `_importsCache` e dispara `_refreshAzureCache()`.
- `abrirPurge()` em `calculadora.js`: modal abre imediatamente com spinner; `/resumo` e `/imports` carregados em `Promise.all` (paralelo).

**Azure Coleta tables:**
- `azure_coleta_historico` — log of each automated collection run
- `azure_coleta_sps` — Service Principals (tenantId, clientId, clientSecret encrypted)
- `azure_coleta_pendentes` — one-time reprocessing jobs (sp_id, subscription_id, data_inicio, data_fim); scheduler processes and DELETE's them after each run (guaranteed single execution)
- `azure_storage_config.price_list_prefix` — optional blob prefix for Price List CSV/ZIP auto-collection

**Performance indexes on azure_costs:**
```
idx_azure_costs_date              cost_date
idx_azure_costs_sub               subscription_id
idx_azure_costs_rg                resource_group_name
idx_azure_costs_resource_id       resource_id
idx_azure_costs_service           consumed_service
idx_azure_costs_meter_cat         meter_category
idx_azure_costs_importado         importado_em
idx_azure_costs_sub_rg            (subscription_id, resource_group_name)
idx_azure_costs_sub_date          (subscription_id, cost_date)
idx_azure_costs_rg_upper          UPPER(resource_group_name)             — functional
idx_azure_costs_sub_rg_upper      (subscription_id, UPPER(resource_group_name))  — functional
```

### Dropdown cache (`_refreshAzureCache`)
Rebuilds `azure_subs_cache` and `azure_rg_cache` from `azure_costs`.
Called at startup and after every successful import (fire-and-forget).
Subscription and resource-group endpoints fall back to a direct query if cache is empty.
Reduces dropdown load from ~12 s (full GROUP BY) to < 5 ms (tiny cache table scan).
On completion, resets `_coberturaCache`, `_resumoCache`, `_importsCache` to force re-query on next request.

**Bug real corrigido (2026-08-24)**: `GET /api/public/calculadora/resource-groups` (Portal Público) nunca
usava `azure_rg_cache` — ia direto pra um `GROUP BY` completo em `azure_costs` (1.2M+ linhas) em toda
requisição, diferente do endpoint privado equivalente, que já tentava o cache primeiro. Reportado pelo
usuário como demora perceptível ao selecionar a assinatura; medido em ~7-8.5s por requisição. Corrigido
replicando o padrão cache-first, mantendo os filtros próprios do portal (`subscription_ids`/`resource_groups`
de `portalCfg`). Resultado: ~18ms.

**Efeito colateral corrigido em seguida**: como `azure_rg_cache` só tinha `resource_group_name_upper`, tanto
o Portal Público quanto o endpoint privado (que já usava esse cache antes) passaram a mostrar RGs sempre em
maiúsculo quando o cache estava quente, perdendo a grafia original. Corrigido com uma coluna nova
`resource_group_name` em `azure_rg_cache` (populada por `MAX(resource_group_name)` na query que reconstrói o
cache em `_refreshAzureCache`) — os dois endpoints agora leem
`COALESCE(resource_group_name, resource_group_name_upper)`, nunca quebrando mesmo antes do próximo refresh
popular a coluna nova em bancos já em produção. Verificado após o refresh automático: 154 dos 228 RGs da
subscription Development voltaram a mostrar a grafia original, performance seguiu ~10-15ms.

### In-memory query caches (server.js)
Three caches prevent repeated heavy GROUP BY scans on `azure_costs` from concurrent requests:
```
_coberturaCache / _coberturaCacheTs   GET /api/azure-coleta/cobertura-meses   TTL 5 min
_resumoCache    / _resumoCacheTs      GET /api/azure-costs/resumo              TTL 5 min
_importsCache   / _importsCacheTs     GET /api/azure-costs/imports             TTL 5 min
```
- All three are invalidated by `_refreshAzureCache()` (runs after every import/collection) and by `DELETE /api/azure-costs/purge`
- `GET /api/azure-coleta/cobertura-meses?force=1` bypasses cache (used by the ↻ button in the coverage panel)
- `loadCoberturaMeses(force)` passes `force=true` from the ↻ button, 120 s client timeout (heavy query)

### Azure cost import
`POST /api/azure-costs/import` — multer upload, accepts `.csv` and `.parquet`.
- CSV: streamed line-by-line via `_mapRowCSV`
- Parquet: read via `@dsnp/parquetjs` via `_mapRow`
- Both normalize values with `_toDate()`, `_toNum()`, `_toStr()`
- Azure exports mix casing: `Date`, `SubscriptionId` (Pascal), `invoiceId` (camel) — mappers handle both
- Import runs in background job (`_processarImport`); progress via `GET /api/azure-costs/import-status`
- Temp file deleted after processing; `uploads_tmp/` directory is kept
- `req.setTimeout(0)` / `res.setTimeout(0)` intentionally disabled for large file uploads (up to 2 GB)

### Azure Coleta Automática
Automated cost collection via Azure Management + Storage APIs (no manual CSV needed).

**Service Principals (`azure_coleta_sps`):** each SP stores `tenant_id`, `client_id`, `client_secret` (encrypted with MASTER_KEY). Required Azure RBAC: `Reader` + `Storage Blob Data Reader`.

**Scheduler (`_iniciarAgendador`):** runs at configured time/days. Uses `_computeProximaColeta()` to calculate next run. Stores results in `azure_coleta_historico`.

**Circuit breaker (`_cbCanAttempt` / `_cbRecordSuccess` / `_cbRecordFailure`):** prevents hammering Azure API on repeated failures. Opens after 3 consecutive failures; resets after 5 minutes.

**Fetch helper (`_cbFetch`):** wraps `fetch` with timeout (30s), retry (3x) and circuit breaker integration.

**Endpoints:**
```
GET  /api/azure-coleta/status               — current scheduler state + next run time
GET  /api/azure-coleta/historico            — collection history log
DELETE /api/azure-coleta/historico          — clear history
POST /api/azure-coleta/cancelar             — cancel running collection
GET  /api/azure-coleta/cobertura-meses      — monthly data coverage per subscription (cached 5 min; ?force=1 bypasses)
GET  /api/azure-coleta/sps                  — list Service Principals
POST /api/azure-coleta/sps                  — add Service Principal
PUT  /api/azure-coleta/sps/:id              — update SP
DELETE /api/azure-coleta/sps/:id            — remove SP
POST /api/azure-coleta/sps/:id/testar       — test SP credentials
POST /api/azure-coleta/sps/:id/coletar-api  — trigger manual collection
POST /api/azure-coleta/listar-subs-preview  — list subs using credentials from body (no saved SP required — for new SP wizard)
POST /api/azure-coleta/sps/:id/listar-subs  — list subscriptions for saved SP
POST /api/azure-coleta/sps/:id/listar-rgs   — list resource groups for SP
PATCH /api/azure-coleta/sps/:id/ativo       — toggle SP active
PATCH /api/azure-coleta/sps/:id/padrao      — set SP as default
GET  /api/azure-coleta/pendentes            — list pending one-time reprocessing jobs
POST /api/azure-coleta/pendentes            — add pending job (sp_id optional, subscription_id, data_inicio, data_fim)
DELETE /api/azure-coleta/pendentes/:id      — remove pending job
```

**SP modal — subscription listing for new SPs:**
`spBuscarSubs()` checks `sp-edit-id`. If empty (new SP), reads `sp-tenant-id`, `sp-client-id`, `sp-client-secret` from the form and calls `POST /api/azure-coleta/listar-subs-preview` with those values directly — no prior save required. If credential fields are also empty, shows a note to fill them first.

**SP modal — `saveSP()` pitfall:**
`sp-dia` element does not exist in the modal HTML — always use `document.getElementById('sp-dia')?.value` (optional chaining). The entire `saveSP()` body is wrapped in try/catch so any future `null.value` errors surface as a toast instead of silent failure.

### Coleta Databricks (Fases 1 e 2 — 2026-08-25)
**Por quê**: custo por usuário e distinção free-tier vs. pago (ex: `GENIE_FREE_USAGE`) **não existem** e
**nunca vão existir** em `azure_costs` — confirmado por investigação: Azure Cost Management nunca carrega
identidade de usuário nem o catálogo de produto interno do Databricks, só *meter names* genéricos da Azure.
Essa granularidade só existe nas **System Tables do próprio Databricks** (`system.billing.usage` +
`system.billing.list_prices`, Unity Catalog) — uma fonte de dados totalmente separada, com autenticação
própria. Decisão do usuário: em vez de montar Grafana à parte, entra como uma nova aba dentro do módulo
Coleta já existente, espelhando 1:1 a arquitetura da Coleta Azure (Service Principal → coleta agendada →
tabela própria → dashboard).

**Fase 1 (implementada)**: configuração da conexão — credenciais + endpoint de execução.
**Fase 2 (implementada)**: coleta agendada real + gatilho manual + monitor ao vivo. Dashboard (Fase 3) ainda
não existe.

- **Tabela** `databricks_coleta_config` — mesmo formato de `azure_coleta_config`, incluindo os campos de
  agendamento (`dia_execucao`/`hora_execucao`/`dias_semana`/`granularidade_dias`/`auto_coleta`/
  `proxima_coleta`) já presentes no schema pra não precisar de migração nova na Fase 2, mesmo não expostos
  na UI ainda.
- **Autenticação**: Service Principal OAuth M2M (account-level, não Personal Access Token) — mesma razão da
  Coleta Azure já usar Service Principal: não amarra a automação a uma pessoa. Campos: `account_id` (Account
  ID da conta Databricks), `client_id`/`client_secret` (credenciais OAuth), `workspace_host` (URL de um
  workspace, usado pra executar as queries mesmo as System Tables sendo account-wide) e `warehouse_id` (SQL
  Warehouse usado via Statement Execution API).
- **Cifra**: reaproveita `_encryptSecret`/`_safeDecrypt` (AES-256-GCM, mesma `MASTER_KEY` já usada pra
  credenciais Azure) — zero cripto nova.
- **`_dbxFetch`** (server.js) — fetch próprio com timeout via `AbortController`, **não reusa `_cbFetch`**:
  aquele helper está acoplado ao circuit breaker global do Azure (`_cbAPI`/`_cbCanAttempt`) — reusar faria
  falhas do Databricks abrirem o circuito e bloquearem chamadas Azure não relacionadas (e vice-versa). Ainda
  sem circuit breaker próprio (só timeout) — considerar se o volume de execuções justificar no futuro.
- **`_databricksGetToken`/`_databricksRunQuery`** — OAuth 2.0 client_credentials (Basic Auth,
  `scope=all-apis`) contra `https://accounts.azuredatabricks.net/oidc/accounts/{account_id}/v1/token`, e
  Statement Execution API (`POST {workspace_host}/api/2.0/sql/statements`) pra rodar SQL. **Não validado
  contra uma conta Databricks real** — implementado com base no conhecimento atual da API pública do
  Databricks; ajustar endpoint/scope se necessário na primeira configuração real (mesma ressalva já dada
  pro SSO Entra ID).

**Endpoints** (todos `authMiddleware, dbMiddleware` — mesmo nível de acesso que `/api/azure-coleta/sps*`,
que também não exige `adminMiddleware` hoje):
```
GET    /api/databricks-coleta/config             — lista configurações (decripta account_id/client_id)
POST   /api/databricks-coleta/config             — cria (client_secret obrigatório)
PUT    /api/databricks-coleta/config/:id         — atualiza (client_secret opcional — mantém o atual se vazio)
PATCH  /api/databricks-coleta/config/:id/ativo    — ativa/desativa
PATCH  /api/databricks-coleta/config/:id/padrao   — define como padrão (único por vez)
DELETE /api/databricks-coleta/config/:id         — exclui
POST   /api/databricks-coleta/config/:id/testar   — pede token OAuth M2M + roda SELECT 1 no warehouse + testa cada System Table exigida individualmente (ver nota abaixo); erro cru é o propósito da rota (mesmo padrão de POST /api/azure-coleta/sps/:id/testar — não usa `_dbErr`)
POST   /api/databricks-coleta/config/:id/coletar  — gatilho manual (data_inicio/data_fim, formato YYYY-MM-DD)
GET    /api/databricks-coleta/status              — progresso ao vivo da coleta em execução (polling)
PUT    /api/databricks-coleta/config/:id/agendamento — hora_execucao/dias_semana/auto_coleta/granularidade_dias (espelha PUT /api/azure-coleta/sps/:id/agendamento)
```

**Fase 2 — coleta real**: `_executarColetaDatabricks(configId, startDate, endDate, origem)` autentica via
`_databricksGetToken`, roda uma query parametrizada (`:data_inicio`/`:data_fim` — nunca concatena data direto
na SQL) contra `system.billing.usage` JOIN `system.billing.list_prices` via `_databricksRunQuery` +
`_parseDatabricksResult` (converte a resposta colunas+linhas da Statement Execution API em objetos nomeados),
grava em `databricks_consumo` via UPSERT, loga em `databricks_coleta_historico` e `notificacoes_sistema`
(mesmo padrão de `_registrarNotificacaoColeta` já usado pela Coleta Azure). **Não validado contra uma conta
Databricks real** — mesma ressalva de `_databricksGetToken`/`_databricksRunQuery`; os nomes exatos de coluna
podem precisar de ajuste na primeira execução real.

**Granularidade por recurso, não mais por dia agregado (2026-08-26, pedido do usuário)** — o schema original
gravava uma linha por `(workspace_id, sku_name, usage_date, usuario)`, somando tudo daquele dia. Problema
real identificado numa conversa com o usuário (antes de qualquer conta real disponível, então achado por
raciocínio sobre o schema, não por bug reportado em produção): se dois recursos diferentes (ex: dois jobs
rodando com o mesmo Service Principal de automação) batem no mesmo workspace+SKU+dia+usuário mas têm
`custom_tags` diferentes (ex: tags de projeto/time diferentes, o caso de uso mais comum pra `custom_tags`
existir), a linha agregada só conseguia guardar UMA tag "de exemplo" — atribuindo 100% do custo combinado a
um projeto só, errado pra qualquer fração que na verdade pertencesse a outro recurso. Corrigido: cada
recurso individual agora vira sua própria linha, via `recurso_hash` (MD5 de `to_json(usage_metadata) +
to_json(custom_tags)`, computado em Node — nunca dois `to_json()` reparseados/re-serializados, pra não
arriscar reordenação de chaves mudar o hash do mesmo recurso). `usage_metadata`/`custom_tags` vêm via
`to_json()` no Spark SQL, não por um caminho de campo aninhado específico tipo `usage_metadata.machine.sku`
— esse caminho exato não é confirmado no schema real do Databricks (visto num script Python que o usuário
trouxe de outra fonte, com esse campo; não validável neste ambiente sem conta real) e um nome errado
quebraria a query inteira; `to_json()` captura o que existir de verdade, sem apostar num nome de campo, e
também serve de chave de agrupamento (MAP não pode ir em `GROUP BY` no Spark SQL — precisa virar STRING
primeiro). `produto_origem` (`billing_origin_product` — JOBS/INTERACTIVE/SQL/MODEL_SERVING) também passou a
ser capturado e faz parte da chave.

**Tabelas novas/alteradas (Fase 2)**:
- `databricks_consumo` — uma linha por `(workspace_id, sku_name, produto_origem, usage_date, usuario,
  recurso_hash)`, com `usage_quantity`/`preco_unitario`/`custo_estimado`/`usage_metadata`
  (JSONB)/`custom_tags` (JSONB) — granularidade que `azure_costs` nunca vai ter. Migração idempotente em
  `ensureAzureColetaTable()` pra bancos que já tinham a tabela na granularidade antiga: `ADD COLUMN IF NOT
  EXISTS` pras colunas novas + um bloco `DO $$...$$` que acha o nome real da UNIQUE constraint antiga via
  `pg_constraint` (em vez de arriscar um `DROP CONSTRAINT` com nome chutado — a nomeação automática do
  Postgres pra `UNIQUE` inline no `CREATE TABLE` pode variar) e troca pela nova de 6 colunas.
- `databricks_coleta_historico` — mesmo formato de `azure_coleta_historico` (status, contagens, timing,
  origem manual/agendado).

**Agendador**: `_iniciarAgendador()` ganhou um bloco novo (dentro do mesmo `_tickAgendador`, mesmo timer de
5min) que checa `databricks_coleta_config` due — usa `_dbxColetaEmExecucao` (variável própria, **não**
`_coletaEmExecucao` do Azure), então uma coleta Databricks em andamento não bloqueia nem é bloqueada por uma
coleta Azure em andamento (tabelas diferentes, circuit breakers separados).

**Frontend**: `frontend/src/views/DatabricksConfigModal.tsx` (credenciais) + `DatabricksAgendamentoModal.tsx`
(porta de `AgendamentoModal.tsx` sem o picker de assinaturas — a Coleta Databricks não tem escopo por
subscription/RG) + `frontend/src/components/DatabricksColetaMonitor.tsx` (porta simplificada de
`ColetaMonitor.tsx`, sem sub-assinaturas/chunks — a Fase 2 roda tudo num único statement; "Fechar" não é
persistido em localStorage aqui, diferente do original). Tudo isso dentro do card "Coleta Databricks" em
`ColetaView.tsx`, entre Service Principals e Storage Accounts.

**"Testar Conexão" verifica as System Tables individualmente, não só `SELECT 1` (2026-08-25)** — pedido do
usuário antes de seguir pra Fase 3: "garanta se todas as Tables Necessária do Workspace... que tem o Unity
Catalog está ok." Motivo pelo qual `SELECT 1` sozinho não bastava: no Databricks, o schema `system` inteiro
(e cada subschema, como `system.billing`) precisa ser **explicitamente habilitado por um account admin**
(Catalog Explorer → System Tables — não vem habilitado por padrão em nenhuma conta) e o Service Principal
precisa de `USE SCHEMA` + `SELECT` nas tabelas específicas; nenhuma dessas duas coisas é coberta por um
`SELECT 1` genérico contra o warehouse, que só prova que a autenticação e o warehouse em si funcionam.
Corrigido: `POST /api/databricks-coleta/config/:id/testar` agora roda `SELECT 1 FROM <tabela> LIMIT 1` pra
cada uma de `_DBX_REQUIRED_TABLES` (`system.billing.usage`, `system.billing.list_prices` — nomes fixos no
servidor, nunca vêm do request, então interpolar na query é seguro) depois do teste de warehouse, retornando
`{ ok, message, tabelas: { '<nome>': { ok, message } } }` — o `message` de cada tabela é o erro cru do
Databricks (`TABLE_OR_VIEW_NOT_FOUND` = schema não habilitado na conta; `PERMISSION_DENIED`/`ACCESS_DENIED` =
falta grant no Service Principal), então o usuário sabe exatamente qual das duas causas é a dele, em vez de
descobrir só na primeira coleta agendada real. Frontend (`ColetaView.tsx`'s `testarDbxMutation`) mostra o
resumo por tabela no toast (✅/❌ por nome + mensagem de erro quando falha).

**Esclarecimento sobre "token da API" (2026-08-25)** — o usuário reportou que a tela de configuração pede
Client ID/Client Secret mas não um "token da API". Isso é esperado no fluxo OAuth M2M: não existe um token
pra colar manualmente — `client_id`+`client_secret` são as credenciais do Service Principal criado no
console da conta Databricks (account-level), e `_databricksGetToken` troca essas credenciais por um token de
acesso automaticamente, a cada execução (mesmo padrão da Coleta Azure). Motivo original de não ter oferecido
PAT desde o início: amarra a automação a uma pessoa (mesma razão pela qual a Coleta Azure usa Service
Principal). **Atualizado em 2026-08-26** — ver bullet abaixo: PAT foi implementado como modo alternativo, a
pedido explícito do usuário (não tinha acesso de account admin pra criar um Service Principal na conta).

**Modo de autenticação PAT (Personal Access Token) — 2026-08-26, pedido do usuário**: além de OAuth M2M
(Service Principal a nível de conta — precisa de account admin pra criar), agora `databricks_coleta_config`
tem `modo_auth` (`'oauth_m2m'` padrão | `'pat'`) + coluna `token` (cifrada, mesmo padrão de `client_secret`).
PAT é um Bearer token usado direto contra a Statement Execution API — **sem** troca de token via
`_databricksGetToken` (`_resolveDbxToken(cfg)`, novo helper compartilhado por `/testar` e
`_executarColetaDatabricks`, decide qual caminho usar a partir de `cfg.modo_auth`). `account_id`/`client_id`/
`client_secret` viram opcionais no schema e na validação das rotas (`POST`/`PUT /api/databricks-coleta/config`)
quando `modo_auth='pat'` — só `token`+`workspace_host`+`warehouse_id` são obrigatórios nesse modo. Frontend
(`DatabricksConfigModal.tsx`) troca os campos de credencial conforme o modo selecionado (`<select
id="dbx-modo-auth">`); `ColetaView.tsx`'s tabela mostra um badge "🔑 PAT" no lugar das colunas Account/Client
ID quando aplicável. Funciona porque System Tables do Unity Catalog são a nível de metastore/conta — um PAT
de workspace (gerado por qualquer usuário ou Service Principal de workspace com `USE SCHEMA`+`SELECT` em
`system.billing.*`) consegue ler as mesmas tabelas sem precisar de uma identidade a nível de conta. Verificado
via Playwright contra o servidor real: alternar pro modo PAT esconde Account/Client ID e mostra o campo
Token; salvar com token preenchido funciona; badge "🔑 PAT" aparece na listagem; exclusão de teste sem erro.

### Coleta Databricks — Fase 3 (dashboard, orçamentos, alertas — 2026-08-25)

Fecha o ciclo: `databricks_consumo` (Fase 2) já era coletado mas não tinha nenhuma tela pra consultar, nenhum
conceito de orçamento no sistema, e nenhum alerta de estouro. O card "Coleta Databricks" (`ColetaView.tsx`)
dizia literalmente "dashboard dedicado ainda não existe (Fase 3)" antes desta rodada.

**Sem lib de gráficos nova, deliberadamente contra o roteiro original** (que cogitava `recharts`) —
`DashboardView.tsx` já tinha um precedente 100% funcional de barra via CSS puro (`.cloud-stat-bar`/
`.cloud-stat-bar-fill`, `width:pct+'%'` inline, sem nenhuma lib) pra exatamente esse tipo de visual. Os 5
gráficos pedidos (tendência mensal, ranking por workspace/SKU/usuário, free-tier vs. pago) cabem todos em
barras CSS + um sparkline SVG inline — zero dependência nova adicionada, bundle cresceu ~15KB (~3.5KB gzip)
em vez dos 100KB+ que `recharts` traria. Cor sequencial única por card de ranking (magnitude, não identidade
entre cards — reaproveita tokens já validados `--accent`/`--blue`/`--green`, não uma paleta nova).

**Agregação em SQL, não client-side** — `databricks_consumo` é série temporal que cresce por coleta
(diferente de `acoes`/`estimativas`, pequenas e agregadas no cliente pelo `DashboardView.tsx`); segue o
padrão de `azure_costs`.

**Backend** (`server.js`): nova tabela `databricks_budgets` (`nome`, `workspace_id` nullable = orçamento
global, `valor_mensal`, `ativo`). Novas rotas, todas `authMiddleware, dbMiddleware` (mesmo nível de acesso já
usado por `/api/databricks-coleta/config*` — nenhuma rota Databricks usa `adminMiddleware` hoje):
```
GET    /api/databricks-coleta/resumo      — agregações pro dashboard (data_inicio/data_fim; default últimos 6 meses)
GET    /api/databricks-coleta/budgets     — lista orçamentos
POST   /api/databricks-coleta/budgets     — cria
PUT    /api/databricks-coleta/budgets/:id — atualiza
DELETE /api/databricks-coleta/budgets/:id — exclui
GET    /api/databricks-coleta/alertas     — orçamentos ativos com % do mês corrente ≥ 75%
```
`GET /resumo` roda 6 queries `GROUP BY` em paralelo (`Promise.all`) contra `databricks_consumo` — total, por
mês, por workspace/SKU/usuário (top 10 cada, `usuario=''` mapeado pra `'Não identificado'` na resposta) e
free-tier vs. pago (`sku_name ILIKE '%FREE%' OR custo_estimado=0`, heurística do exemplo original do usuário
— `GENIE_FREE_USAGE`). Sem cache de 5min (diferente das rotas de `azure_costs`) — tabela ainda pequena, YAGNI.
`GET /alertas` soma `custo_estimado` do mês corrente por orçamento ativo (filtrado por `workspace_id` quando
escopado) e retorna severidade `atencao`(≥75%)/`critico`(≥90%)/`estourado`(≥100%).

**Frontend**: `frontend/src/views/DatabricksDashboardView.tsx` (nova view de topo, rota `databricks` — não
mais uma seção dentro de `ColetaView.tsx`, que já tinha 636 linhas e 11 modais importados antes desta fase).
Adicionada a `MIGRATED_VIEWS` (app.js) e ao mapa `VIEWS` (`App.tsx`); novo item de sidebar em `index.html`
("Databricks", entre "Coleta Azure" e o menu de usuário). `ColetaView.tsx`'s card "Coleta Databricks" ganhou
um botão "📊 Ver Dashboard" (`window.showView('databricks')`) no lugar do texto "ainda não existe".
`frontend/src/components/DatabricksBudgetModal.tsx` (CRUD de orçamento) e
`frontend/src/components/DatabricksBudgetAlertModal.tsx` (popup de alerta).

**Alerta em React, não no `app.js` legado** — o padrão espelhado é `checkRsvAlertsPopup` (app.js:423-480,
Reservas: popup client-side ao entrar no app, severidade por faixa), mas Fases 1/2 desta feature já eram
100% React; escrever DOM/modal legado novo iria contra a direção da migração. Diferença deliberada do
original: o Reservas não tem nenhum guard de sessão real (o comentário no código promete "uma vez por sessão"
mas não há guard — bug documentado, não replicado aqui de propósito); `DatabricksBudgetAlertModal.tsx` usa
`sessionStorage` (`databricks_alertas_dismissed`, guardando os ids de orçamento já dispensados) pra não
reabrir o mesmo alerta a cada navegação entre views na mesma sessão. Montado globalmente em `App.tsx`, mas
condicionado a um `autenticado` latch (vira `true` na primeira vez que qualquer view monta via bridge, nunca
volta a `false`) — `view` em si vira `null` toda vez que o usuário navega pra uma tela legada ainda não
migrada, o que desmontaria/remontaria (e reabriria) o popup a cada ida-e-volta entre view migrada/legada se
ele dependesse de `view` diretamente.

**Verificado via Playwright contra o servidor real** (login real, não só testes unitários): dashboard monta
sem erro de console, estado vazio (`tem_dados:false`, sem dado Databricks real neste ambiente) renderiza
corretamente, CRUD de orçamento completo (criar → aparece na tabela com toast de sucesso → toggle ativo/
inativo sem erro → excluir com `confirm()` → some da tabela com toast) funciona ponta a ponta, e o botão
"Ver Dashboard" em `ColetaView.tsx` navega pra `databricks` corretamente. **Não verificado**: os gráficos com
dados reais (nenhuma conta Databricks disponível neste ambiente, mesma ressalva de Fases 1/2) — a
verificação cobriu o estado vazio e a mecânica de CRUD/navegação, não a renderização dos rankings/sparkline
com valores reais.

**Rollback**: tag git `pre-databricks-coleta-2026-08-25` no commit anterior a toda a feature (Fases 1, 2 e 3).

**Histórico de Execuções ganhou aba própria "Coleta Databricks" (2026-08-26)** — antes disso, os logs/alertas
de coleta Databricks já existiam (sino, e-mail, monitor ao vivo), mas não havia lugar pra ver o histórico de
execuções passadas fora do monitor ao vivo. `GET/DELETE /api/databricks-coleta/historico` (server.js, mesmo
padrão de `azure_coleta_historico` — JOIN com `databricks_coleta_config` pra trazer o nome da configuração)
alimenta um 4º valor no seletor de Histórico de Execuções (`ColetaView.tsx`, junto de API Oficial/Via
Storage/Import Manual — essas três são todas Azure). Reaproveita a mesma tabela/UI (Origem, Duração, Log
clicável) já usada pras execuções Azure.

**Validação (2026-08-27, pedido do usuário — paridade com a Coleta Azure)** — a Coleta Azure já tinha um
mecanismo de integridade pós-coleta (`_validarColeta`: compara dias/subscriptions com dados vs. esperados no
período, calcula gaps, classifica `ok`/`aviso`/`falha`/`inconclusivo`) com botão "Revalidar" na tela; a
Coleta Databricks não tinha nada equivalente — a coluna Validação sempre mostrava "—" pras linhas de
Databricks no histórico. `_validarColetaDatabricks(histId, configId, inicio, fim)` (server.js) espelha a
mesma lógica contra `databricks_consumo` (`usage_date` em vez de `cost_date`, `custo_estimado` em vez de
`cost_in_billing_currency`), mas **sem o conceito de "subscriptions esperadas"** — a Coleta Databricks não
tem um escopo explícito de workspaces escolhido pelo usuário (System Tables são a nível de conta inteira,
sem uma lista pra comparar contra) — `subs_esperadas` fica sempre `0` no JSON de validação, mesmo tratamento
que a Coleta Azure já dá pro modo Storage (sem lista explícita = campo informativo, não afeta o status
ok/aviso/falha). `workspaces_com_dados` (contagem de `workspace_id` distintos) é reportado no mesmo campo
`subs_com_dados` do `ValidacaoJson` já existente no frontend — reaproveita o tipo/schema inteiro sem
duplicar, só o **rótulo muda na UI** ("Workspaces" em vez de "Subscriptions").

Chamada automaticamente ao final de toda coleta Databricks bem-sucedida (`_executarColetaDatabricks`, mesmo
ponto onde a Coleta Azure chama `_validarColeta`). Nova rota `POST /api/databricks-coleta/historico/:id/validar`
(revalidação manual) espelha `POST /api/azure-coleta/historico/:id/validar`. Novas colunas
`validacao_status`/`validacao_json` em `databricks_coleta_historico` (migração idempotente via `ADD COLUMN
IF NOT EXISTS`, mesmo padrão já usado nas outras tabelas Databricks).

**Frontend**: `ColetaValidacaoModal.tsx` (já existia pra Azure) ganhou uma prop opcional `fonte?: 'azure' |
'databricks'` — mesmo componente reaproveitado pros dois, só troca qual função de API chama
(`validarHistoricoDatabricks` vs. `validarHistorico`) e o rótulo "Subscriptions"/"Workspaces". `ColetaView.tsx`
passa `fonte={histTab === 'databricks' ? 'databricks' : 'azure'}` ao abrir o modal — decidido pela aba
selecionada no momento, não por um campo no próprio item (`HistoricoItem` de Databricks não carrega essa
informação, já que `tipo` fica `null` pra esses registros).

Verificado: `node --check`, `tsc -b`, testes novos (Vitest, mockando as duas APIs de validação — confirma que
`fonte='databricks'` chama a rota certa e não a de Azure) e rota `POST .../historico/99999/validar` retornando
404 limpo contra o servidor real. **Atualização (mesmo dia, via Importação Manual — ver abaixo)**: o cálculo
de validação em si foi confirmado com dados reais gravados via o import manual novo — `validacao_status:'ok'`,
`custo_total`/`dias_com_dados`/`subs_com_dados` todos corretos pro CSV de teste. O que continua não verificado
é só o caminho da coleta AO VIVO via API (`_executarColetaDatabricks`) — nenhuma conta Databricks real
disponível neste ambiente pra isso.

### Coleta Databricks — Importação Manual (2026-08-27)

Pedido do usuário: "igual temos para os demais" (Azure já tem uma aba "📥 Importação Manual" —
`ImportManualPanel.tsx` — pra quem não tem/não quer configurar coleta automática). Databricks não tinha
nenhum caminho de ingestão fora da coleta via API.

**Deliberadamente mais simples que o import Azure**: só `.csv` (não `.parquet`/`.zip`) — um export do Azure
Cost Management é um artefato oficial grande, que pode vir compactado/particionado; um export Databricks
manual é tipicamente o resultado de uma query que o próprio usuário rodou no SQL Editor contra
`system.billing.usage`, bem menor. Limite de 100 MB (vs. 2 GB do Azure).

**Template de colunas próprio, não uma tentativa de imitar o export nativo do Databricks** — não há como
confirmar o formato exato de export do Databricks neste ambiente (sem conta real), e um STRUCT/MAP
(`usage_metadata`/`custom_tags`) exportado pra CSV por ferramentas diferentes pode ficar formatado de jeitos
imprevisíveis. Em vez de adivinhar, o CSV aceito usa os MESMOS nomes de campo internos que a coleta ao vivo
já produz (`workspace_id`, `sku_name`, `produto_origem`, `usage_date`, `usage_unit`, `usage_quantity`,
`usuario`, `preco_unitario`, `custo_estimado`, `usage_metadata`, `custom_tags` — as duas últimas, opcionais,
esperam uma string JSON válida; se não for JSON válido, a linha ainda é aceita, só sem esse dado). Poucos
aliases pros nomes nativos do Databricks (`billing_origin_product` → `produto_origem`) via `_mapRowDatabricksImport`
(mesmo padrão de lookup case-insensitive já usado em `_mapRowCSV` pro import Azure). Colunas obrigatórias:
`workspace_id`, `sku_name`, `usage_date` — linhas sem essas três são ignoradas (contadas e logadas, não
derrubam o import inteiro).

**Reaproveita a infraestrutura de progresso da coleta ao vivo, não um segundo mecanismo de job/polling** —
diferente do Azure (que tem seu próprio `_importJob`/`GET /azure-costs/import-status`), a importação
Databricks usa `_dbxColetaEmExecucao`/`_dbxColetaProgresso`, os MESMOS que a coleta via API já usa. Resultado
prático: o `DatabricksColetaMonitor` (card já existente, sem nenhuma mudança) mostra o progresso do import em
tempo real de graça — e as duas travam uma à outra (não dá pra rodar uma coleta ao vivo e um import ao mesmo
tempo), o que faz sentido já que os dois escrevem na mesma tabela.

`_processarLinhasDatabricks(histId, configId, origem, periodoInicio, periodoFim, linhas, msgFinal)` — extraído
de dentro de `_executarColetaDatabricks` (que ficou só com a parte de autenticar+consultar a API, delegando a
gravação pra essa função compartilhada) pra ser reaproveitado pelos dois caminhos sem duplicar
upsert/hash/validação/notificação.

**`config_id` sempre `NULL`** pra dados importados manualmente — não é "de" nenhuma conexão OAuth M2M/PAT
específica, é um dado avulso. Isso expôs um bug real em `_validarColetaDatabricks`: as 3 queries que filtram
por `config_id=$1` nunca teriam batido com `config_id NULL` (SQL `NULL = NULL` nunca é verdadeiro) — a
validação de qualquer import manual sempre daria "0 registros" mesmo com dados reais gravados. Corrigido
trocando `=` por `IS NOT DISTINCT FROM` (operador null-safe do Postgres) nas 3 queries. **Confirmado o bug
existia e o fix funciona**: testado contra o servidor real — antes do fix isso não foi testado (o bug só foi
percebido ao desenhar o import manual), depois do fix um import de teste (2 linhas, `config_id NULL`) validou
corretamente (`validacao_status:'ok'`, contagens batendo).

**Novo `origem='import'`** (além de `'agendado'`/`'manual'` já existentes) — distingue "importação de arquivo"
de "coleta via API disparada manualmente". Badge próprio `📥 Import` em `ORIGEM_BADGE` (`ColetaView.tsx`).

**Frontend**: `DatabricksImportManualPanel.tsx` (novo componente, dentro do card "Coleta Databricks", não um
card próprio como o do Azure) + `uploadDatabricksImport` (`api/databricksColeta.ts`, multipart via `fetch`
direto — mesmo padrão de `uploadImportFile` pro Azure, incompatível com o `apiFetch` padrão que fixa
`Content-Type: application/json`). Sem barra de progresso própria — só dispara o upload e mostra um toast;
o progresso real já aparece no `DatabricksColetaMonitor` (que já está montado na tela).

**Verificado via curl/Playwright contra o servidor real**: upload de um CSV de teste (2 linhas, workspace
fictício `ws-teste-verificacao`) → `202 Accepted` → status muda pra "Concluído" com `ins:2` → linha aparece em
`GET /databricks-coleta/historico` com `origem:'import'`, `validacao_status:'ok'` → `GET /databricks-coleta/resumo`
reflete o novo custo total e workspace corretamente → histórico de teste limpo depois (`DELETE
/databricks-coleta/historico`, única linha existente na tabela). Botão "Selecionar Arquivo .csv" confirmado
visível e funcional na tela real via Playwright, zero erro de console.

**Script de dados de teste** — `gerar_dados_teste_databricks.py` (raiz do repo, script solto, não faz parte
do app) gera um CSV sintético no formato aceito pela Importação Manual, com mistura de SKUs pagas/free-tier,
`custom_tags`/`usage_metadata` variados por recurso (testa a granularidade por recurso) e, opcionalmente
(`--criar-orcamentos`), Orçamentos de teste via API. Só biblioteca padrão do Python pra gerar o CSV;
`requests` só é necessário com `--criar-orcamentos`.

### Coleta Databricks — Expurgo de Dados (2026-08-27)

Pedido do usuário logo depois de gerar dados de teste repetidamente via `gerar_dados_teste_databricks.py`
pra validar a Importação Manual — precisava de um jeito de limpar `databricks_consumo` sem esperar um
"Limpar Dados" geral (que nem existia). Porta de `ExpurgoModal.tsx` (Azure), mesma UX (preview antes de
habilitar "Confirmar", `confirm()` como segundo gate), mas **escopado por `workspace_id` em vez de
`arquivo_origem`** — `databricks_consumo` não rastreia de qual arquivo cada linha veio (`config_id` fica
`NULL` pra import manual, sem coluna de arquivo), então "por arquivo" não é um filtro possível hoje; "por
workspace" cobre o caso de uso real (limpar um workspace de teste específico) sem precisar de coluna nova.
Sem retry de deadlock (diferente do purge Azure, `azure-costs/purge`) — volume de escrita concorrente muito
menor aqui, esse cenário não se aplica.

**Backend**: `GET /api/databricks-coleta/purge/preview` + `DELETE /api/databricks-coleta/purge`
(`data_inicio`/`data_fim`/`workspace_id` como query params, mutuamente exclusivos — mesmo padrão do Azure).
Sem `workspace_id` nem período: `TRUNCATE TABLE databricks_consumo`. Só afeta `databricks_consumo` — nunca
`databricks_coleta_historico` (esse já tem seu próprio "Limpar" desde a aba Histórico de Execuções, mesma
separação de responsabilidade que a Azure já tinha entre `azure_costs`/`azure_coleta_historico`).

**Frontend**: `DatabricksExpurgoModal.tsx`, novo botão "🗑 Limpar Dados" no card Histórico de Execuções quando
`histTab === 'databricks'` (ao lado do "Limpar" que já existia ali, que limpa só o histórico/log, não os
dados de consumo em si). Lista de workspaces pro modo "Por workspace" vem de `GET /resumo`, mas chamado com
um range bem largo (`2015-01-01` → hoje) em vez do default de 6 meses do dashboard — o objetivo aqui é
justamente limpar dados antigos que o dashboard normal talvez nem esteja mostrando.

**Verificado contra o servidor real** — usado pra limpar de vez os dados de teste acumulados nesta sessão
(102 registros, entre o teste manual anterior e o script Python): preview + delete por `workspace_id` (2
registros, exato) e depois "tudo" (100 registros restantes) — os dois modos confirmados removendo
exatamente o número previsto, tabela zerada no final. Modal renderizado via Playwright sem erro de console.

### Coleta Databricks — Dashboard: tendência em barras + forecast, e drill-down (2026-08-27)

Pedido do usuário: (1) trocar o gráfico "Tendência Mensal" de linha pra barra, com uma previsão de custo
baseada na tendência de consumo; (2) poder clicar num campo (Workspace/SKU/Usuário) e ver os outros gráficos
se reajustarem ao filtro — drill-down.

**Forecast — regressão linear, não média móvel**: `frontend/src/lib/forecastLinear.ts` (função pura,
testável — `forecastLinear.test.ts`, 8 casos: tendência de alta, de queda, plana, dados insuficientes,
lista vazia, virada de ano, `mesesPrever=0`). Mínimos quadrados sobre `(índice do mês, custo)`, projeta 3
meses à frente a partir do último mês real. Custo previsto nunca fica negativo (`Math.max(0, ...)`) — uma
tendência de queda forte não deveria produzir "custo negativo" no gráfico. Com menos de 2 meses de
histórico não há tendência calculável — retorna só o histórico, sem previsão (sem "inventar" uma reta com 1
ponto só).

**Gráfico de barras, sem lib nova** — mesma decisão já tomada pro resto do dashboard (`RankingCard`, barras
CSS): `MonthlyBarChart` é um `<svg>` próprio em `DatabricksDashboardView.tsx`, sem `recharts`/`d3`. Barras de
previsão usam **textura hachurada + borda tracejada** (`<pattern id="dbxForecastHatch">`, 45°) em vez de só
uma cor mais clara — é a distinção categórica "real vs. previsto" (não uma questão de magnitude), então a
regra do skill `dataviz` de reservar textura pro caso CVD/impressão se aplica bem: quem não distingue a cor
mais clara do roxo sólido ainda vê a hachura. Legenda "Real"/"Previsão (tendência linear, 3 meses)" sempre
visível quando há previsão (nunca cor sozinha carregando o significado). Rótulo de valor só nas barras de
previsão + na última barra real (regra do skill "rótulos seletivos, nunca em todo ponto") — o histórico
completo continua acessível via tooltip nativo (`<title>` em cada barra).

**Drill-down — filtro no servidor, não client-side**: `GET /api/databricks-coleta/resumo` só devolve
agregados (`SUM(custo_estimado) GROUP BY ...`), nunca as linhas cruas de `databricks_consumo` — filtrar no
cliente não é possível sem essas linhas. Adicionados 3 params opcionais (`workspace_id`, `sku_name`,
`usuario`), aplicados ao `WHERE` de **todas as 6 queries** do endpoint (total, por mês, por workspace, por
SKU, por usuário, free×pago) — clicar num item de Workspace, por exemplo, reconsulta tudo já escopado
àquele workspace: o próprio card "Por Workspace" passa a mostrar só aquele item (confirmando o filtro
ativo), e os cards de SKU/Usuário/Tendência Mensal mostram a composição DENTRO daquele workspace. Mesmo
padrão de drill-down usado em ferramentas de BI (Power BI, Looker) — não é uma seleção visual isolada, é uma
nova consulta escopada.

`usuario` precisa de um sentinel (`__vazio__`) pro caso "Não identificado" — o servidor mapeia
`usage_metadata` sem `run_as` pra `usuario=''` no banco, e `?usuario=` (string vazia) é indistinguível de
"parâmetro omitido" em vários pontos do stack (Express `req.query`, `URLSearchParams`), então o card usa o
sentinel explicitamente; o servidor faz `usuario === '__vazio__' ? '' : usuario` antes de comparar com
`COALESCE(usuario,'')`.

**Frontend**: `RankingCard` (`DatabricksDashboardView.tsx`) ganhou `activeValue`/`onToggle` — cada item virou
clicável (toggle: clicar de novo no mesmo item remove o filtro), com destaque visual via `color-mix(in srgb,
${color} 15%, transparent)` no item ativo. **Deliberadamente não usa o padrão `${color}+'22'` (sufixo de
alfa hex)** já usado em outras telas — aqui `color` é sempre um token `var(--accent)`/`var(--blue,#4da6ff)`/
`var(--green,#22c55e)`, e concatenar um sufixo hex a um `var(...)` é exatamente o bug real já documentado
acima (Cobertura, Reservas/Ações/Estimativas) — `color-mix()` aceita `var()` como argumento sem esse
problema (a função é resolvida em tempo de paint, não por concatenação de string). Itens de ranking agora
carregam `{label, value}` em vez de derivar o valor de filtro do texto exibido — necessário porque "Não
identificado" (rótulo) e `__vazio__` (valor real de filtro) são coisas diferentes só na dimensão Usuário.

Chips de filtro ativo ("Detalhando por: Workspace: ws-x ✕") abaixo do seletor de período — clicar no chip ou
em "Limpar filtros" reseta. Dropdown de workspaces do modal "Novo Orçamento" usa uma **query separada**
(`workspacesQuery`, range fixo `2015-01-01` → hoje, sem os filtros de drill-down) — se reaproveitasse
`resumoQuery.data.por_workspace`, um drill-down ativo por workspace reduziria essa lista a 1 item só,
quebrando a criação de orçamento pra outros workspaces enquanto o usuário estivesse filtrando o dashboard.

**Verificado via Playwright contra o servidor real** (com os dados sintéticos gerados nesta sessão — 4
workspaces, 9 SKUs, 6 usuários, ver mais abaixo): barras de previsão aparecem com hachura + legenda; clicar
em `ws-ml-platform` no card "Por Workspace" atualiza total/tendência/SKU/usuário pro escopo do workspace,
mostra o chip removível, e o item clicado fica destacado; clicar de novo remove o filtro. Zero erro de
console. Efeito colateral encontrado e corrigido durante a verificação: o popup de alerta de orçamento
(`DatabricksBudgetAlertModal`, já existente da Fase 3) abre automaticamente ao entrar na tela quando há
orçamento estourado — não é um bug novo, só precisou ser fechado no fluxo de teste antes de interagir com o
dashboard por trás dele.

### Coleta Databricks — Governança de Custo (thresholds configuráveis + escopo por tag) e Anomaly Detection (2026-08-28)

Contexto: usuário pediu avaliação de um prompt gigante ("FinOps Databricks Governance Platform" — Python/
FastAPI/K8s, 12 subsistemas) para saber o que valeria adaptar pro FinOps Manager. Avaliação concluída: stack
incompatível (o app é um monólito Node/Express, o prompt pedia microserviços Python) e a maior parte do
prompt (Governance Engine com ações automáticas destrutivas, inventário de Jobs/Clusters/Genie/AI Gateway,
Delta Lake, FinOps Score) fica fora de escopo — nenhuma dessas APIs Databricks é usada hoje, e ações
automáticas de bloqueio/término carregam risco real de derrubar produção se mal implementadas. Escolhido
implementar só as duas partes de baixo/médio esforço que reaproveitam 100% da infraestrutura já existente
(`databricks_consumo`, `databricks_budgets`, alertas por e-mail): thresholds configuráveis + quota por tag
(Fase A do plano avaliado), e Anomaly Detection por Z-score/crescimento (Fase B).

**Governança — `databricks_budgets` ganhou escopo por tag e thresholds configuráveis**: antes, threshold
de alerta (75%/90%/estourado) era hardcoded em `_computeAlertasDatabricks()`, igual pra todo orçamento, e o
único escopo possível era "um workspace" ou "todos" (`workspace_id` nullable). Migração idempotente adiciona
`escopo_tipo` (`'global'|'workspace'|'tag'`, DEFAULT `'workspace'` — bate com todo registro pré-existente que
já tinha `workspace_id` preenchido), `tag_key`/`tag_valor` (nullable — usados só quando `escopo_tipo='tag'`,
filtra `custom_tags ->> tag_key = tag_valor` em `databricks_consumo`) e `threshold_atencao`/`threshold_critico`
(NUMERIC, DEFAULT 75/90 — preserva o comportamento antigo pra orçamentos já existentes). Um `UPDATE` corrige
o único caso que o DEFAULT erra sozinho: orçamentos globais pré-existentes (`workspace_id IS NULL`) ficariam
com `escopo_tipo='workspace'` por causa do DEFAULT — corrigido pra `'global'` explicitamente.

**Por que "tag" e não "departamento"/"centro de custo" como campos próprios**: `custom_tags` (JSONB, já
coletado por recurso desde a granularidade por-recurso — ver Fase 2 acima) é estrutura livre — cada
organização usa chaves diferentes (`projeto`, `time`, `centro_custo`, `squad`...). Em vez de inventar colunas
fixas que só cobririam os nomes que eu adivinhasse, o orçamento aponta pra QUALQUER chave já presente no dado
real (`GET /api/databricks-coleta/tags` lista as chaves vistas — hoje `ambiente`/`projeto`/`time`, vindo dos
dados sintéticos gerados nesta sessão; `GET /api/databricks-coleta/tags/:chave/valores` lista os valores de
uma chave, populando dois `<datalist>` no modal em vez de texto livre — evita "projeto" vs "Projeto" nunca
baterem no filtro por erro de digitação). Isso fecha o gap real que ficou em aberto numa conversa anterior
desta sessão ("não existe quota por usuário/projeto hoje, só por workspace/global").

**Bug real encontrado e corrigido de passagem, no popup `DatabricksBudgetAlertModal.tsx`** (existente desde a
Fase 3, não introduzido agora): `background: info.cor + '14'` / `border: `1px solid ${info.cor}55`` — mesmo
padrão de sufixo de alfa hex já documentado como bug noutros lugares deste arquivo (Cobertura, Reservas/
Ações/Estimativas) — funciona só quando `cor` é um literal `#RRGGBB`; para `severidade='critico'` e
`'estourado'`, `info.cor` é `'var(--orange,#ff8c42)'`/`'var(--red,#ff4d6a)'` (tokens `var()`), e concatenar um
sufixo hex a um `var(...)` produz uma declaração CSS inválida, descartada pelo browser inteira — o card de
alerta ficava sem fundo/borda visíveis pra exatamente os dois níveis de severidade mais urgentes (crítico e
estourado), só "atenção" (cor `#f5c518`, hex literal) tinha alguma aparência. Corrigido com `color-mix(in
srgb, ${info.cor} X%, transparent)` — aceita `var()` como argumento sem o problema (resolvido em tempo de
paint, não por concatenação de string), mesmo padrão já usado em `RankingCard` (Dashboard). Também corrigido
nesse popup: `a.budget.workspace_id || 'Todos os workspaces'` não sabia mostrar escopo por tag — extraído
`escopoLabel()` (mesma função em `DatabricksBudgetAlertModal.tsx` e `DatabricksDashboardView.tsx`) e o texto
fixo "de 75%" trocado por "o limite de alerta configurado" (thresholds agora variam por orçamento).

**`toggleAtivoMutation` (DatabricksDashboardView.tsx) tinha um bug latente que só ia aparecer com escopo por
tag**: reenviava só `{nome, workspace_id, valor_mensal, ativo}` ao marcar/desmarcar "Ativo" — um PUT parcial,
sem `escopo_tipo`/`tag_key`/`tag_valor`. `_validarBudgetInput` (server.js) deriva `escopo_tipo` de
`workspace_id` quando ausente no body — pra um orçamento por tag (`workspace_id` sempre `null`), isso
converteria silenciosamente o orçamento pra `'global'` a cada toggle. Corrigido reenviando o objeto completo.

**Anomaly Detection — dois tipos, escolhidos pelo que o dado atual permite detectar com confiança
estatística**: `_computeAnomaliasDatabricks()` (server.js). "Consumo noturno"/"job anormal" (do prompt
original avaliado) ficaram de fora — exigiriam granularidade de horário (`usage_date` é `DATE`, sem hora) ou
inventário de jobs (não coletado, fora de escopo — ver avaliação acima), nenhum dos dois existe hoje.
1. **Custo diário fora do padrão (Z-score)** — série contínua de 1 variável (custo/dia), caso clássico de
   Z-score: `(valor − média) / desvio-padrão` sobre uma janela de 35 dias, in-sample (o próprio dia entra na
   média — simplificação deliberada; com 35 dias um outlier isolado não domina a média o suficiente pra
   mascarar a si mesmo). Rodado por escopo **global E por workspace** — um workspace pequeno "some" dentro da
   média geral, então workspaces também têm sua própria série. Threshold `|z| ≥ 2,5` (~98,7% da distribuição
   normal).
2. **Usuário com crescimento fora do padrão** — não usa Z-score: a "série" por usuário são só 2 números
   agregados (janela recente de 7 dias vs. janela histórica de 4 semanas anteriores), não uma série diária —
   Z-score exigiria aproximar a variância de uma soma de N dias (estatisticamente frágil). Em vez disso, %
   de crescimento (`média_diária_recente / média_diária_histórica − 1`), mais direto e mais fácil de explicar
   num alerta ("consumo de X cresceu 340% essa semana"). Threshold ≥ 100% (dobrou) + piso de R$ 50 no custo
   recente (evita ruído de usuário R$2→R$6 "triplicando"). `crescimento_pct: null` = usuário novo sem
   histórico anterior pra comparar (tratado como anômalo — "apareceu com consumo relevante", não uma divisão
   por zero disfarçada de "crescimento infinito").

**Endpoints**: `GET /api/databricks-coleta/anomalias` (dashboard, sob demanda) + `GET .../tags` +
`GET .../tags/:chave/valores` (dropdown do modal). `_checkAnomaliasDatabricks()` roda no mesmo ciclo horário
de `_iniciarAlertasEmail()` — dedup via `_tentarClaimAlerta` (cooldown de 24h já existente, reaproveitado sem
mudança): chave de custo diário não precisa de sufixo de período (`usage_date` é um dia histórico imutável,
nunca se repete — alerta 1x por dia anômalo, pra sempre); chave de usuário não inclui data (o cooldown de 24h
já cobre "continua anômalo → reavisa todo dia enquanto persistir", mesmo padrão de reserva/ação vencendo).

**Bug real encontrado e corrigido durante a verificação visual (Playwright) — datas de anomalia apareciam
como "Invalid Date"**: as duas queries SQL de custo diário devolviam `usage_date` cru (coluna `DATE`) em vez
de `to_char(usage_date,'YYYY-MM-DD')` (padrão já usado por `por_mes` em `GET /resumo`) — o driver `pg`
desserializa `DATE` como objeto `Date` do Node, e `res.json()` serializa esse objeto pra um ISO datetime
completo (`"2026-08-05T03:00:00.000Z"`, não `"2026-08-05"`). O frontend (`AnomaliasCard`) assumia a string
limpa e concatenava `+ 'T00:00:00'` pra montar a data — contra o ISO completo, produzia
`"2026-08-05T03:00:00.000ZT00:00:00"`, uma string inválida pro construtor `Date`. Mesma classe de bug já
documentada acima pro log da coleta ao vivo (`ColetaMonitor.tsx`), só na direção oposta: lá o servidor mandava
uma string "crua demais" (`HH:MM:SS`) e o cliente tentava re-parsear como data completa; aqui o servidor
mandava uma data "processada demais" (ISO datetime) e o cliente tentava completá-la como se fosse só o dia.
Corrigido na origem (SQL), não no cliente — `to_char()` nas duas queries, mesmo padrão já usado em todo o
resto do arquivo.

**Verificado via Playwright contra o servidor real** (com os dados sintéticos + orçamentos já existentes
desta sessão): motor de anomalia encontrou 4 anomalias reais nos dados sintéticos (Z-score 2,76 a 3,35,
picos de custo em dias específicos — confirma que o cálculo bate com variação real dos dados, não só
roda sem erro); popup de alerta renderiza com fundo/borda visíveis nos 3 níveis de severidade (fix do
`color-mix` confirmado visualmente); criação de orçamento por tag (`projeto = finops-core`) funciona
ponta a ponta — aparece na tabela com o escopo certo, dropdown de chave/valor populado com as tags reais
do banco. Orçamento de teste removido após a verificação (dados de consumo sintéticos continuam no banco,
a pedido do usuário — ver seção abaixo).

### Coleta Databricks — Quotas Genie via Databricks Account Budgets API (2026-08-28)

Pedido do usuário: pesquisar a documentação oficial do Databricks sobre gestão de quotas do
Genie via API e implementar. Pesquisado via WebSearch/WebFetch contra `docs.databricks.com`
(sem SDK/lib nova — só REST direto, mesmo padrão já usado pro resto da Coleta Databricks).

**Não existe uma "API do Genie" própria pra quotas** — cobrança de Genie começou em
2026-07-08, e o controle de gasto passa pela **Budgets API de nível de CONTA**
(`/api/2.1/accounts/{account_id}/budgets`, distinta de `.../budget-policies`, um recurso
diferente), usando `resource_type: BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY` — Genie roda sobre
o Unity AI Gateway, então quota de Genie é um caso particular de budget do AI Gateway.
Suporta threshold **compartilhado** (soma de todos) e **por usuário** (até 20 overrides,
4 thresholds compartilhados por budget — só 1 threshold implementado nesta v1, ver abaixo),
e duas ações por threshold: `EMAIL_NOTIFICATION` (alerta) ou **`BLOCK_USAGE`** (bloqueia
acesso real ao Genie quando o limite é cruzado — aplicado pelo próprio Databricks, não por
nós, sem nenhuma checagem nossa depois de criado).

**Diferente de `databricks_budgets` (Governança implementada antes, nesta mesma sessão)**:
aquele é um orçamento CALCULADO por nós sobre `databricks_consumo` (dado que já coletamos),
só alerta (nunca bloqueia nada). Isto aqui é a Budgets API NATIVA do Databricks — o
FinOps Manager só cria/lista/exclui via API, quem aplica o limite de verdade é o Databricks.

**Permissão — bloqueio provável identificado ANTES de implementar**: essa API exige
escopo OAuth `billing`, na prática role **Account Admin** (ou billing-admin) na conta — um
grant de CONTROLE DE CONTA, bem mais alto que o já usado pra ler System Tables (`USE
SCHEMA`+`SELECT`, um grant de DADO). O usuário já tinha dito, na sessão anterior (motivo
de existir o modo PAT — ver "Modo de autenticação PAT" acima), que não tinha acesso de
Account Admin pra criar Service Principal de conta — perguntado explicitamente via
`AskUserQuestion` antes de escrever qualquer código (evitar construir uma integração
inchamável no ambiente real do usuário); confirmou que TEM Account Admin desta vez, e
pediu o escopo completo incluindo bloqueio (não só leitura).

**`_getDbxAccountCredentials()` (server.js) rejeita modo PAT com mensagem explicando o
motivo** — APIs de nível de conta exigem OAuth M2M de Service Principal de CONTA; PAT
(usado hoje só pra System Tables via `_resolveDbxToken`) é workspace-level e não serve
aqui. Reaproveita a MESMA troca de token já usada pra System Tables (`_databricksGetToken`,
`scope=all-apis`) — nenhuma credencial nova precisa ser configurada, só a conexão padrão
(`is_padrao=true`) precisa estar em modo OAuth M2M.

**Guard-rail pra `BLOCK_USAGE` — dois portões, não um**: (1) frontend
(`GenieBudgetModal.tsx`) mostra uma caixa vermelha explicando a consequência + um checkbox
"Entendo e quero bloquear..." que precisa estar marcado pra habilitar "Salvar" (troca de
label pra "Criar quota com bloqueio", em vermelho); (2) `POST
/api/databricks-coleta/genie-budgets` (server.js) exige `confirmar_bloqueio:true` no BODY
da requisição — quem chamar a rota direto (curl/script, contornando o frontend) também
precisa declarar ciência, mesmo padrão de segundo gate já usado no Expurgo de Dados. Sem
o campo, retorna 400 com mensagem explicando o motivo, não falha silenciosa.

**`_dbErr` vs. erro cru — acerto de escopo desde o início**: as 3 rotas novas
(`GET/POST/DELETE .../genie-budgets`) inicialmente usavam `_dbErr(res, e)` (padrão da
maioria das rotas do arquivo — mascara qualquer erro pra `"Erro interno do servidor."`
por segurança) — isso derrotava o propósito das mensagens de erro específicas que a
própria feature depende pra ser usável (ex: "conexão padrão usa modo PAT..."). Corrigido
pra `res.status(400).json({ error: e.message })` nas 3 rotas, mesmo padrão já usado por
`POST .../config/:id/testar` ("erro cru é o propósito da rota") — achado e corrigido
ANTES de reportar a feature como pronta, testando contra o servidor real (a app já tinha
uma conexão Databricks real cadastrada em modo PAT, não marcada como padrão — cenário
perfeito pra expor o bug: sem o fix, o erro aparecia genérico; com o fix, a mensagem real
"Nenhuma conexão Databricks configurada como padrão..." aparece no card).

**Endpoints**: `GET /api/databricks-coleta/genie-budgets` (lista, filtra
`resource_type=BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY` no lado do servidor — a Budgets API
não filtra por resource_type na query, então trazemos tudo e filtramos aqui), `POST` (cria,
1 threshold por vez nesta v1 — múltiplos thresholds/overrides por usuário ficaram de fora
por simplicidade, dado o risco de configurar algo tão sensível sem poder validar contra
uma conta real), `DELETE .../genie-budgets/:id`. Sem UPDATE nesta v1 (schema de PATCH não
confirmado pela documentação pesquisada) — editar hoje é excluir e recriar.

**⚠️ NÃO VALIDADO contra uma conta Databricks real** (mesma ressalva de
`_databricksGetToken`/`_databricksRunQuery` desde a Fase 1) — implementado com base na
documentação oficial pesquisada nesta sessão (WebSearch/WebFetch, 2026-08-28), mas o shape
exato da resposta (principalmente campos de spend status, cuja documentação consultada não
detalhou completamente) pode precisar de ajuste na primeira chamada real. `GenieBudget`
(`frontend/src/types/genieBudgets.ts`) tipa só os campos confirmados pela documentação e
aceita `[extra: string]: unknown` pro resto, renderizado defensivamente.

**Frontend**: `GenieBudgetsCard` (dentro de `DatabricksDashboardView.tsx`) lista as quotas
com badge vermelho "🚫 Bloqueia" quando qualquer threshold tem `BLOCK_USAGE`, badge neutro
"✉ Alerta" caso contrário; erro do servidor (ex: conexão não-OAuth-M2M) aparece direto no
card, não escondido. `GenieBudgetModal.tsx` — nome, workspace IDs (lista separada por
vírgula), tags (pares chave/valor, N linhas), limite em **USD** (moeda da Budgets API do
Databricks — texto explícito no modal pra não confundir com o resto do app, que é BRL),
escopo compartilhado/por-usuário, ação alerta/bloqueio.

**Verificado via Playwright contra o servidor real**: card mostra o erro real
("Nenhuma conexão Databricks configurada como padrão...", já que a única conexão
cadastrada no ambiente é PAT e não está marcada como padrão) em vez de um erro genérico;
modal abre, aviso vermelho aparece ao selecionar "Bloquear acesso ao Genie", botão fica
desabilitado até marcar o checkbox de confirmação e habilita corretamente depois. Zero
erro de console (os 2 "Failed to load resource: 400" são o comportamento esperado do
browser logando a chamada que intencionalmente falha, não um bug JS). Fluxo de criação
bem-sucedida (POST retornando 200 com um budget real) **não pôde ser testado** — precisa
de uma conta Databricks real com Account Admin, não disponível neste ambiente.

Sources: [Manage budgets for Unity AI Gateway](https://docs.databricks.com/aws/en/ai-gateway/budgets),
[Manage budgets and cost controls for Genie](https://docs.databricks.com/aws/en/genie/budgets),
[Budgets API — Create new budget](https://docs.databricks.com/api/account/budgets/create),
[Budgets API — Get budget](https://docs.databricks.com/api/account/budgets/get),
[Budgets API — List](https://docs.databricks.com/api/account/budgets)

### Coleta Databricks — Dashboard: Custo por Job/Cluster/Warehouse (2026-08-28)

Pedido do usuário depois de descobrir (pesquisa na documentação oficial, ver "Quotas Genie"
acima) que `system.billing.usage.usage_metadata` já traz `job_id`/`job_name`/`cluster_id`/
`warehouse_id` — dado que **já coletamos** desde a granularidade por-recurso (Fase 2), só
nunca tinha sido agregado. **Zero coleta nova** — diferente de inventário de Jobs/Clusters
(que exigiria `system.lakeflow.jobs`/`system.compute.clusters`, fora de escopo desta
rodada), isto é só mais 3 queries de agregação sobre dado que já está em
`databricks_consumo`, mesmo padrão de `por_workspace`/`por_sku`/`por_usuario`.

**`GET /api/databricks-coleta/resumo` ganhou `por_job`/`por_cluster`/`por_warehouse`** +
3 novos filtros de drill-down (`job_id`/`cluster_id`/`warehouse_id`), aplicados no mesmo
`where` compartilhado por todas as agregações da rota — clicar num job, por exemplo,
reconsulta workspace/SKU/usuário/cluster/warehouse já escopados a esse job (confirmado via
Playwright: card "Por Warehouse" mostra "Sem dados no período" corretamente quando o job
selecionado nunca usou SQL Warehouse).

**Bug real encontrado e corrigido durante a verificação — bucket "null" gigante no topo do
ranking**: o filtro inicial usava `usage_metadata ? 'job_id'` (operador JSONB de
**existência de chave**), mas `usage_metadata` é uma STRUCT no Databricks — `job_id`/
`cluster_id`/`warehouse_id` **sempre existem como campo**, só variam entre um valor real e
`null` quando não aplicável (ex: uma linha de storage não tem `job_id`, mas o campo em si
está presente, só nulo). `?` retorna `true` pra toda linha independente do valor, então
`GROUP BY usage_metadata->>'job_id'` produzia um bucket `job_id: null` somando TODO o custo
das linhas sem job (R$ 73 mil, maior que qualquer job real de ~R$ 100) — encontrado testando
contra os dados sintéticos desta sessão (o gerador sempre inclui a chave `job_id` no JSON,
`null` quando o produto não é JOBS, replicando fielmente o comportamento real de uma STRUCT
Databricks serializada). Corrigido trocando pra `usage_metadata->>'job_id' IS NOT NULL`
(extrai o valor e testa null) nos 3 filtros — únicos itens com valor real aparecem no
ranking, sem bucket fantasma.

**Segundo bug real encontrado e corrigido — o `queryKey` do React Query não incluía os 3
filtros novos**: `resumoQuery` (`DatabricksDashboardView.tsx`) continuava com
`['databricks-resumo', periodo.inicio, periodo.fim, filtros.workspace_id, filtros.sku_name,
filtros.usuario]` — sem `filtros.job_id`/`cluster_id`/`warehouse_id` na chave, clicar num
item de Job/Cluster/Warehouse atualizava o estado (o chip "Detalhando por: Job: ..."
aparecia) mas o React Query **nunca refazia a consulta**, já que pra ele nada relevante
tinha mudado na chave — os outros cards continuavam mostrando os números não-filtrados,
silenciosamente incoerentes com o chip exibido. Encontrado pelo próprio teste novo (a
asserção de que a query seria chamada com `job_id` never disparava) antes de reportar a
feature como pronta — corrigido incluindo os 3 campos na `queryKey`.

**Sem nome amigável pra Cluster/Warehouse** — `usage_metadata` não traz `cluster_name`
(só `node_type`) nem nenhum nome de warehouse; mostrar isso exigiria a coleta de inventário
(`system.compute.clusters`) ainda fora de escopo. Job usa `job_name` quando presente
(`MAX(usage_metadata->>'job_name')` — um job pode ter o nome ausente em execuções antigas,
`MAX` pega qualquer valor não-nulo do grupo), caindo pro `job_id` cru quando ausente.

**Confirmado: SQL Warehouse não tem system table de inventário** (pesquisado na
documentação oficial) — "essas tabelas [system.compute.*] só cobrem all-purpose e jobs
compute, não serverless nem SQL warehouses". Custo por warehouse continua possível (via
`usage_metadata.warehouse_id`, implementado aqui), mas nome/dono/tamanho do warehouse só
via a Warehouses REST API de verdade (`GET /api/2.0/sql/warehouses`) — não implementado.

**Verificado via Playwright contra o servidor real** (dados sintéticos desta sessão):
3 cards novos populados corretamente após o fix do bucket null; drill-down por Job
reconsulta e escopa todos os outros cards, incluindo o estado vazio do card Warehouse.

### Coleta Databricks — Overrides por usuário/grupo nas Quotas Genie + reestruturação em sub-menu (2026-08-28)

Duas mudanças pedidas juntas: (1) permitir limite individual por usuário/grupo específico
nas Quotas Genie (a v1 anterior só tinha "mesmo limite pra cada usuário", não "usuário X
tem limite diferente de usuário Y"); (2) reorganizar a tela Databricks (que tinha virado
uma página única muito longa — KPIs, tendência, 6 rankings, Orçamentos, Anomalias, Quotas
Genie, tudo empilhado) num grupo de menu com 3 sub-abas: Dashboard / Orçamentos e
Anomalias / Quotas.

**Overrides — resolvido via Account SCIM v2.1 API**: a Budgets API só aceita
`principal_id` (int64, ID interno da conta) nos `principal_overrides`, nunca e-mail
direto — pesquisado na documentação oficial (WebSearch) que o caminho é
`GET /api/2.0/accounts/{account_id}/scim/v2/Users?filter=emails.value eq "..."` (usuário)
ou `.../Groups?filter=displayName eq "..."` (grupo), retornando o `id` que vira o
`principal_id`. Novo helper `_dbxScimFetch` (server.js) — prefixo de path diferente da
Budgets API (`/api/2.0`, não `/api/2.1`), por isso não generaliza `_dbxBudgetsFetch`, pra
não confundir as duas versões. Nova rota `GET /api/databricks-coleta/genie-principals?
tipo=user|group&query=...`. **Reaproveita a mesma credencial OAuth M2M de conta já usada
pra Budgets/System Tables** — nenhuma configuração nova pro usuário.

**Guard-rail: overrides só valem com escopo "Por usuário"** — a documentação é explícita
que overrides são ignorados silenciosamente em budgets de escopo compartilhado. Bloqueado
no servidor (`POST /genie-budgets` rejeita com 400 se `principal_overrides` vier
preenchido e `scope_type` não for `PER_USER`) — evita o admin descobrir isso só depois de
criar uma quota que não fez o que ele esperava. Limite de 20 overrides (da própria API)
também replicado no frontend antes de deixar adicionar o 21º.

**Frontend (`GenieBudgetModal.tsx`)**: seção "Limites individuais por usuário/grupo" só
aparece com escopo "Por usuário" — busca por e-mail exato (usuário) ou nome exato
(grupo), lista de resultados clicável, cada override adicionado vira uma linha com nome +
campo de valor (US$) + botão remover. "Salvar" fica bloqueado se qualquer override tiver
o campo de valor vazio ou ≤ 0 — mesmo padrão de validação já usado pros outros campos do
modal. **Não implementado**: edição de override depois de criado (a API não documenta um
PATCH pra isso na pesquisa feita) — mudar um override hoje é excluir e recriar a quota
inteira.

**Reestruturação em sub-menu — mesmo padrão já usado pelo Dashboard principal
(Ações/Estimativas)**: replicado nos 4 mesmos pontos —
- `index.html`: item plano `<a data-view="databricks">` virou `<div class="nav-group"
  id="nav-group-databricks">` com header (`data-view="databricks"`, `onclick=
  "openNavGroup('databricks')"`) + 3 sub-itens (`#nav-sub-dbx-dashboard`/`-orcamentos`/
  `-quotas`, cada um `onclick="showDbxTab('...')"`). Diferente do grupo Dashboard
  (`class="nav-group open"`, sempre expandido — é a tela de entrada do sistema), o grupo
  Databricks começa **colapsado** (`class="nav-group"`, sem `open`) — não é a página de
  login; `showView()` já abre o grupo automaticamente (`_navEl.closest('.nav-group')`)
  quando alguém navega pra lá por qualquer caminho (inclusive o botão "Ver Dashboard" de
  `ColetaView.tsx`, que chama `showView('databricks')` direto).
- `app.js`: `openNavGroup('databricks')` chama `showDbxTab('dashboard')` (mesmo padrão de
  `openNavGroup('dashboard')` → `showDashTab('acoes')`); `showDbxTab(tab)` chama
  `showView('databricks')` + `switchDbxTab(tab)` + atualiza `.nav-sub.active`;
  `switchDbxTab(tab)` só repassa pro canal da ponte (`window.__reactBridge.
  setDatabricksTab(tab)`) — nunca usa `mount()`/`showView()` de novo, que só
  remontariam a mesma view.
- `bridge.ts`: canal `currentDatabricksTab`/`databricksTabListener`/
  `setDatabricksTabListener`/`setDatabricksTab` — **separado** do canal já existente do
  Dashboard (`currentDashboardTab`/...), cada view migrada com sub-abas tem o seu
  próprio, não compartilham estado.
- `DatabricksDashboardView.tsx`: `useEffect(() => setDatabricksTabListener(...), [])`
  guarda `dbxTab` em estado local; o componente **continua sendo um único arquivo/
  export** montado sob a mesma chave `databricks` em `VIEWS` (App.tsx) — a divisão em 3
  "telas" é só JSX condicional por `dbxTab`, não 3 componentes/rotas separados (mesma
  decisão já tomada pro Dashboard principal: um arquivo, um estado de aba, não uma
  entrada nova em `MIGRATED_VIEWS`/`VIEWS`). Date-range picker + filtros de drill-down +
  KPIs + tendência + 6 rankings só aparecem na aba "Dashboard" (fazem sentido só ali —
  Orçamentos internos sempre olham "mês corrente", Anomalias tem janela fixa própria,
  Quotas Genie não tem conceito de período); `view-hero` (título + subtítulo dentro da
  página) muda de texto por aba via `DBX_TAB_INFO[dbxTab]` — o título da top-bar (fora da
  área de conteúdo, `#page-title`) continua fixo em "Dashboard Databricks" pro grupo
  inteiro, mesmo comportamento já aceito pro grupo Dashboard (Ações/Estimativas também
  não trocam o título da top-bar).

**Testes**: `DatabricksDashboardView.test.tsx` precisou de `window.__reactBridge.
setDatabricksTab('orcamentos'|'quotas')` antes de cada teste que verifica conteúdo dessas
abas (mesmo padrão já usado por `DashboardView.test.tsx` pras abas Ações/Estimativas) — e
um reset em `beforeEach` (`setDatabricksTab('dashboard')`), já que o estado do canal é de
módulo (singleton) e vaza entre testes sem isso. `GenieBudgetModal.test.tsx` ganhou 5
testes novos cobrindo a seção de overrides (aparece só com escopo certo, busca por
usuário/grupo, adicionar/remover, payload final).

**Verificado via Playwright contra o servidor real**: grupo "Databricks" expande com os 3
sub-itens corretos; alternar entre as 3 abas via `window.showDbxTab(...)` troca o
conteúdo e o título do `view-hero` sem remontar a view (sem perda de estado de outras
abas); modal "Nova Quota Genie" com escopo "Por usuário" mostra a seção de busca de
usuário/grupo corretamente. Zero erro de console (os 400 esperados são só a chamada de
Genie budgets falhando por falta de conexão OAuth M2M padrão, comportamento já
documentado). **Não verificado**: o fluxo de busca real via SCIM contra uma conta
Databricks de verdade (sem conta disponível neste ambiente, mesma ressalva de sempre) —
só a mecânica de UI (adicionar/remover/validar) foi confirmada, com dados mockados nos
testes automatizados.

### Coleta Databricks — edição de Quotas Genie (2026-08-28)

Pedido do usuário: "e posso configurar por aqui também?", sobre quotas Genie já
existentes na conta (criadas pela nossa tela ou direto no console do Databricks). A v1
anterior só tinha Create/List/Delete — editar exigia excluir e recriar, porque a
pesquisa inicial não tinha confirmado um endpoint de atualização. Pesquisado de novo a
pedido explícito ("por favor") e confirmado: **existe sim** — `PUT
/api/2.1/accounts/{account_id}/budgets/{budget_id}`, só não apareceu na primeira
varredura da documentação.

**PUT é substituição total, não PATCH parcial** — mesmo payload do POST de criação, só
que no path `/budgets/{id}` e incluindo `budget_configuration_id` no corpo. Validação e
montagem do payload extraídas pra `_validarGenieBudgetPayload(body, accountId)`
(server.js), compartilhada entre `POST` e o novo `PUT /genie-budgets/:id` — mesmas duas
regras de negócio valem pros dois (guard-rail de `BLOCK_USAGE`/`confirmar_bloqueio`,
overrides só com escopo "por usuário").

**`GenieBudgetModal.tsx` ganhou um prop opcional `budget`** — quando presente, todos os
campos são pré-preenchidos a partir do budget real (nome, workspace IDs, tags, limite,
escopo, ação, e-mail de destino, overrides existentes) e o "Salvar" chama
`updateGenieBudget(id, input)` em vez de `createGenieBudget(input)`. **Overrides já
existentes não têm nome/e-mail na resposta da API** (só `principal_id`, per a
documentação) — mostrados como `"ID: <principal_id>"` até serem removidos; overrides
novos adicionados durante a mesma edição mostram o nome real (resolvido pela busca
SCIM). **Checkbox de confirmação de bloqueio sempre começa desmarcado, mesmo editando
uma quota que já bloqueia** — decisão deliberada: cada alteração salva numa quota de
bloqueio exige reconfirmação explícita, não herda a confirmação da criação original.

**Botão "Editar" novo em `GenieBudgetsCard`** (`DatabricksDashboardView.tsx`), ao lado
do "Excluir" já existente — abre o mesmo modal com `budget={b}`; "Nova Quota Genie"
continua abrindo com `budget={null}` (`editingBudget` resetado explicitamente nos dois
pontos de entrada, pra não vazar estado de uma edição anterior pra um "Novo" seguinte).

**Verificado**: `tsc -b`, testes novos (3 em `GenieBudgetModal.test.tsx` — pré-
preenchimento completo, chamada de `updateGenieBudget` com o id certo em vez de
`createGenieBudget`, reconfirmação de bloqueio exigida ao editar; 1 em
`DatabricksDashboardView.test.tsx` — botão "Editar" abre o modal pré-preenchido), e a
rota `PUT /genie-budgets/:id` confirmada registrada contra o servidor real (mesmo erro
de credencial do GET, não um 404 de rota inexistente — prova que o roteamento está
correto). **Não validado**: um ciclo de edição completo contra uma conta Databricks
real (nenhuma disponível neste ambiente, mesma ressalva de sempre).

### Quotas Genie — modo demonstração (2026-08-28)

Pedido do usuário: validar/ajustar a estrutura de criar/editar quotas Genie sem uma conta
Databricks real disponível. Diferente do dashboard de consumo (`databricks_consumo`, uma
tabela real que sempre existiu), Quotas Genie **nunca teve persistência própria** — as 5
rotas (`GET/POST/PUT/DELETE /genie-budgets`, `GET /genie-principals`) sempre foram um
proxy direto pra Budgets/SCIM API real do Databricks, sem nada local pra "carregar dados
fictícios" dentro. As duas primeiras tentativas de resolver isso nesta sessão (screenshot
com interceptação de rede via Playwright; depois um navegador visível com CRUD mockado
client-side) davam só uma janela temporária — o processo em segundo plano era encerrado
entre turnos da conversa (sem marcador de conclusão no transcript), então a "sessão de
teste" nunca sobrevivia o suficiente pro usuário interagir de verdade.

**Solução: fallback de demonstração dentro do próprio servidor**, não mais um script à
parte. Nova tabela `databricks_genie_budgets_demo` (`id`, `payload` JSONB com o shape
completo de um `GenieBudget`, timestamps) — semeada automaticamente com 3 quotas de
exemplo (por workspace, por tag+usuário com overrides, com bloqueio) na primeira vez que
o servidor sobe e a tabela está vazia.

**Guard-rail contra misturar fictício com real**: `_dbxDemoModeNeeded(cfg)` (server.js) é
verdadeiro só quando NÃO existe uma conexão padrão em modo `oauth_m2m` (sem conexão
nenhuma, ou só PAT — exatamente o estado real deste ambiente, já que a única conexão
cadastrada é PAT). As 5 rotas checam isso ANTES de decidir entre a API real do Databricks
e a tabela local — nunca os dois ao mesmo tempo, então não tem como o dado fictício
mascarar ou se misturar com um dado real. No momento em que o usuário configurar e marcar
como padrão uma conexão `oauth_m2m` de verdade, todas as 5 rotas voltam a usar a Budgets/
SCIM API real automaticamente, sem nenhuma mudança de código — o fallback só é alcançável
na ausência de credencial real, nunca por escolha/flag manual que pudesse ser esquecida
ligada em produção.

**CRUD completo funciona de verdade em modo demonstração** — criar, editar (inclusive
overrides por usuário/grupo) e excluir persistem na tabela local exatamente como
persistiriam no Databricks real (mesma validação de `_validarGenieBudgetPayload`,
incluindo os guard-rails de `BLOCK_USAGE`/`confirmar_bloqueio` e overrides-só-com-escopo-
per-user). `GET /genie-principals` (busca de usuário/grupo pros overrides) também tem
fallback fictício (`_GENIE_DEMO_PRINCIPALS`, filtro por substring em vez de match exato,
já que é só pra exercitar a UI).

**Frontend**: cada budget vindo do fallback ganha `_demo: true` (campo extra, já coberto
pelo `[extra: string]: unknown` do tipo `GenieBudget`) — `GenieBudgetsCard` mostra um
banner laranja "🧪 Modo demonstração" quando qualquer item tem essa flag, deixando claro
que os dados são fictícios sem esconder isso do usuário nem exigir que ele saiba de
antemão se há uma conexão real configurada.

**Verificado contra o servidor real**: restart criou a tabela e semeou os 3 exemplos
(confirmado via `GET /genie-budgets`, todos com `_demo:true`); ciclo completo testado via
curl — criar (`POST`) → editar com novo valor (`PUT`) → listar (confirma o valor editado
persistiu) → excluir (`DELETE`) → listar de novo (confirma sumiu) — tudo batendo na tabela
local de verdade, não um mock de teste. Banner de demonstração confirmado visualmente via
Playwright. 2 testes novos em `DatabricksDashboardView.test.tsx` (banner aparece com
`_demo:true`, não aparece sem).

### Coleta Databricks — Dashboard: DBUs Consumidos (pagos vs. free) (2026-08-28)

Pedido do usuário: mostrar consumo em **DBUs** (a unidade nativa do Databricks), não só
em R$ — o card de custo Free-tier/Pago já existente esconde totalmente o volume quando o
custo é zero (free-tier sempre custa R$ 0,00 por definição, mas ainda consome DBUs de
verdade).

**Reaproveita a mesma agregação, só troca a coluna somada**: a query de `free_vs_pago`
em `GET /api/databricks-coleta/resumo` já filtrava por `sku_name ILIKE '%FREE%' OR
custo_estimado = 0` e somava `custo_estimado`; ganhou 2 colunas extras (`dbu_free`/
`dbu_pago`) somando `usage_quantity` com o mesmo filtro, na mesma query — sem round-trip
adicional ao Postgres. Resposta ganhou `dbus_free_vs_pago: {free, pago}`, paralelo ao
`free_vs_pago` já existente.

**Por que somar `usage_quantity` sem filtrar por `usage_unit`**: `databricks_consumo` só
guarda linhas de billing Databricks (nunca infra Azure, que fica em `azure_costs`, tabela
separada) — todo o consumo capturado aqui já é nativamente denominado em DBU. Filtrar por
`usage_unit = 'DBU'` seria uma defesa contra um cenário que não existe nesta tabela.

**Achado real confirmando o valor da feature, nos próprios dados sintéticos desta
sessão**: `free_vs_pago` mostra R$ 0,00 de custo free-tier (esperado — free-tier sempre
custa zero), mas `dbus_free_vs_pago` mostra 3.270,39 DBUs consumidos de graça (11% do
total) — exatamente a informação que ficava invisível olhando só o card de custo em R$.

**Frontend**: novo card "DBUs Consumidos" entre a barra de custo Free/Pago e a Tendência
Mensal — mesmo layout (3 stat-cards + barra de proporção), reaproveitando o padrão visual
já validado, só com `fmtDBU()` (número + sufixo "DBU") em vez de `fmtBRL()`.

**Verificado via Playwright contra o servidor real**: card renderiza corretamente com os
valores reais dos dados sintéticos, zero erro de console. 248/248 testes passando.

### Coleta Databricks — Dashboard: ponto de atenção nos rankings de Workspace/Usuário (2026-08-28)

Pedido do usuário: cruzar as anomalias já detectadas (aba "Orçamentos e Anomalias") com
os rankings "Por Workspace"/"Por Usuário" da aba Dashboard, sinalizando direto onde o
usuário já está olhando em vez de exigir trocar de aba pra descobrir que algo está
anômalo.

**Sem endpoint novo** — `DatabricksDashboardView` (componente-pai) ganhou uma
`useQuery({queryKey:['databricks-anomalias'], queryFn: getDatabricksAnomalias})` própria,
com a MESMA `queryKey` já usada por `AnomaliasCard` (aba Orçamentos) — React Query
compartilha o cache entre as duas, sem round-trip extra quando as duas abas já foram
visitadas na mesma sessão.

**Cruzamento simples via `Set`**: `workspacesComAnomalia` (filtra `custo_diario` por
`escopo_tipo==='workspace'`, coleta os `escopo_valor`) e `usuariosComAnomalia` (coleta
`usuarios[].usuario` direto — já vem no mesmo formato de label usado por `por_usuario`,
incluindo `'Não identificado'`, sem precisar do sentinel `__vazio__` usado só pro
drill-down). Anomalia de escopo `'global'` não marca nenhum workspace específico
(não é sobre um workspace só) — deliberadamente não usada aqui.

**`RankingCard` ganhou `atencao?: boolean` por item + prop `onVerAnomalia`**: quando
`true`, renderiza um ⚠️ antes do label, com `title` explicando e `onClick` com
`e.stopPropagation()` (pra não disparar o `onToggle` de drill-down do item ao clicar
só no ícone) chamando `onVerAnomalia`, que troca pra aba "Orçamentos e Anomalias"
(`setDbxTab('orcamentos')`) — o detalhe completo (Z-score, % de crescimento) já mora lá,
não duplicado no ranking.

**Verificado via Playwright contra o servidor real** (dados sintéticos desta sessão): 3
dos 4 workspaces (`ws-dev-brsouth`, `ws-prod-brsouth`, `ws-analytics-sp`) aparecem com ⚠️,
batendo com as 3 anomalias de escopo workspace já confirmadas antes nesta sessão (a 4ª,
de escopo global, corretamente não marca nenhum item); clicar no ícone navega pra
"Orçamentos e Anomalias" corretamente. Zero erro de console. 1 teste novo em
`DatabricksDashboardView.test.tsx` (ícone aparece só nos itens com anomalia, ausente nos
sem, clique navega de aba).

### Coleta Databricks — Dashboard: Tendência Mensal empilhada em Pago/Free + versão "executiva" (2026-08-28)

Pedido do usuário: o gráfico de Tendência Mensal (barras + forecast) era monocromático
(roxo sólido pra real, hachurado pra previsão) — não dava pra ver de onde vinha o
consumo de cada mês, e só a última barra real + as de previsão mostravam o valor
numérico (rótulos seletivos, regra do skill `dataviz`) — pedido explícito foi "mostrar
o consumo das cores também" e deixar o gráfico "mais executivo" (todo número visível
de cara, sem precisar de hover).

**`GET /api/databricks-coleta/resumo` ganhou `free`/`pago` por mês** — a query `rMes`
(que já devolvia só `mes`/`custo`) ganhou 2 colunas com a MESMA heurística já usada por
`free_vs_pago`/`dbus_free_vs_pago` (`sku_name ILIKE '%FREE%' OU custo_estimado=0`), só
agrupada por mês em vez do período inteiro — nenhuma query nova, zero round-trip
adicional ao Postgres. `DatabricksResumoMes` (tipo TS) ganhou os 2 campos; `normalizeResumo`
(`api/databricksColeta.ts`) normaliza os dois pra `number` (mesmo motivo de sempre —
`NUMERIC` do Postgres volta como string via `pg`).

**Barras reais agora empilhadas (Pago roxo embaixo, Free verde em cima)** — as barras de
**previsão continuam um bloco único hachurado** representando o total projetado: não há
como prever a proporção Pago/Free com confiança a partir de só 2 números por mês
(diferente do total, que já tem 6+ meses de histórico pra regressão linear). `MonthlyBarChart`
recebe `DatabricksResumoMes[]` (antes só `{mes,custo}`) e monta um `Map` mes→{free,pago}
pra casar com a série já estendida pelo forecast (`forecastLinear` preserva campos extras
via spread, mas o tipo de retorno `MesCustoPrevisto` não os declara — o `Map` evita
depender disso silenciosamente). Gap de 2px entre os dois segmentos empilhados quando
ambos são >0 (regra do skill `dataviz`: "2px surface gap between fills — stacked segments
e barras adjacentes"); mês 100% pago não desenha o retângulo verde (evita uma tira de 0px
sem sentido); mês com qualquer parcela free ganha o breakdown Pago/Free no tooltip nativo
(`<title>`), pago-only mantém só o total.

**Versão "executiva"**: rótulo de valor total agora aparece em TODA barra com custo > 0
(antes: só previsão + última barra real) — o pedido do usuário aqui é o oposto direto da
regra geral do skill `dataviz` ("rótulos seletivos, nunca em todo ponto"), mas com só 6-9
barras no período padrão não há risco real de colisão de texto, e o objetivo explícito é
uma leitura tipo slide/relatório, sem precisar de hover pra ver os números. Rótulo em
negrito (`font-weight:700`) e cor `var(--text)` (não mais `var(--text-muted)`) pra maior
contraste. Legenda ganhou um 2º item "Free" (verde, só aparece se algum mês real tiver
free>0) ao lado do já existente "Pago"/"Previsão" (renomeado de "Real" pra "Pago", já que
agora representa especificamente o segmento roxo, não mais a barra inteira). Adicionada
uma linha de base (`<line>`, `var(--border)`) sob as barras — âncora visual discreta,
mesmo espírito de "recessive grid/axes" do skill.

**Verificado**: `tsc -b` limpo, 2 fixtures de teste (`DatabricksDashboardView.test.tsx`,
`DatabricksExpurgoModal.test.tsx`) atualizadas com `free`/`pago` por mês (campos agora
obrigatórios no tipo) — 17 testes Databricks passando (nenhuma asserção de texto quebrou
com os novos rótulos sempre visíveis). Visual confirmado com uma reprodução HTML estática
+ Playwright (claro e escuro, dados variados incluindo meses 100% pago e meses com parcela
free) — não contra o servidor real via login, já que é puramente uma mudança de
apresentação sobre um payload já coberto pelos testes automatizados; `pm2 restart` aplicado
pra carregar a mudança de `server.js` (processo gerenciado por PM2, sem watch/reload
automático).

### Coleta Databricks — Dashboard: drill-down clicando num mês da Tendência Mensal (2026-08-28)

Pedido do usuário, logo após a versão empilhada acima: poder clicar num mês do gráfico e
ver os cards abaixo (Workspace/SKU/Usuário/Job/Cluster/Warehouse, e o KPI de total) se
detalharem pra aquele mês — clicar de novo no mesmo mês volta a mostrar o total do
período. Mesmo mecanismo de drill-down que Workspace/SKU/Usuário/Job/Cluster/Warehouse já
tinham (ver "Dashboard: tendência em barras + forecast, e drill-down" acima) — mês vira
só mais uma dimensão de filtro, reaproveitando a mesma arquitetura ponta a ponta.

**`GET /api/databricks-coleta/resumo` ganhou o parâmetro `mes` ('YYYY-MM')** — mas,
diferente dos outros 6 filtros (que já se aplicavam a TODAS as 9 queries, incluindo a
própria `rMes`), este precisa ser excluído especificamente da query `rMes`: aplicar o
filtro de mês nela mesma faria a série do gráfico colapsar pra 1 barra só assim que o
usuário selecionasse um mês, destruindo o propósito do gráfico (comparar a tendência ao
longo do tempo) exatamente no momento em que o usuário está interagindo com ele. Resolvido
com duas variantes de `where`/`params`: a base (`where`/`params`, sem o filtro de mês) usada
só por `rMes`, e `whereMes`/`paramsMes` (base + `AND to_char(usage_date,'YYYY-MM') = $N`
quando `mes` está presente) usada pelas outras 8 queries (`rTotal`, `rWs`, `rSku`, `rUser`,
`rFree`, `rJob`, `rCluster`, `rWarehouse`) — o gráfico sempre mostra todos os meses do
período; tudo mais reflete o mês selecionado quando há um.

**Frontend**: `DatabricksResumoFiltros` (`api/databricksColeta.ts`) ganhou `mes?: string`,
incluído no `queryKey` do `resumoQuery` e no mecanismo genérico de chips "Detalhando por:"
já existente (`FILTRO_LABELS`/`labelFiltroValor` — só precisou de 2 linhas novas, o resto
do componente de chip/toggle/"Limpar filtros" já era genérico o suficiente pra cobrir mais
uma chave sem mudança). `labelFiltroValor` reaproveita `mesLabel()` (já usado pelos eixos
do gráfico) pra mostrar "ago/26" no chip em vez do `'2026-08'` cru.

**`MonthlyBarChart` ganhou `mesSelecionado`/`onSelectMes`** — cada barra REAL (não as de
previsão — não há consumo real ainda pra detalhar um mês futuro) vira clicável
(`cursor:pointer`, tooltip explicando a ação). Feedback visual da seleção: um contorno
(`stroke`) ao redor da barra inteira (pago+free empilhados) do mês ativo, e as DEMAIS
barras (reais e de previsão) caem pra `opacity:0.35` — foco na barra selecionada sem
esconder o resto da série, a mesma técnica já usada pelo destaque de item ativo em
`RankingCard`. Toggle client-side simples: clicar a barra chama `toggleFiltro('mes', d.mes)`
(a mesma função já usada pelos outros 6 filtros — clicar o mesmo valor de novo limpa o
campo), sem estado novo dedicado a "selecionado" — `mesSelecionado` é só `filtros.mes`.

**Verificado**: `tsc -b` limpo; teste novo em `DatabricksDashboardView.test.tsx` (clicar
"ago/26" chama `getDatabricksResumo(..., {mes:'2026-08'})`, mostra o chip "Mês: ago/26 ✕",
clicar de novo remove o chip) passou de primeira; os 2 testes de drill-down por Workspace/
Job pré-existentes continuam passando sem alteração (a query `where` deles ganhou uma
variante nova mas o comportamento com `mes` ausente é idêntico ao anterior). Visual
confirmado com uma reprodução HTML estática interativa (clique real via `dispatchEvent`,
Playwright) — 3 screenshots (padrão → mês selecionado com contorno+dimming → clique de
novo volta ao padrão) confirmam o ciclo completo. `pm2 restart` aplicado pra carregar a
mudança de `server.js`.

**Bug real reportado pelo usuário logo em seguida — clicar num mês (ou em qualquer outro
filtro de drill-down) fazia "a página voltar pro início"**: `resumoQuery`
(`DatabricksDashboardView.tsx`) não tinha `placeholderData` — no TanStack Query v5, mudar a
`queryKey` (que já inclui todos os filtros de drill-down, incluindo `mes`) registra uma
entrada NOVA no cache; sem `placeholderData`, `data` vira `undefined` enquanto a busca
nova corre. Como `resumo` (`= resumoQuery.data`) controla a renderização do bloco inteiro
de KPIs/Tendência Mensal/rankings (`{resumo && resumo.tem_dados && (...)}`), esse bloco
inteiro desaparecia por um instante a cada clique de drill-down — o documento encolhia
drasticamente, e o browser é forçado a recuar o scroll pra caber na página mais curta
(o navegador não consegue manter uma posição de scroll além do fim do documento) — o
efeito é indistinguível de "a página voltar pro topo", mesmo sem nenhum código chamando
`scrollTo`. Provavelmente já afetava TODOS os filtros de drill-down (workspace/sku/
usuário/job/cluster/warehouse) desde que foram introduzidos, não só o de mês — só ficou
mais evidente/incômodo agora com mais um jeito de disparar o filtro. Corrigido com
`placeholderData: keepPreviousData` (import de `@tanstack/react-query`) — mantém os dados
antigos visíveis (só `resumoQuery.isFetching` fica `true`, já exibido como "Carregando...")
até a resposta nova chegar, sem colapso de altura, sem pulo de scroll.

**Verificado**: `tsc -b` limpo; teste novo em `DatabricksDashboardView.test.tsx` reproduz o
bug de propósito (mocka a 2ª chamada de `getDatabricksResumo` com uma Promise que só
resolve manualmente — confirma que `R$ 15.000,00`/`Custo Total no Período` continuam no
DOM enquanto a promise está pendente, depois resolve e confirma o valor novo aparece) —
os 18 testes Databricks pré-existentes continuam passando sem alteração. `pm2 restart`
aplicado pra carregar o build novo do frontend.

**Segundo bug real reportado pelo usuário logo em seguida — os rankings (Por Workspace/
SKU/Usuário/Job/Cluster/Warehouse) só mostravam o valor em R$ dos 3 primeiros itens**:
`RankingCard` tinha `{i < 3 && <span>{fmtBRL(item.custo)}</span>}` — resquício da decisão
original de "rótulos seletivos" (skill `dataviz`, pensada pra evitar poluição visual em
gráficos densos), mas numa lista de ranking (não um scatter/linha com muitos pontos
próximos) isso só escondia informação real sem ganho nenhum de legibilidade — item 4 em
diante mostrava só a barra, sem o número, obrigando a inferir o valor pela régua visual.
Corrigido removendo a condição — todo item agora mostra `fmtBRL(item.custo)`, consistente
com a versão "executiva" já aplicada à Tendência Mensal (rótulo sempre visível, sem
precisar de hover/inferência). Confirmado com uma reprodução HTML estática (Playwright,
usando os nomes de SKU mais longos do próprio ranking, ex: `STANDARD_ALL_PURPOSE_COMPUTE`)
que o valor à direita não quebra linha nem colide com o label truncado à esquerda mesmo no
pior caso de nome longo. Teste novo em `DatabricksDashboardView.test.tsx` (ranking de 4
itens, confirma que o 4º mostra `R$ 1.000,00` — antes da correção ficava invisível).

### Coleta Databricks — Execuções de Job: tempo de execução + custo (2026-08-29)

Pedido do usuário: pesquisar a documentação oficial do Databricks sobre coletar quanto
tempo um Job rodou e quanto custou, e implementar. `databricks_consumo` (Fase 2) já dava
custo por job (via `usage_metadata->>'job_id'`, ranking "Por Job") mas nunca DURAÇÃO —
`system.billing.usage` não tem essa informação, só custo. Pesquisado via WebSearch/WebFetch
contra `docs.databricks.com` (mesmo padrão já usado pra Quotas Genie): a duração/status de
cada execução vive em **outro schema de System Tables**, `system.lakeflow` — separado de
`system.billing`, com 6 tabelas (`jobs`, `job_tasks`, `job_run_timeline`,
`job_task_run_timeline`, `pipelines`, `pipeline_update_timeline`), das quais só 2 eram
necessárias aqui.

**Tabelas usadas**:
- `system.lakeflow.job_run_timeline` (imutável) — `job_id`, `run_id`, `period_start_time`/
  `period_end_time`, `result_state` (SUCCEEDED/FAILED/SKIPPED/CANCELLED/TIMED_OUT/ERROR/
  BLOCKED), `termination_code`, `run_type`, `trigger_type`, `run_name`. **Runs >1h emitem
  múltiplas linhas** ("slices") com o MESMO `run_id`, cada uma um pedaço do intervalo total
  (a partir de 2026-01-19 alinhadas a fronteiras de hora cheia) — a duração real é a SOMA
  das slices, não uma linha só; `result_state`/`termination_code` só vêm populados na
  ÚLTIMA slice (as demais ficam `NULL`).
- `system.lakeflow.jobs` (SCD2) — só usada pra pegar `name` (job_run_timeline NÃO traz o
  nome do job, só `job_id`); linha mais recente por `job_id` via `ROW_NUMBER() OVER
  (PARTITION BY job_id ORDER BY change_time DESC)`, filtrando `delete_time IS NULL`.

**Custo por run — zero mudança na coleta de billing já existente**: a documentação
confirmou que `usage_metadata.job_run_id` (não só `job_id`) já existe em
`system.billing.usage` — e `_executarColetaDatabricks` já captura `usage_metadata`
INTEIRO via `to_json(u.usage_metadata)` desde a Fase 2 (decisão de não apostar em nomes de
campo específicos — ver "Granularidade por recurso" acima). Ou seja, `job_run_id` **já
estava sendo coletado e gravado** em `databricks_consumo.usage_metadata`, só nunca lido.
Custo por run é computado em LEITURA (`GET /job-runs`), via subquery correlacionada
`usage_metadata->>'job_run_id' = run_id`, coberta por um índice funcional parcial
(`idx_databricks_consumo_job_run_id`, `WHERE ... IS NOT NULL` — pequeno mesmo em tabelas
grandes, já que a doc confirma que a maioria das linhas de billing nunca tem esse campo).
**`custo_estimado` retorna `null`, nunca `0`, quando não há linha de billing correlacionável**
— a documentação é explícita que `usage_metadata.job_run_id` só é populado pra jobs em
job compute/serverless compute, nunca em cluster all-purpose; `0` sugeriria "rodou de
graça", `null` deixa claro que o dado simplesmente não existe pra aquele run.

**Nova tabela `databricks_job_runs`** — uma linha por run (não por slice): a coleta agrega
ANTES de gravar (`SUM` da duração das slices, `MIN`/`MAX` pra início/fim reais, `MAX` em
`result_state`/`termination_code` ignora `NULL` e sobra só o valor real de qualquer slice
que o tenha). `UNIQUE (workspace_id, job_id, run_id)` — upsert idempotente, run nunca
duplica mesmo re-coletando o mesmo período.

**Coleta best-effort, nunca derruba a coleta principal de billing**: `_coletarJobRunsDatabricks`
roda DEPOIS de `_processarLinhasDatabricks` dentro de `_executarColetaDatabricks`, dentro
de um try/catch próprio — `system.lakeflow` é habilitado independentemente de
`system.billing` por um account admin (Catalog Explorer → System Tables tem uma entrada
própria pra cada schema), então uma conta pode ter billing OK e lakeflow indisponível, ou
vice-versa. Uma falha aqui só anexa `" | Job Runs: indisponível (motivo)"` à mensagem do
histórico — a coleta de custo por recurso (já em produção) continua funcionando normalmente.
Não roda no fluxo de Importação Manual (CSV) — formato de import é só billing, sem
equivalente de execução de job.

**"Testar Conexão" ganhou uma segunda checagem, opcional**: `_DBX_OPTIONAL_TABLES`
(`system.lakeflow.job_run_timeline`, `system.lakeflow.jobs`) testadas do mesmo jeito que
`_DBX_REQUIRED_TABLES` (`SELECT 1 FROM tabela LIMIT 1`), mas em `tabelas_opcionais` —
`opcionais_ok=false` **não** derruba o `ok` principal da rota, já que billing/custo por
recurso não depende delas. Frontend (`ColetaView.tsx`'s `testarDbxMutation`) mostra um
segundo toast informativo só sobre a disponibilidade de "Execuções de Job", separado do
toast principal de billing — evita confundir "conexão básica quebrada" com "só falta
habilitar mais um schema pra uma feature adicional".

**Frontend**: `DatabricksJobRunsCard.tsx` — novo card "Execuções de Job — Tempo e Custo" no
Dashboard, logo após os 6 rankings, reaproveitando o mesmo `periodo` e o filtro de
drill-down `job_id` já existentes (clicar num job em "Por Job" também escopa esta lista,
sem seletor de período próprio). Tabela: Job / Run / Início / Duração / Status (badge
colorido por `result_state`) / Custo (`—` quando `null`, com tooltip explicando o motivo).
`GET /job-runs` tem range padrão de 7 dias (não os 6 meses do `/resumo`) e `LIMIT 200` —
execuções de Job são por EXECUÇÃO (podem ser centenas/dia num workspace ativo), volume bem
maior que billing diário; aviso "mostrando as 200 mais recentes" quando o limite é atingido.

**⚠️ NÃO VALIDADO contra uma conta Databricks real** (mesma ressalva de sempre nesta
feature) — schema/nomes de coluna conforme documentação oficial pesquisada em 2026-08-29;
a primeira coleta real pode expor um nome de coluna ou uma nuance de tipo (ex:
`unix_timestamp()` sobre `period_end_time`/`period_start_time`) que precise de ajuste.
Verificado o que dá pra verificar sem conta real: `node --check`, `tsc -b`, migração
(`databricks_job_runs` + 2 índices) aplicada com `pm2 restart` sem erro no log e sem
crash-loop (uptime estável, contador de restarts do PM2 parado), rota
`GET /api/databricks-coleta/job-runs` respondendo 401 sem token (prova que o Express
terminou de subir depois do `ensureAzureColetaTable()`, que teria lançado exceção e
impedido o boot se a migração tivesse falhado). Teste novo em
`DatabricksDashboardView.test.tsx` cobre o card com dados mockados (duração formatada,
badge de status, `—` para custo nulo, drill-down por job).

### Auditoria contra a documentação oficial do Databricks — 2 bugs reais encontrados e corrigidos (2026-08-29)

Pedido do usuário: revalidar TODA a integração Databricks contra a documentação oficial e
identificar lacunas pra "Controle de Custos". Reconfirmado (sem mudança necessária):
schema de `system.billing.usage`/`system.billing.list_prices` (todos os campos usados
batem — `workspace_id`, `sku_name`, `billing_origin_product`, `usage_date`, `usage_unit`,
`usage_quantity`, `identity_metadata.run_as`, `usage_metadata`, `custom_tags`), schema de
`system.lakeflow.job_run_timeline`/`jobs` (verificado na mesma sessão, ver seção acima),
endpoint OAuth M2M de conta (`https://accounts.azuredatabricks.net/oidc/accounts/{id}/v1/token`
— confirmado batendo exatamente com a documentação oficial), e a limitação de
`system.compute.*` (não cobre SQL Warehouses nem serverless — confirmado explicitamente:
"These tables only includes records for all-purpose and jobs compute. They do not contain
records for serverless compute or SQL warehouses").

**Bug real #1 — fórmula de custo usava o campo errado do preço de tabela**: a query de
billing (`_executarColetaDatabricks`) usava `p.pricing.default`. A documentação oficial
descreve esse campo como "preço de tabela base pra estimativas de longo prazo" — **não** o
campo pra calcular custo real. A própria query de exemplo oficial da Databricks pra "Total
Dollar Cost" (`docs.databricks.com/aws/en/admin/system-tables/pricing`) usa
`pricing.effective_list.default`: "resolve o preço de lista e o promocional, e contém o
preço de lista efetivo usado pra calcular o custo". Sem essa correção, qualquer SKU com
preço promocional ativo (comum — a Databricks roda promoções por SKU/região com frequência)
tinha o custo estimado sistematicamente errado, usando o preço cheio em vez do efetivo —
um erro de custo real, não cosmético, na feature cujo propósito inteiro é medir custo.
Corrigido pra `COALESCE(p.pricing.effective_list.default, p.pricing.default, 0)` (fallback
de segurança só caso `effective_list` venha nulo pra algum SKU específico) — mesma correção
aplicada em `preco_unitario` e `custo_estimado`. Join trocado de `usage_start_time` pra
`usage_end_time`, batendo exatamente com a query de exemplo oficial (só importa pra
registros que cruzam uma mudança de preço no meio do intervalo de uso, caso raro, mas sem
motivo pra divergir do padrão documentado).

**Bug real #2 — timeout de 30s tratado como falha definitiva, não como "ainda rodando"**:
`_databricksRunQuery` usava `wait_timeout: '30s'` e `_parseDatabricksResult` lançava erro
pra qualquer `status.state` diferente de `'SUCCEEDED'`. A documentação oficial da
Statement Execution API é explícita: quando o tempo de espera é atingido, o comportamento
padrão (`on_wait_timeout: 'CONTINUE'`, o default) é deixar a query **continuar rodando em
background** no lado do Databricks — o chamador precisa fazer *polling* em
`GET /api/2.0/sql/statements/{statement_id}` até um estado terminal. Sem isso, um SQL
Warehouse frio (cold start documentado como levando de dezenas de segundos a poucos
minutos pra ligar) ou uma query de billing sobre um período grande derrubava a coleta
inteira com "não concluiu" mesmo a query estando genuinamente a caminho de terminar com
sucesso — a pior falha possível numa feature de coleta agendada: intermitente, e mais
provável exatamente no primeiro uso real (warehouse mais chance de estar frio numa conexão
recém-configurada). Corrigido: `wait_timeout` no máximo permitido pela API (`'50s'`, faixa
válida documentada é `0` ou `5-50`) pra reduzir quantas vezes o polling é sequer
necessário, e polling de verdade (a cada 3s, até 5 min de espera total) quando o estado
inicial retorna `PENDING`/`RUNNING`. `_parseDatabricksResult` também ganhou uma mensagem de
erro diferenciada pra esse caso ("ainda em execução após 5 minutos" vs. um erro real de
SQL/permissão). **Efeito colateral corrigido em conjunto**: o timeout do fetch do frontend
pra "Testar Conexão" (`testarDatabricksConfig`, 40s) subiu pra 3 minutos — sem isso, o
frontend abortaria a requisição exatamente no cenário (cold start) que o polling do backend
foi corrigido pra suportar, trocando um erro do backend por um erro de timeout do
navegador, sem ganho nenhum. `coletarDatabricks` (gatilho de coleta manual) não precisou de
ajuste — a rota já responde imediatamente e roda a coleta em background (`_dbxColetaEmExecucao`),
sempre foi fire-and-forget do lado do cliente.

**Lacunas identificadas pra "Controle de Custos" — nenhuma implementada ainda, aguardando
decisão do usuário sobre prioridade** (ver `system.compute`/`system.query`/`system.serving`/
`system.ai_gateway`, todos confirmados existentes e não usados hoje):
- **Utilização de cluster / detecção de ociosidade** (`system.compute.node_timeline` —
  métricas de CPU/memória minuto a minuto pra all-purpose e jobs compute) — hoje o sistema
  mostra CUSTO por cluster, mas não se aquele cluster está super-dimensionado ou ocioso.
  Essa é a diferença entre "visibilidade de custo" (o que já temos) e "otimização de custo"
  (rightsizing) — um dos dois pilares clássicos de FinOps que ainda falta.
- **Custo/performance por query em SQL Warehouse** (`system.query.history`) — hoje só
  temos custo agregado por warehouse (`Por Warehouse`); não há visão de qual QUERY ou qual
  USUÁRIO específico consumiu mais dentro de um warehouse, nem tempo de execução de query
  (equivalente ao que "Execuções de Job" acabou de trazer pra Jobs, mas pra SQL).
- **Gasto com Model Serving / AI Gateway** (`system.serving.endpoint_usage`,
  `system.ai_gateway.external_model_spend` — literalmente "estimated USD spend for requests
  routed to external models") — Quotas Genie (já implementado) CONTROLA limites de uso do
  Genie via a Budgets API nativa, mas não existe hoje nenhuma visão de CONSUMO real de
  Model Serving/AI Gateway pra outros endpoints além do Genie — área de custo crescente em
  contas Databricks modernas (GenAI).
- **Otimização de storage** (`system.storage.predictive_optimization_operations_history`)
  — fora do escopo de custo de compute, mas relevante pra TCO geral de Databricks.

Nenhuma dessas foi implementada nesta rodada — são apresentadas como opções pro usuário
decidir prioridade, não implementadas preventivamente, dado o tamanho de cada uma
(rightsizing de cluster e custo-por-query são, cada um, do tamanho da feature de
"Execuções de Job" que acabou de ser construída).

**Verificado**: `node --check`, `tsc -b`, `pm2 restart` sem erro/crash-loop. As duas
correções (fórmula de preço, polling) não têm cobertura de teste automatizado possível
neste ambiente (dependem de uma resposta real da Statement Execution API — mockar o
comportamento de polling seria testar o mock, não a lógica real) — mesma limitação já
documentada pra toda a Coleta Databricks; primeira validação de verdade só na primeira
coleta contra uma conta Databricks real.

### Coleta Databricks — dados de teste sintéticos (2026-08-27)

A pedido do usuário, geradas ~1.260 linhas de consumo simulado em `databricks_consumo` (2026-06 a 2026-08),
cobrindo 4 workspaces, 9 SKUs (7 pagas + 2 free-tier), 4 produtos (JOBS/INTERACTIVE/SQL/MODEL_SERVING) e 6
usuários — usado pra popular e verificar visualmente o dashboard (Fase 3), o drill-down e o forecast acima.
Gerado por um script Node **temporário** (escrito no scratchpad da sessão, não commitado — pedido explícito
do usuário foi "delete o script e mande só os dados") e importado via `POST /api/databricks-coleta/import`
(Importação Manual, já existente). 5 orçamentos de teste também foram criados via API (4 por workspace + 1
global) pra exercitar `GET /alertas` com dados reais — 3 deles cruzam o threshold de 75% de propósito, pra
confirmar que o popup de alerta dispara.

**Pegadinha de encoding real, achada e corrigida durante a geração**: 2 dos 5 nomes de orçamento com acento
("Produção", "Orçamento") vieram corrompidos no banco (`Produ��o`) ao serem criados via `curl -d '{"nome":
"Produção"...}'` no Git Bash do Windows — o argumento passado à linha de comando pro binário nativo `curl.exe`
não preserva UTF-8 nesse ambiente (mojibake, não um bug do servidor). Confirmado lendo a resposta salva em
arquivo (não só o terminal, que também poderia estar exibindo errado) — os bytes gravados no Postgres
realmente estavam errados. Corrigido reenviando via `curl --data-binary @arquivo.json` (arquivo UTF-8 real,
não argv) em vez de `-d '<json inline>'` — nenhuma mudança de código foi necessária, é uma pegadinha de
ambiente/ferramenta a lembrar em qualquer teste futuro que envolva acentos via `curl` neste terminal.

Este conjunto de dados **não foi removido** ao final (diferente da rodada de testes anterior) — o usuário
pediu explicitamente pra manter os dados desta vez, só descartando o script gerador. Usar o Expurgo de Dados
(seção acima) quando quiser limpar antes de dados reais chegarem via coleta/import de produção.

### Price List module
`_syncPriceList(currency='USD')` — fetches all pages from Azure Retail Prices API, stores in `azure_price_list`.
- URL: `?api-version=2023-01-01-preview&currencyCode=USD` (sem filtro de região — retorna todos os meters)
- `arm_region_name` armazena a região real do item da API (não mais o sentinel `'global'`)
- Prioridade na MV: `brazilsouth` > outras regiões
- Pagination via `NextPageLink` until exhausted; HTTP 400 "Skip value >= total" treated as end-of-data
- ON CONFLICT usa `GREATEST(EXCLUDED.retail_price, current)` — never overwrites valid price with 0
- Skips items where `retailPrice = 0 AND unitPrice = 0` (free tier / regions without pricing)
- `TRUNCATE TABLE azure_price_list` antes de inserir — apaga **todas** as moedas (incluindo BRL de CSV anterior)
- Após COMMIT: `REFRESH MATERIALIZED VIEW CONCURRENTLY pl_best_mv` + `pl_sku_mv`

`_importPriceListFromCSV(csvPath, filename, clearBefore)` — imports CSV/TSV/ZIP/Parquet.
- `clearBefore=true` (upload manual): `TRUNCATE azure_price_list` before inserting
- `clearBefore=false` (Storage blob): UPSERT incremental
- ZIP: extrai cada entrada com streaming (evita OOM em arquivos grandes); `clearBefore` aplicado só na primeira entrada
- Suporta coluna `retail_price_brl` no CSV — armazenada na coluna homônima da tabela
- ON CONFLICT: `GREATEST` para `retail_price`, `COALESCE(EXCLUDED, current)` para `retail_price_brl`

**Price List coverage cache (`_plCobCache`):** computed in background every 5 min.
- Counts billing meter_ids that have a match in `azure_price_list` (Consumption/DevTest)
- Exposed in `GET /api/price-list/status` as `cobertura { billing_meters, com_pl, cobertura_pct }`

**Price List diagnostic:** `GET /api/price-list/diag` — compares billing vs PL meter_ids.
Returns sample billing meters, sample PL rows, and match percentage.
Button "🔍 Diagnóstico" in the Price List settings screen calls this endpoint.

**Endpoints:**
```
GET  /api/price-list/status        — sync metadata + coverage cache
POST /api/price-list/sync          — triggers sync (background)
POST /api/price-list/import        — upload CSV/ZIP/Parquet (clearBefore=true)
GET  /api/price-list/import-status — import progress
GET  /api/price-list/diag          — meter_id coverage diagnostic
POST /api/price-list/reset-cb      — reset circuit breaker
```

### Calculadora module
`calculadora.js` — IIFE `const Calculadora = (() => { ... })()`.
Exposes public API consumed by `onclick` in `index.html` and by `portal.html`. State is module-private.
Entry point: `Calculadora.init(opts?)`.

```javascript
Calculadora.init({
  apiBase:       '/api/public/calculadora', // troca base de API (portal público)
  publico:       true,                      // desativa import/diagnóstico (features que requerem auth)
  defaultConfig: { taxa_imposto, taxa_cond, horario_livre } // config vinda do servidor
})
```

**State variables relevantes:**
```javascript
_apiBase     = '/api/calculadora'  // sobrescrito pelo portal público
_modoPublico = false               // desativa UI de import quando true
_horarioLivre = { ativo, inicio, fim, dias }  // janela de horas sem cobrança
_dbTaxaMap   = new Map()   // rg_lower → { taxa, valida, totalBrl, hDriver, totalHoras, recursos }
_managedRgMap = new Map()  // rg_upper → { managed_type:'databricks'|'aks', managed_label }
_filtroTipos = new Set()   // tipos selecionados no chip-bar (vazio = todos)
_rgTotalMap  = new Map()   // rg_upper → total billing do período
// v2.1 — pico de billing
_usaPico        = false    // true quando custo_hora_pico > 0 e tipo ≠ reserva/mes e !_dbValidaOv
_usaPicoCluster = false    // true quando custo_hora_pico_cluster > 0 e _dbValidaOv (Databricks)
// perf — lazy pico + cache overlay
_picoCarregado     = false  // flag: pico já carregado para a busca atual
_ultimaUrlRecursos = ''     // URL da última busca — reutilizada por _carregarPico com &pico=1
_ovRMapSrc         = null   // referência de _recursos no momento do último _ovRMap build (cache)
_ovRgSelTotalMap   = null   // Map rg_upper → total BRL dos selecionados (pré-computado em _ovRenderRecursos)
```

**Filter flow:**
subscription dropdown → confirm OK → RG dropdown → confirm OK → date range → Buscar
→ `buscarRecursos()` → `_carregarRecursos()` → `GET /api/calculadora/recursos`

**Tipo de custo (`tipo_custo`) — classificação SQL:**
```
reserva  → charge_type IN ('Purchase','RoundTrustBill') AND pricing_model = 'Reservation'
hora     → unit_of_measure ILIKE '%hour%' OR '%hora%'
dia      → unit_of_measure ILIKE '%day%'
mes      → unit_of_measure ILIKE '%month%' (excl. GB/TiB — ex: serviços faturados por mês)
periodo  → todos os demais (disco, storage, bandwidth, etc.)
```

**Chip-bar de tipos** (`#ctipos-bar`): **sempre visível** quando há ≥ 1 tipo de recurso (`tipos.length < 1` para ocultar — v2.1). `_tipoRecurso(r)` classifica em: `VMs`, `Discos`, `Storage`, `Databricks`, `AKS`, `SQL`, `App Service`, `Rede`, `Rede/CDN`, `Load Balancer`, `Key Vault`, `Monitoramento`, `Reservas`, `Outros`. `_filtroTipos` (Set) controla quais tipos estão ativos. Chip `Databricks` agrupa **ambos os streams**: VMs de infra em `databricks-rg-*` (`consumed_service = Microsoft.Compute`) E linhas de software DBU (`consumed_service = Microsoft.Databricks`) — a detecção é `svc.includes('databricks') || cat.includes('databricks') || rg.startsWith('databricks-rg-')`.

**Grupos de recursos — lazy rendering + chunked interleaved:**
- Grupos colapsados por padrão (`_expandidos[baseId] === true` para expandido; default = colapsado)
- `_toggleGrupo(gIdx)` insere/remove filhas via DOM sem reconstruir a tabela inteira
- `_gBases[]` mapeia índice numérico → baseId (reconstruído a cada `_renderRecursos`)
- `_htmlFilhaRow(r, gIdx, ...)` — função compartilhada por render inicial e lazy expand
- `_renderRecursos` usa **interleaved build+insert**: `tbody.innerHTML=''` imediato → `nextChunk()` constrói e insere 200 grupos por `requestAnimationFrame` → primeiras linhas visíveis em ~32ms sem bloquear o browser
- `selecionarTodos`/`deselecionarTodos` atualiza **`.cck-grupo`** (headers multi-meter) **e `.cck`** (single-meter) — filhos de grupos colapsados não estão no DOM mas `_htmlFilhaRow` lê `_selecionados` ao expandir

**RG dropdown — auto-seleção de filhos gerenciados:**
- `_toggleOpcao('crg', value, checked)` propaga seleção para todos os RGs filhos do pai selecionado
- Detecção: `_dds.crg.data` items com `parent_rg.toUpperCase() === value.toUpperCase()`
- Ao marcar `RG-WORKSPACE` → `DATABRICKS-RG-*` e `MC_*` filhos marcados automaticamente
- Ao desmarcar pai → filhos também desmarcados
- Funciona em ambos os portais (autenticado e público)

**Bug real corrigido (2026-08-24) — regressão da migração React, reportada pelo usuário com print de
produção**: `sortRgsComFilhos()` (`frontend/src/api/calculadora.ts`, usada por `useCalculadora()` — logo
compartilhada pela Calculadora autenticada e pelo `PublicCalculadoraView.tsx`) casava `parent_rg` contra
`resource_group_name` com um `Map` chaveado pelo texto **exato**, sem normalizar maiúsculas/minúsculas — ao
contrário do legado `calculadora.js`, que já fazia `parent_rg.toUpperCase() === value.toUpperCase()` (ver
bullet acima). O servidor às vezes resolve `parent_rg` em maiúsculo (`_resolveParentRgs`, server.js) enquanto
o RG pai real na lista está em minúsculo (nomes de RG do Azure são case-insensitive, a grafia varia conforme
como foi criado) — o `Map` nunca batia, o pai (que realmente estava na lista de RGs) nunca era encontrado,
e o filho virava "raiz" incorretamente. Efeito visto pelo usuário: múltiplos workspaces Databricks distintos
apareciam soltos no dropdown, cada um com "↳" mas sem nenhum pai visível — como se fossem filhos uns dos
outros (`CalculadoraView.tsx`/`PublicCalculadoraView.tsx` setam `parentValue: r.parent_rg` sem checar se esse
pai existe nas opções, então o `CmsMultiSelect.tsx` desenhava a indentação mesmo órfã). Corrigido casando por
`UPPERCASE`; itens cujo pai realmente não está na lista (ex: filtro `resource_groups[]` do Portal Público
liberou só o filho) agora têm `parent_rg` normalizado pra `null`, virando raiz de verdade em vez de "filho
fantasma". Verificado ao vivo contra dados reais da subscription "Development" via Playwright.

**RG gerenciados — `_detectManagedRg(name)` (server.js):**
- `DATABRICKS-RG-*` → `managed_type: 'databricks'`, `managed_label: workspace` (strip último segmento aleatório)
- `MANAGED-RG-ADBX-*` → `managed_type: 'databricks'`, `managed_label: workspace` (strip último segmento)
- `MANAGED-RG-*` (genérico) → `managed_type: 'databricks'`, `managed_label: sufixo completo` — cobre `MANAGED-RG-DBW-*`, `MANAGED-RG-ADB-*` e quaisquer outros prefixos customizados
- `MC_*` → `managed_type: 'aks'`, `managed_label: cluster`, `managed_region`
- Retornado nos endpoints de resource-groups; armazenado em `_managedRgMap` no cliente

**`_resolveParentRgs` — cascata de 6 métodos para encontrar o RG pai:**
1. **Cache** (`_dbWsCache`) — workspace do billing (`resource_id /workspaces/X`) → pai já conhecido; cobre `databricks-rg-{ws}`, `managed-rg-adbx-{ws}`, `managed-rg-{ws}`
2. **Exact** — `managed_label` == nome exato de um RG não-gerenciado
3. **Suffix** — RG normal TERMINA com `-{label}` (ex: `MANAGED-RG-DBW-X` → label=`DBW-X` → pai `RG-DBW-X`); mais confiável que substring
4. **Prefix** — `label-` é prefixo de um RG normal
5. **Substring** — `label` aparece em qualquer posição de um RG normal (menor nome vence)
6. **Substring sem prefixo `DBW-`** — **bug real corrigido (2026-08-24)**, achado pelo usuário com print de
   3 RGs Databricks aparecendo soltos no dropdown (`DATABRICKS-RG-DBW-DTFN-DEV`,
   `DATABRICKS-RG-DBW-NFCOM-DEV-*`, `databricks-rg-dbw-convenio86-dev-*`). Diferente do caso do Método 3
   (onde pai E filho repetem `DBW-` — `RG-DBW-X`/`MANAGED-RG-DBW-X`), nesses 3 casos o RG gerenciado tem
   `DBW-` no nome (`managed_label` = `DBW-DTFN`) mas o RG pai real (`RG-DTFN-BRSOUTH-DEV`) **não repete**
   `DBW-` em nenhuma posição — nenhum dos Métodos 2-5 casa a string completa `DBW-DTFN` contra
   `RG-DTFN-BRSOUTH-DEV`, mesmo com o pai certo presente na lista. Método 6 remove um `DBW-` inicial do
   label e tenta de novo por substring (mesmo critério "menor RG vence"). Validado contra as 2 subscriptions
   reais disponíveis (Development + Test): 10 RGs `DBW-*` no total, todos resolvem, 0 ambíguos (nenhum token
   restante bate em mais de 1 RG normal candidato).
- Após resolução bem-sucedida: upsert em `azure_ws_cache` → requests subsequentes usam Método 1 (cache, sem heurística)
- `_refreshAzureCache` usa **upsert** (não DELETE+INSERT) em `azure_ws_cache` — preserva entradas `MANAGED-RG-*` entre refreshes
- `_dbWsCache` reconstruído por merge (não substituição) — entradas `MANAGED-RG-*` sobrevivem ao refresh do cache de billing

**Custo/hora billing — 4 níveis de prioridade (SQL):**
```
1. reserva  → total_billing ÷ (8.760h ou 26.280h conforme term 1/3 anos)
2. hora     → total_billing ÷ (SUM(qty) × fator_UoM)
3. dia      → total_billing ÷ (SUM(qty) × 24h)
4. fallback → total_billing ÷ (dias_ativos × 24h)
```

**Custo médio para período (disco, storage, rede):**
```
custo_mes_billing = SUM(total_billing) ÷ dias_ativos × 30
taxa_hora         = custo_mes_billing ÷ 720      ← rateio proporcional ao uso
estimado          = taxa_hora × horas_slider
```
Usado para **chargeback de projeto**: aloca custo proporcional às horas selecionadas.

**RN-006 — Cost ÷ Qty = taxa por unidade nativa (`custo_uom_billing`):**
```sql
custo_uom_billing = ROUND(SUM(cost_in_billing_currency) / NULLIF(SUM(quantity), 0), 8)
```
- Dá o preço real por unidade de medida nativa: R$/GB, R$/DBU, R$/10K tx, etc.
- Valor infalível para auditar a fatura — independente de desconto, reserva ou período selecionado
- Exibição na **tabela billing** (`_custoHora`):
  - `hora`/`dia`: não exibido diretamente (custo/h já é o rate nativo)
  - `periodo`/`mes` (storage, bandwidth): linha laranja secundária `R$/GB`, `R$/10K`, etc.
  - `periodo` com UoM contendo `DBU`: exibido como **valor principal** em azul `⚡ /DBU cobrado`
- Exibição nos **cards de estimativa**: linha secundária laranja em col1 para `periodo`/`mes` sem PL match

**RN-007 — Amortizado para RI/SP (`usa_amortizado` + `taxa_hora_rate`):**
```sql
usa_amortizado = (SUM(cost_in_billing_currency) = 0 AND SUM(effective_price × qty) > 0)
taxa_hora_rate = SUM(effective_price × qty × exchange_rate_pricing_to_billing)
                 / NULLIF(SUM(qty) × fator_UoM, 0)
```
- VMs cobertas por Reserva ou Savings Plan têm `cost_in_billing_currency = 0` (custo já pago na compra da reserva)
- `taxa_hora_rate` = custo amortizado real via `effective_price` — o Azure distribui o valor da reserva por hora
- Fallback em **todos** os pontos de UI: quando `custo_hora_billing = 0` e `usa_amortizado = true`, usa `taxa_hora_rate`
- Badge `⚡ amort./h` na tabela billing · `⚡ Amort./h` no col1 dos cards de estimativa
- `_hadCustoRecurso` (Horas Adicionais) também usa o fallback amortizado

**Databricks — dois streams de billing independentes:**
```
Stream 1 — Infraestrutura (VMs do cluster):
  resource_group = databricks-rg-{workspace}   ← managed RG criado automaticamente
  consumed_service = Microsoft.Compute
  meter_category   = Virtual Machines
  unit_of_measure  = "1 Hour"
  → custo/h via RN-DB-001 (soma_h_driver) · chip-bar: Databricks

Stream 2 — Software (DBUs — Databricks Units):
  resource_group = workspace RG (user-defined)
  consumed_service = Microsoft.Databricks
  meter_category   = Azure Databricks
  unit_of_measure  = "1 DBU" (tipo=periodo) | "DBU-Hour" (tipo=hora)
  → custo/DBU via RN-006 (custo_uom_billing) · chip-bar: Databricks
```
Os dois streams estão em RGs **sem chave de join direta** no billing export. `taxa_cluster` (RN-DB-001) cobre apenas infra (Stream 1). Custo total real/h = `taxa_cluster + (total_DBU_cost / soma_h_driver)` — requer adição manual ou cross-RG join por workspace name (não implementado por fragilidade).

⚠️ `estimado_DBU = custo_mes_billing / 720 × horas` usa hora de **calendário** (assume 24h/dia). Para all-purpose clusters (24/7) = exato; para job clusters subestima o custo/h real (divide por mais horas que o cluster realmente rodou).

**RN-DB-001 — Databricks cluster rate (workspaces `databricks-rg-*` e `managed-rg-*`):**

Clusters Databricks são compostos por driver + N workers que rodam em paralelo. O custo por hora de ambiente ativo é a soma de todos os VMs simultâneos, não de um VM individual.

```
soma_h_driver = SUM(MAX(horas_recurso_dia) por dia)   ← abordagem diária (SQL)
                fallback: MAX(horas_reais) global       ← se soma_h_driver não disponível
taxa_cluster  = C_total_rg / soma_h_driver
                ← custo médio por hora de cluster ativo (inclui todos os workers)
estimado_vm_i = (billing_i / soma_h_driver) × horas_slider
                ← participação proporcional de cada VM no custo do cluster
```

**Por que abordagem diária é mais precisa:**
- Para job-clusters (VMs novas a cada sessão), `MAX(horas_reais)` pega só a sessão mais longa do período.
- `soma_h_driver = SUM(MAX_diário)` soma o uptime real de cada dia, capturando múltiplas sessões.
- Para all-purpose clusters (VMs contínuas), as duas abordagens são equivalentes.

Threshold de validade: `H_driver ≥ 24h AND ids_distintos ≥ 2` — garante que é um workspace real com múltiplos VMs.

**Bug real corrigido — RN-DB-001 nunca disparava para workspaces no padrão genérico `MANAGED-RG-*`**
(ex: `MANAGED-RG-DBW-*`, que a Vivo usa em produção): `_detectManagedRg()` já reconhecia 3 padrões de RG
Databricks (`DATABRICKS-RG-*`, `MANAGED-RG-ADBX-*`, `MANAGED-RG-*` genérico — usado pro badge/agrupamento na
UI), mas o cálculo financeiro em si só checava os 2 primeiros, em 4 lugares: as CTEs `db_daily` (soma_h_driver)
e `pico_databricks` em `server.js` (`/api/calculadora/recursos`), e as funções espelho no cliente
`computeDbTaxas()`/`dbInfoParaRecurso()` (`frontend/src/lib/calcEstimado.ts`) — essa última ainda mais restrita
que o servidor (só `databricks-rg-`, nem o `-adbx-` já reconhecido). Efeito: um workspace `MANAGED-RG-DBW-*`
aparecia com o badge/rótulo "Databricks" corretos na interface, mas o custo/h caía no fallback de billing médio
por VM em vez da taxa de cluster — exatamente o erro que a RN-DB-001 existe pra evitar (dividir custo total por
horas somadas em vez de horas simultâneas subestima a taxa real de um cluster com workers em paralelo).
Confirmado que **não é regressão da migração React** — a mesma restrição de 2 padrões já existia no
`_dbComputeTaxas()`/`_dbInfoParaRecurso()` do `calculadora.js` legado (aliás, o legado era ainda mais estreito
que o server.js: nem o `-adbx-` reconhecia). Corrigido nos 4 lugares: `MANAGED-RG-ADBX-%` é subconjunto de
`MANAGED-RG-%`, então o SQL simplificou pra só 2 condições (`DATABRICKS-RG-%` OR `MANAGED-RG-%`); no cliente,
novo helper `isDatabricksRg()` compartilhado pelas duas funções. `frontend/src/lib/tipoRecurso.ts` (chip-bar de
tipos) tinha a mesma restrição de 2 padrões — herdada fielmente do `_tipoRecurso()` legado (mesma linha,
`calculadora.js:1385`), então também nunca foi introduzida pela migração, mas foi corrigida a pedido explícito
do usuário nesta mesma sessão (diferente do bug latente do `meter_category` documentado acima, que continua
deliberadamente preservado — este aqui o usuário pediu pra corrigir agora).

Por que não usar `SUM(horas_reais)` como denominador (abordagem "blended"):
- Workers rodam **em paralelo**, não em sequência.
- `C_total / SUM_horas` divide como se fossem sequenciais → subestima muito a taxa real.
- Exemplo: 4 workers × 100h cada = 400h somadas, mas o cluster ficou ativo apenas 100h → taxa blended é ¼ do real.

Campos armazenados em `_dbTaxaMap` por RG:
```javascript
{ taxa, valida, totalBrl, hDriver, totalHoras, recursos }
// taxa       = C_total / soma_h_driver  (taxa do workspace — abordagem diária)
// hDriver    = soma_h_driver arredondado (ou MAX global como fallback)
// totalHoras = SUM(horas_reais)          (soma acumulada — só para log)
// recursos   = nº de resource_ids distintos
```

**Pico cluster (v2.1):** `pico_databricks` CTE retorna `custo_hora_pico_cluster` — taxa do pior dia do cluster inteiro. Quando disponível (`_usaPicoCluster = true`), substitui `taxaEfOv` no estimado. VMs Databricks **não** usam `pico_periodo` (pico por VM individual seria semanticamente incorreto para cluster paralelo). `_usaPico` exclui Databricks via `&& !_dbValidaOv`.

Endpoint de diagnóstico: `GET /api/calculadora/diag-databricks?data_inicio=&data_fim=` — compara abordagem atual vs diária por RG, retorna `delta_pct` para avaliar impacto.

UI — cards de estimativa:
- col1 mostra `⚡ Cluster/h` com tooltip `billing_vm ÷ H_driver` + `taxa_cluster` do workspace
- Badge `⚡ Databricks` (azul) na chip-strip de cada VM do cluster

UI — tabela de billing (`_custoHora`):
- VMs em `databricks-rg-*` (tipo=hora): mostra `/h cobrado` + linha `⚡ cluster: R$/h` (contribuição proporcional ao uptime)
- Linhas DBU (UoM contém "DBU", tipo=periodo): mostra `⚡ /DBU cobrado` como valor principal via `custo_uom_billing`
- Linhas DBU-Hour (UoM "DBU-Hour", tipo=hora): mostra `⚡ /DBU·h` como sublabel em vez de `/h cobrado`
- Badge `⚡ DBU` (azul) nos cards de estimativa para linhas de software Databricks (fora de `databricks-rg-*`)
- Col1 dos cards para linhas DBU: `⚡ DBU/mês*` com tooltip informando taxa unitária `R$/DBU`

**Price List integration:** **toda a UI foi removida na v2.1** — sem ícones `📋`, sem badges `▼%`, sem col1
verde. `fonte_estimado` é sempre `'billing'`. Estimado sempre cinza (billing) ou azul (Databricks) ou laranja
(pico). O backend acompanhou essa remoção numa limpeza posterior: as materialized views `pl_best_mv`/`pl_sku_mv`
que faziam esse JOIN foram removidas de vez (ver "Materialized views" acima) — não existe mais nenhum caminho
de código que tente juntar `azure_costs` com Price List pra estimativa. **Achado tardio (2026-08-24)**: o hero
do Portal Público (`PortalApp.tsx`) ainda tinha um chip `📋 Price List Azure` sobrevivendo à remoção da v2.1 —
prometia uma capacidade que o motor não tem mais. Trocado por `📊 Pico de custo do período`, refletindo a
feature real que substituiu Price List como indicador "inteligente" do card de estimativa.

**Pico de billing — Configurar Estimativa (v2.1):**

Usado **apenas** nos cards de estimativa (`_ovRenderRecursos`). A tabela de billing (`_custoHora`) mantém a média histórica.

`pico_periodo` CTE (server.js) — recursos normais:
```sql
-- Agrupa por resource_id + uom + cost_date dentro do ${where} (período selecionado)
-- DISTINCT ON (resource_id, uom) ORDER BY custo_dia DESC → dia de maior billing
-- hora/dia: custo_hora_pico = custo_dia ÷ horas_reais (qty × fator)
-- periodo:  custo_hora_pico = custo_dia ÷ 24
```

`pico_databricks` CTE (server.js) — cluster Databricks:
```sql
-- Agrupa por UPPER(resource_group_name) + cost_date (SOMA todas as VMs do RG)
-- WHERE UPPER(resource_group_name) LIKE 'DATABRICKS-RG-%' ${andCond}
-- DISTINCT ON (rg) ORDER BY pico_custo_rg DESC → dia mais caro do cluster inteiro
-- custo_hora_pico_cluster = pico_custo_rg ÷ pico_h_driver (driver hours naquele dia)
-- Captura autoscale: dia com mais workers → maior custo/h do cluster
```

JS — lógica de ativação:
```javascript
_usaPico        = _picoBrl > 0 && tipo !== 'reserva' && tipo !== 'mes' && !_dbValidaOv
_usaPicoCluster = _dbValidaOv && _picoClusterBrl > 0
```

Col1 priority order em `_ovRenderRecursos`:
1. `reserva` → `Amort./h 🔒`
2. `mes` → `🔒 Fixo/mês`
3. `_usaPico` hora/dia → `⚠ Pico/h` (laranja) com tooltip: data, custo dia, horas
4. `_usaPico` periodo → `⚠ Pico/mês*` (laranja)
5. `_usaPicoCluster` → `⚠ Pico Cluster/h` (laranja) com tooltip: data, custo RG, h_driver
6. `_dbValidaOv` → `⚡ Cluster/h` (azul — fallback sem pico)
7. demais → `Custo/h` / `Custo/mês*`

Col4 Estimado: laranja `⚠` para pico (ambos `_usaPico` e `_usaPicoCluster`); azul `⚡` para Databricks sem pico; cinza para billing normal.

**CSV/TSV import fix:** `_lerCSV` e `_lerCSVBatched` detectam TAB antes de `;` e `,`.
Azure Cost Management exporta `.csv` separado por TAB em exportações recentes (MCA).

**Mapeamento de colunas `_mapRowCSV`:** fallback case-insensitive via `_ci()` para
subscription_id (`SubscriptionGuid`, `Subscription Id`, etc.) e cost_date (`UsageDateTimeKey`).

**Diagnóstico de cache** (`_diagCache`/`_forcarRefreshCache`): exibido no dropdown de
assinatura quando 0 resultados — mostra estado de azure_costs, meter_ids e Price List.

**Legenda colapsável** (`#cov-legenda`): botão 📖 na tela Configurar Estimativa abre grid 2 colunas explicando todos os indicadores (fonte, descontos, H.reais, Uso parcial, /mês*, cores do Estimado, reserva).

**End-date calendar:** enabled — user can freely select the end date. `_sincDataFim()` only auto-fills fim if field is currently empty.

**Horas Adicionais — removido antes da migração React, não é uma lacuna de portabilidade:** esta seção
descrevia `#chad-card`/`_horasAdd`/`_hadToggle`/`_hadCustoRecurso` como se fossem funcionalidade viva de
`calculadora.js`, mas `git log -S"_hadToggle"` mostra que esse código foi removido por completo no commit
`c083218` ("perf: reduz tempo de Buscar..."), **antes** do primeiro commit da migração React (`593c8c0`).
Confirmado por uma auditoria completa (grep zero matches em `calculadora.js` e em todo `frontend/src`) — não
existe em nenhum dos dois lugares hoje. Não é algo que a migração "esqueceu" de portar; a descrição abaixo
ficou desatualizada na própria documentação do legado. Não recriar isso a menos que o usuário peça
explicitamente a funcionalidade de volta.

**Horário Livre (`#chl-card`) — desconto de horas fora do expediente:**
- Visível apenas no modo Período (oculto no modo Horas)
- `_horarioLivre = { ativo, inicio, fim, dias[] }` — persiste durante a sessão; ★ Padrão salva em `localStorage`
- `_calcHorasLivres(vIni, vFim)` — itera dia a dia, soma `janela` (hFim-hIni) para cada dia que bate em `dias[]`
  - ⚠️ Conta dias parciais (início/fim do período) como dias completos — para períodos curtos pode subtrair mais horas do que o total; `Math.max(1, horas - livres)` impede resultado ≤ 0
- `_periodos` armazena `{ inicio, fim, horas: horasCobradas, horasTotal, horasLivres }` após aplicar o desconto
- Card exibe resumo: "Xh totais → −Yh livres → Zh cobradas"
- UI: `_hlToggle(ativo)` mostra/esconde `#chl-corpo`; `_hlChange()` relê inputs e atualiza resumo; `_hlSalvarPadrao()` / `_hlLimparPadrao()` persistem em `localStorage 'hl_config'`
- **Portal público:** se `_defaultConfig.horario_livre` existe → `_hlCarregar` bloqueia todos os inputs (`disabled`), oculta botões ★/↺, exibe "⚙ Configurado pelo administrador"; dias marcados em verde (`accentColor:#22c55e`), desmarcados esmaecidos. Se admin não configurou → usuário edita livremente

**Taxas Adicionais — portal público:**
- `_carregarTaxas()`: se `_defaultConfig.taxa_imposto != null` → campo Imposto bloqueado (`disabled`, tooltip "Configurado pelo administrador"); idem para `taxa_cond`
- Se admin não configurou o campo (null/undefined) → usuário pode editar livremente
- Campo Gordura (`cgordura-col`) e botões ★/↺ (`ctaxas-btns`) sempre ocultos no portal público

**Período padrão — ambos os portais:**
- Ao confirmar assinatura (`_confirmarSub` — autenticado) ou ao buscar (`_carregarRecursos` — portal público com período bloqueado): usa `periodo_fim − 30 dias → periodo_fim` da assinatura selecionada
- Garante que o período pré-preenchido sempre aponta para dados reais importados
- Fallback: se `periodo_fim` não disponível, usa hoje como referência

**Configurar Estimativa overlay — performance:**
- `_ovRenderRecursos`: Schwartzian transform no sort (`O(S)` extrações + `O(S log S)` sort de strings puras vs `O(2S log S)` Map lookups inline)
- `_ovRMap` cacheado por referência de `_recursos` (`_ovRMapSrc`) — evita rebuild O(N) em aberturas consecutivas sem nova busca
- IntersectionObserver (`rootMargin: 200px`) no final de cada lote — substitui botão "Carregar mais"; próximos 100 cards carregam automaticamente ao rolar
- `_carregarPico()`: lazy — busca `?pico=1` em background ao abrir overlay; quando resolve, re-renderiza se modal ainda estiver aberto
- Após `_carregarPico()` resolver, `_atualizarEstimativa()` também é chamado (não só `_ovRenderRecursos()`) — sem isso o Subtotal/Total do rodapé fica preso no valor pré-pico enquanto os cards já mostram os valores de pico recarregados

**`_calcEstimado(r, horas)` — fonte única do cálculo financeiro por recurso:**
- Definida perto de `_dbInfoParaRecurso`; usada pelos cards do overlay (`_ovRenderRecursos`), pelo Subtotal/Total (`_atualizarEstimativa`) e pelo builder de `resultados` do invoice/PDF — os três nunca divergem entre si
- Antes existiam três implementações inline quase-idênticas; os cards usavam pico (RN v2.1) mas o Subtotal/Total e o invoice usavam sempre a média — Subtotal não batia com a soma dos cards nem com o PDF gerado
- Retorna `{ tipo, chora, mesBrl, bill, taxaEf, dbValida, picoBrl, picoClusterBrl, usaPico, usaPicoCluster, estimado, ... }`; não aplica gordura — cada chamador multiplica pelo próprio fator

**Guard-rail de escopo (`_abrirConfigStep` → `#cov-guardrail`):**
- Compara RGs cobertos pela seleção atual vs RGs presentes em `_recursos` (resultado da busca) — alerta quando `sel.length > 500 && rgsTot.size >= 5 && pctRgs >= 0.7`
- Evita interpretar "custo de manter o ambiente inteiro rodando em paralelo" como "custo de um projeto" — comum quando o usuário seleciona a maioria dos recursos sem perceber a escala

**Preview de PDF — `_abrirPreviewModal` precisa reparentar o modal para `<body>`:**
- `#cinv-preview-modal` nasce dentro de `#view-calculadora` (injetado por `Calculadora.init()`), que tem `display:none` quando a tela ativa não é a Calculadora
- Um `position:fixed` **não escapa** de um ancestral com `display:none` — por isso `gerarPDFEstimativaSalva()` (tela de Estimativas) rodava até o fim sem erro mas o modal nunca aparecia
- `_abrirPreviewModal` agora faz `document.body.appendChild(modal)` antes de exibi-lo (idempotente — só move se ainda não for filho direto do `body`)
- `gerarPDFEstimativaSalva()` (app.js) também garante `Calculadora.init()` antes de chamar `gerarPDFSalvo` se `#cinv-preview-modal` ainda não existir (visitar a aba Calculadora não é mais pré-requisito)
- `_buildPDFHtml`: `*,*::before,*::after` tem `print-color-adjust:exact` — sem isso o Chrome remove fundos/gradientes coloridos ao "Salvar como PDF"/imprimir, mesmo aparecendo colorido na tela

**PDF e modal de preview — tema claro:** ambos migrados de faixas roxo-escuro/quase-preto para lavanda clara (`#f5f0ff`/`#ede4ff`) com texto roxo escuro (`#5b21b6`/`#7c3aed`) — cabeçalho, coluna de total na barra de metadados, cabeçalho de tabela, linha de total final e rodapé do PDF; toolbar do modal de branco translúcido; halo/glow removidos (mantém só sombra suave). Corpo do documento (tabela, cards de categoria, observações) já era claro e não mudou.

### Portal Público
`portal.html` — calculadora Azure pública, sem login. Serve `/portal.html` diretamente via `express.static`.
**Migrado inteiramente pra React** (Fase A: chrome em `frontend/src/PortalApp.tsx`; Fase B: fluxo de
consulta/estimativa em si em `frontend/src/views/PublicCalculadoraView.tsx` — ver `## Frontend React` acima
pros detalhes de cada fase); `portal.html` hoje só tem `<head>`/CSS inline + `<body class="portal-mode">` com
`<div id="portal-root">` + `<script type="module" src="/react-app/portal-app.js">` (bundle Vite **separado**
do app autenticado) — `calculadora.js` não é mais carregado aqui.

**Ativação:** admin habilita via Configurações → Portal Público → toggle Ativar + Salvar. Config armazenada em `portal_config` (key=`'config'`).

**Tema claro/escuro:** `portal.html` suporta alternância de tema via botão sol/lua no header.
- Inline script antes do primeiro render lê `localStorage 'finops-theme'` e aplica `data-theme="light"` no `<html>` antes do paint (evita flash) — continua no `<head>` do `portal.html`, não migrou (é pre-paint, precisa rodar antes do React montar)
- `PortalApp.tsx`'s `toggleTheme()` alterna `data-theme` + salva em `localStorage 'finops-theme'` (substituiu `_portalToggleTheme()`)
- Tema compartilhado com o app autenticado — preferência persiste entre portal e sistema principal
- Header roxo (`#6d28d9`) mantém elementos brancos no tema claro via `[data-theme="light"] .portal-header { background: #6d28d9 }`
- Classe `.crcard-ov` nos cards do overlay Configurar Estimativa (`ConfigurarEstimativaOverlay.tsx`, compartilhado entre Calculadora autenticada e Portal Público) permite sobrescrita via CSS no tema claro

**Middleware `_portalMiddleware`:** lê `portal_config`, bloqueia com 403 se `ativo=false`. Injeta `req.portalCfg` para os handlers seguintes.

**Identificação de usuário (opcional)** — modal em `PortalApp.tsx` (`IdentModal`), substituiu `_mostrarModalIdent()`/`submitIdentificacao()`:
- `solicitar_identificacao=true` OU `dominios_aceitos` não vazio → exibe modal de nome+email antes da calculadora
- `POST /api/public/calculadora/identificar` valida domínio e registra em `portal_acessos`
- Sessão armazenada em `sessionStorage 'portal_ident'` — sem JWT, sem cookies
- React já escapa `nome`/`email` automaticamente ao renderizar (JSX, não `innerHTML`) — o badge do usuário não tem o risco de XSS que a versão antiga tinha
- ⚠️ XSS: `verAcessosPortal()` em `app.js:2647` (tela **admin**, autenticada — não faz parte do Portal Público) renderiza `r.nome` e `r.ip` sem escape em `innerHTML` — fix pendente, fora do escopo desta migração

**Filtragem de dados:**
- `subscription_ids[]` — apenas essas subs são expostas no portal
- `resource_groups[]` — filtro de RG por subscription. **Bug real corrigido (2026-08-24)**: o campo nunca
  era persistido — `savePortalConfig()` (app.js) calculava `rgs` a partir do textarea mas não incluía no body
  do POST (só `subscription_ids`), e `POST /api/admin/portal-config` (server.js) também nunca desestruturava/
  gravava `resource_groups` do body, mesmo que o cliente enviasse — um fix só do lado do cliente não teria
  sido suficiente. O read-path (`GET /api/public/calculadora/resource-groups`/`/recursos`) sempre aplicou o
  filtro corretamente quando o campo tinha dados — só o write-path (os dois lados) estava quebrado. Campo
  sempre retornava `[]` até esta correção.
- Recursos: `GET /api/public/calculadora/recursos` valida `subscription_id` do request contra `allowedSubs` da config
- Estimativa (salvar): `POST /api/public/calculadora/estimativas` — grava direto na tabela `estimativas` (mesma
  lida pelas telas autenticadas de Estimativas/Dashboard). **Bug real corrigido (2026-08-24)**: até esta
  correção não validava nada contra `req.portalCfg` — qualquer chamada anônima (bypassando o `InvoiceModal.tsx`
  via `curl` direto) podia persistir uma estimativa fabricada (recursos/totais arbitrários, `projeto_id`
  qualquer) na mesma tabela usada pelas telas internas. Corrigido com a mesma validação de `resource_id`
  contra `allowedSubs`/`allowedRGs` (via `azure_costs`) que `GET /recursos` já usava — agora exige que **todos**
  os `resource_id` do payload pertençam ao escopo liberado pelo admin, senão retorna 403.
- **`POST /api/calculadora/estimar` (privado) e seu delegate `POST /api/public/calculadora/estimar` foram
  removidos (2026-08-24)** — motor de cálculo mais antigo (nomenclatura RN-001 a RN-005, anterior à
  RN-006/RN-007/RN-DB-001 atuais), confirmado sem nenhum chamador vivo: o único caller (`calculadora.js:2729`)
  está num arquivo que não é mais carregado por `index.html` nem `portal.html` desde a migração React. O
  delegate público era alcançável sem nenhuma autenticação e rodava SQL não-trivial — removido junto por
  higiene de superfície de ataque, não só limpeza de código morto. O cálculo real hoje é 100% client-side
  (`frontend/src/lib/calcEstimado.ts`).

**Delegação interna para handler privado:**
```javascript
// Encontra o último handler da rota privada via app._router.stack
const handler = app._router.stack
  .filter(l => l.route?.path === '/api/calculadora/recursos')
  .map(l => l.route.stack[l.route.stack.length - 1].handle)[0];
await handler(req, res, () => {});
// ⚠️ Se handler === undefined, nenhuma resposta é enviada (requisição fica presa)
```

**Endpoints públicos (sem auth):**
```
GET  /api/public/calculadora/config          — título, descrição, taxa_imposto, taxa_cond, horario_livre
POST /api/public/calculadora/identificar     — registra acesso (nome, email, ip)
GET  /api/public/calculadora/subscriptions   — subs permitidas pelo admin
GET  /api/public/calculadora/resource-groups — RGs filtrados pela config (usa azure_rg_cache — ver nota abaixo)
GET  /api/public/calculadora/recursos        — delega para handler privado (auth bypassado)
POST /api/public/calculadora/estimativas     — salva estimativa (valida resource_ids contra allowedSubs/RGs)
GET  /api/public/calculadora/projetos        — projetos com status='Ativo'
```

**Endpoints admin (authMiddleware):**
```
GET  /api/admin/portal-config   — lê config atual
POST /api/admin/portal-config   — salva config (inclui resource_groups desde a correção acima)
GET  /api/admin/portal-acessos  — log de acessos (limit max 500)
```

**`Calculadora.init` no portal:**
```javascript
Calculadora.init({
  apiBase: '/api/public/calculadora',
  publico: true,
  defaultConfig: { taxa_imposto, taxa_cond, horario_livre }  // vem de /api/public/calculadora/config
});
```
`_modoPublico=true` desativa `_setupImport()` e esconde `#cvista-detalhe`, `#cvista-servico`, `#cimport-area` via CSS `.portal-mode`.

### Reservas module
`_RSV_SCOPE_CONFIG` — per-cloud scope configuration object in `app.js`. Defines field labels, placeholders, and whether a field uses API-driven CMS dropdown (`api:true`) or manual text input.

`_RSV_DEFAULT_SCOPE` — maps each cloud to its default scope so field labels appear immediately on cloud selection:
```
Azure → Subscription | AWS → Account | GCP → Project | Oracle → Tenancy | Multicloud → Shared
```

**CMS dropdowns (`.cms-wrap`):** used for Azure Subscription and Resource Group fields. State variables:
- `_rsvSubVal`/`_rsvSubName` — committed values
- `_rsvSubPend`/`_rsvSubPendName` — pending (inside open dropdown)
- Subscription display name stored at selection time via `data-lbl` on radio buttons — avoids dependency on `subscription_name` being non-null in DB

**Prazo → Vencimento auto-fill:** `onRsvPrazoChange()` calculates `data_vencimento` from `data_inicio` + years selected in prazo.

**Reserva alerts popup (`modal-rsv-alerts`):** fires on every login (no session guard). `checkRsvAlertsPopup()` fetches `GET /api/reservas?status=Ativa`, filters for `data_vencimento ≤ 90 days`, shows popup if any found. Popup stops appearing automatically when status is updated to Renovada or Cancelada. Severity badges:
- `< 0 dias` → Expirada (red)
- `0–30 dias` → Crítico (orange)
- `31–60 dias` → Atenção (yellow)
- `61–90 dias` → Aviso (blue)

### E-mail (SMTP) e alertas (2026-08-26)

Antes desta feature, todo alerta do sistema só existia dentro da própria tela (sino, popups) — se ninguém
estivesse logado, uma reserva vencia, uma coleta parava de rodar, ou um orçamento Databricks estourava sem
que ninguém soubesse. Pedido explícito do usuário. Confirmado por investigação: **zero infraestrutura de
e-mail** existia em todo o código antes disso, e **zero mecanismo de dedup** em lugar nenhum — sem isso,
qualquer checagem periódica reenviaria o mesmo alerta a cada ciclo pra sempre.

**SMTP reaproveita `integracoes`** (tipo novo `'smtp'`, mesma tabela genérica já usada por AD/Entra ID) —
zero tabela nova pra configuração. Diferente de AD/Entra (que guardam segredo em texto puro no JSONB — gap
pré-existente, não replicado aqui), `senha` vai cifrada com `_encryptSecret`/`_safeDecrypt` (mesmas usadas
pras credenciais Azure/Databricks) e **nunca volta em nenhum GET** (mascarada com `undefined` antes de
responder) — mesmo padrão de "client_secret nunca volta do GET" já usado em `/api/databricks-coleta/config`.
`POST /api/integrations/:tipo` trata `senha` vazia como "manter a atual" (busca o valor já cifrado no banco
antes de sobrescrever), mesmo padrão de "client_secret opcional" do Databricks.

**Bug real corrigido de passagem**: `POST /api/integrations/:tipo` fazia só `UPDATE ... WHERE tipo=$3` — se
a linha não existisse ainda em `integracoes` (só `ad`/`entra` vinham semeadas no `CREATE TABLE`), o UPDATE
não fazia nada e a rota respondia `{ok:true}` mesmo assim, um no-op silencioso. Só nunca foi notado porque
`ad`/`entra` sempre existiam. Corrigido com `INSERT ... ON CONFLICT (tipo) DO UPDATE` — funciona pra `smtp`
e qualquer tipo futuro sem precisar semear linha nenhuma.

**5 gatilhos implementados** (server.js, seção "EMAIL"):

| Gatilho | Tipo | Dedup |
|---|---|---|
| Coleta com erro (Azure API/Storage + Databricks) | evento — `_alertarColetaComErro`, ao lado de cada `_registrarNotificacaoColeta(...,'coleta_erro')` (3 call sites) | não precisa (1x por falha real) |
| Estimativa aprovada/reprovada | evento — `_alertarEstimativaStatus`, dentro de `PUT /api/estimativas/:id/status` | não precisa |
| Orçamento Databricks estourado (≥75%) | periódico — `_checkOrcamentosDatabricks` | sim |
| Reserva Cloud vencendo/vencida (≤90 dias) | periódico — `_checkReservasVencendo` | sim |
| Ação FinOps com prazo vencendo/vencido (≤5 dias) | periódico — `_checkAcoesVencendo` | sim |

**Não incluído de propósito**: e-mail de coleta com **sucesso** — acontece várias vezes por dia por SP,
viraria spam sem valor real (já existe no sino, lugar certo pra isso).

**Dedup** (`email_alertas_enviados`, tabela nova: `tipo`, `chave`, `enviado_em`, `UNIQUE(tipo,chave)`) —
upsert atômico numa query só, sem race condition:
```sql
INSERT INTO email_alertas_enviados (tipo, chave) VALUES ($1,$2)
ON CONFLICT (tipo, chave) DO UPDATE SET enviado_em = NOW()
WHERE email_alertas_enviados.enviado_em < NOW() - INTERVAL '24 hours'
RETURNING id
```
`RETURNING` vazio = já enviado dentro do cooldown de 24h, não reenvia. Cooldown de 24h (não "só uma vez pra
sempre") é deliberado — o problema pode persistir (reserva continua vencida, orçamento continua estourado),
então continua lembrando diariamente até ser resolvido, mesmo espírito do popup in-app (que já reaparece a
cada login). Chave do orçamento inclui o mês (`orcamento:{id}:{YYYY-MM}`) pra reavisar todo mês se continuar
estourado, em vez de nunca mais alertar depois da primeira vez.

**Destinatário** — infra (coleta erro, orçamento estourado): lista `destinatarios_padrao` configurada no
SMTP. Pessoal (reserva/ação/estimativa): `reservas_cloud.criado_por` é FK real pra `usuarios(id)` — usa o
e-mail do dono quando existir; `acoes_finops.responsavel`/`estimativas.responsavel` são só texto livre (sem
FK/e-mail na tabela) — tenta casar `usuarios.nome ILIKE responsavel` (mesma convenção que o sino já usa, só
no sentido contrário: `GET /api/notificacoes` faz `req.user.nome ILIKE a.responsavel`); sem match em nenhum
dos dois, cai pra `destinatarios_padrao`.

**`_iniciarAlertasEmail()`** — `setInterval` **próprio e separado** do agendador de coleta
(`_iniciarAgendador`/`_tickAgendador`, que já roda a cada 5min com um `return` antecipado no bloco de
Storage que pularia qualquer coisa adicionada depois no mesmo tick) — alertas por e-mail não têm urgência de
5min, então não valia acoplar ali. Primeira checagem 3min após o boot, depois de hora em hora. Chamado nos
mesmos 3 pontos que já chamam `_iniciarAgendador()` (startup, reconexão de banco, auto-recover em
`GET /api/azure-coleta/status`) — mesmo padrão de idempotência (guardado por `_alertasEmailTimer`).

**Tudo silencioso sem SMTP configurado/ativo** — `_getSmtpConfig()` retorna `null` se `!ativo` ou campos
faltando, e todo gatilho checa isso antes de fazer qualquer trabalho. `_sendEmail()` nunca lança pro chamador
(falha de e-mail não pode quebrar uma coleta nem uma troca de status) — só loga um aviso no console.

**Frontend**: novo card ".integration-card" "E-mail (SMTP)" na aba Integrações de Configurações (renomeada
de "AD / Entra ID" pra "Integrações", já que agora cobre 3 tipos) — 100% legado (`index.html`/`app.js`,
mesmo padrão de AD/Entra, não migrado pra React já que essa aba inteira ainda não foi). `toggleIntegration`/
`salvarIntegracao`/`testarConexao`/`openSettingsModal`'s populate ganharam um 3º branch `smtp` (antes só
`ad`/`entra` hardcoded nos 4 lugares). `POST /api/integrations/smtp/testar` (`adminMiddleware`) testa
credenciais ainda não salvas — mesmo padrão de "erro cru é o propósito da rota" de `POST
/api/azure-coleta/sps/:id/testar`.

**Verificado via Playwright contra o servidor real** (não só testes unitários — este código não tem cobertura
automatizada, é 100% backend/legado): salvou config de teste via API, confirmou `senha` nunca volta no GET,
confirmou os campos pré-preenchem corretamente ao reabrir Configurações, e "Testar Conexão" contra um
servidor SMTP real (smtp.mailtrap.io) com credenciais falsas retornou o erro real do servidor (`Invalid
login: 535 5.7.0 Invalid credentials`) — prova que o transporte nodemailer conecta e autentica de verdade,
não só que o código não quebra. **Não verificado**: entrega de e-mail de ponta a ponta com credenciais reais
(nenhum SMTP real disponível neste ambiente) — quando o usuário configurar um servidor de verdade, "Testar
Conexão" é o primeiro passo pra confirmar que funciona.

### Excel export
`GET /api/export/excel` — ExcelJS, 3-sheet `.xlsx`:
1. **Sumário Executivo** — status + cloud breakdown
2. **Ações Detalhadas** — full list with auto-filter + freeze pane
3. **Retorno Mensal** — monthly breakdown

Vivo purple palette (ARGB): `FF4A0080` dark · `FF7B2FBE` main · `FFF3E8FF` light · `FF9333EA` accent.

### UI — Vivo purple theme

**CSS variables (`:root` in styles.css):**
```css
--bg:           #040009
--bg-card:      rgba(12, 2, 22, 0.94)
--bg-hover:     rgba(20, 4, 36, 0.80)
--border:       #1e0040
--border-light: #2a0058
--text:         #e8eaf0
--text-muted:   #7b6a9e
--text-dim:     #a990cc
--accent:       #9333ea
--accent-dim:   rgba(147, 51, 234, 0.12)
--accent-glow:  rgba(147, 51, 234, 0.28)
--danger:       #ff4d6a   /* = --red */
--red:          #ff4d6a
--orange:       #ff8c42
--green:        #22c55e
--blue:         #4da6ff
```

**Body background** — quase preto com sutilíssimo toque roxo, fixo:
```css
background:
  radial-gradient(ellipse at 20% 50%, rgba(80,0,140,.14) 0%, transparent 50%),
  radial-gradient(ellipse at 80% 20%, rgba(50,0,100,.08) 0%, transparent 45%),
  linear-gradient(170deg, #07000f 0%, #040009 60%, #020006 100%);
background-attachment: fixed;
/* --bg: #040009 — usado por portal.html e elementos que referenciam var(--bg) */
```
`portal.html` usa `background: var(--bg)` (flat). `docs-faq.html` e `docs-portal-faq.html` têm degradê roxo próprio mais intenso.

**Glassmorphism layers (tema escuro — default):**
- `.sidebar`: `rgba(6,0,14,.92)` + `backdrop-filter: blur(18px)`
- `.top-bar`: `rgba(6,0,14,.86)` + `backdrop-filter: blur(18px)` + `z-index: 20`
- `.stat-card`: `rgba(14,2,28,.90)` + `backdrop-filter: blur(12px)`
- `.modal`: `rgba(8,0,18,.96)` + `backdrop-filter: blur(24px)`
- **Sem glow decorativo**: `text-shadow` do `.page-title`, `drop-shadow` do ícone da marca, `box-shadow` do ponto ativo no submenu e do hover do `.btn-primary`, e o `drop-shadow` do logo "vivo" foram removidos — mantém o fundo quase-preto com tom roxo e a barra de acento roxa no topo da sidebar, só sem brilho neon. Blur/glassmorphism foi mantido (não é "glow", é textura aceita em produtos corporativos)

**Tema claro — Direção A ("Sidebar Clara"):** ao contrário do escuro, sidebar e top-bar são **brancas** (`#ffffff`, borda `#e5e7eb`), com roxo só como acento — item ativo do menu (`#f3e8ff` bg + `#7c3aed` texto), botões, números. Não é glassmorphism nem roxo sólido; é o padrão "chrome neutro" comum em SaaS corporativo (Stripe, Linear). Stat-cards são brancas lisas com borda uniforme (sem faixa colorida no topo). Tabelas (`table thead`) também neutras (`#f9fafb`), não mais roxo sólido. Ver `[data-theme="light"] .sidebar` / `.top-bar` em `styles.css` (~linha 1380+).

**`.view-hero`** (novo): classe opcional para título+subtítulo de seção dentro do conteúdo (ex: tela Coleta de Custos). Só tem estilo no tema claro — fundo em gradiente lavanda-roxo, texto branco; no escuro fica sem estilo próprio (mantém o `.page-title` branco padrão, que já lê bem no fundo quase preto). Uso: `<div class="view-hero"><div class="page-title">Título</div><div class="view-hero-sub">Subtítulo</div></div>`.

**Cloud stats strip** (`.cloud-stats-strip`) — sticky bar at top of views:
- Container: `rgba(22,4,38,.72)` + `backdrop-filter: blur(14px)` + `border-radius: 14px`
- Cards inside: `rgba(22,4,38,.50)` + `border: 1px solid var(--border)` + `border-radius: 10px`
- Active card: `border-color: var(--accent)` + `background: rgba(147,51,234,.18)` + inner glow

**Page titles** (`.page-title`):
- `font-size: 22px`, `font-weight: 700`, `text-transform: uppercase`
- Tema escuro (default): texto branco sólido, sem `text-shadow` (glow removido)
- Tema claro, dentro do conteúdo (fundo cinza claro): gradiente de texto `linear-gradient(90deg, #5b21b6 → #9333ea)`
- Tema claro, dentro da `.top-bar` (fundo branco): sólido `#111827` — regra `[data-theme="light"] .top-bar .page-title` com especificidade maior que a regra geral acima, senão o gradiente roxo fica quase invisível sobre o próprio fundo branco/roxo da barra

**Button classes:**
- `.btn-primary` — filled accent purple, white text (defined in `styles.css`)
- `.btn-ghost` / `.btn-secondary` — transparent with border, muted text (defined in `styles.css`)
- `.btn-sso` — SSO login buttons (defined inline in `index.html`)
- `.btn-export` — defined in `index.html` inline `<style>` (overrides external CSS)

**Key element rules:**
- `.currency`, `.months-table .positive` → `var(--accent)`
- `.btn-primary`, `.cbtn-go`, `.cms-btn-ok` → `color: #ffffff`
- `.toast.success` → accent background, **white** text (`#ffffff`)
- `.finops-id` (ID FinOps / Número da Estimativa, dentro de `<td>`) → `var(--accent)`. **Bug real reportado
  pelo usuário e corrigido**: sozinha, a classe (1 classe) perdia em especificidade CSS pra `.data-table td`
  (1 classe + 1 elemento, define `var(--text-dim)`) e, no tema claro, pra `[data-theme="light"] table tbody td`
  (1 atributo + 3 elementos, define `#374151`) — o ID/Número renderizava cinza/dim em vez de roxo, nos dois
  temas. Corrigido com `.data-table .finops-id { color: var(--accent) }` (2 classes, especificidade maior que
  as duas regras concorrentes) — ver `.data-table td` em `styles.css`. Confirmado via `getComputedStyle`.

**Compatibility CSS aliases** (in `:root` — do not remove):
- `--surface` → `rgba(22,4,38,.82)` — used by inline styles in index.html
- `--base` → `#0c0014`
- `--surface-alt` → `rgba(12,0,20,.90)`
- `--text-primary` → `#e8eaf0`

**Date/time input styling (styles.css):**
- `::-webkit-calendar-picker-indicator` com `filter: invert(93%) sepia(8%) saturate(200%) hue-rotate(200deg) brightness(105%)` — torna o ícone do calendário/relógio da mesma cor do texto `#e8eaf0` em todos os inputs `type="date"` e `type="time"` do sistema
- Aplicado globalmente em `styles.css` — cobre app autenticado, portal público e qualquer tela

**Known latent issue — do not touch:**
- `calculadora.js` element ID `ccondominио` contains Cyrillic chars (и, о). It works because HTML and JS use the identical string. Do not refactor this ID without replacing all 6+ occurrences atomically.

### Top-bar brand
Left group: hamburger button + `div.topbar-vivo-brand` containing a single SVG `<text>` "vivo" in `#9333ea` (58×26 px, Arial Black 900, `drop-shadow` glow). No canvas, no mascote, no load delay.
Hidden on mobile via `@media (max-width: 768px) { .topbar-vivo-brand { display: none !important; } }`.

### Login screen
- Tema escuro (default): Background `#0c0014` + `::before` radial glow + `::after` conic-gradient rays (animated)
- `.login-rays` + `.login-glow` — extra animated ray layers for depth
- Logo: SVG "vivo" text (`#9333ea`, 46px Arial Black) com canvas do `mascote.png` ao lado
  - Canvas starts at `opacity:0`; `onload` revela ambos juntos para evitar flash
  - **`onerror` handler:** se `mascote.png` falhar, SVG "vivo" aparece sozinho (canvas hidden)
  - `mascote.png` não está no git (`.gitignore: *.png`) — manter cópia local no servidor
- Card: `rgba(18,2,32,.78)` + `backdrop-filter: blur(24px)` + purple border + float animation
- **Tema claro**: fundo `#f0f2f5`; mesmas camadas de animação (`::before`/`::after`/`.login-rays`/`.login-glow`, mesmo keyframe `vivo-pulse`/`vivo-rotate`) só com opacidade bem reduzida (ex: `.58` → `.20` no pulso central) — mesma cor roxa dos botões (`#9333ea`), só sutil em vez de brilho forte, apropriado pra fundo claro. `.login-box` vira card branco com borda cinza e sombra suave (sem o glow roxo do shadow)

### Tema claro/escuro — padrão do sistema
- **Claro é o padrão** em `index.html`, `portal.html` e na tela de login — script inline no `<head>` aplica `data-theme="light"` a menos que `localStorage['finops-theme'] === 'dark'` (antes era o oposto: só aplicava claro se `=== 'light'`)
- `toggleTheme()` (app.js) e `_portalToggleTheme()` (portal.html) agora **salvam `'dark'` explicitamente** no `localStorage` ao escolher o tema escuro — antes removiam a chave, o que só funcionava com a regra padrão antiga ("ausência = escuro"); com o padrão invertido, ausência agora significa claro, então escuro precisa ficar persistido
- `doLogin()` **não força mais tema escuro no login** — antes tinha `localStorage.removeItem('finops-theme')` + `removeAttribute('data-theme')` hardcoded a cada login ("garante tema escuro como padrão"); removido — login preserva o tema já ativo na página
- `_syncThemeIcon()` / `_portalSyncThemeIcon()` já eram chamados em `DOMContentLoaded` — ícone sol/lua sincroniza corretamente com o novo padrão sem mudança adicional

### Navigation
`openNavGroup(id)` — always opens a sidebar nav group (adds `.open`).
`toggleNavGroup(id)` — toggles open/closed.
Dashboard header calls `openNavGroup('dashboard')`. Chevron icon calls `toggleNavGroup` with `stopPropagation`.

Nav group CSS is defined **once** in styles.css (~line 213). Do not add a second block — a duplicate existed and was removed.

### Notification panel
Bell icon opens `#notif-panel`. Light theme: `rgba(110, 30, 170, 0.95)` (medium Vivo purple). Dark theme: default dark surface.

**Dismissal — pedido do usuário (2026-08-25)**: ao abrir o painel, toda notificação exibida naquele momento
(ação/reserva vencendo E coleta concluída/erro) some da lista e da contagem do badge a partir daí — inclusive
em próximos logins — e só reaparece se for uma notificação nova (id/`_kind` diferente do já visto). Antes,
só as notificações `_kind:'sistema'` (coleta concluída/erro) tinham qualquer rastreamento de "visto"
(`notif_sistema_vista_id` no `localStorage`), e mesmo assim só afetava a CONTAGEM do badge — a notificação
continuava aparecendo na lista pra sempre até expirar (48h) ou virar irrelevante. Ações/reservas vencendo
não tinham rastreamento nenhum: reapareciam identicamente a cada login enquanto o prazo seguisse vencido,
sem forma de "reconhecer e não ver de novo" — exatamente o comportamento que o usuário reportou querer mudar.

Corrigido generalizando o mecanismo já existente (que só cobria sistema) pros três tipos: `_notifKey(n)`
(app.js) gera uma chave estável por notificação (`sistema:${_id}` ou `${_kind}:${id}` — nunca baseada no
texto/dias calculados, que mudam a cada request pra uma mesma ação/reserva). `loadNotificacoes()` filtra
contra um Set `notif_dismissed` (`localStorage`, cap de 500 chaves) antes de montar lista e badge;
`toggleNotifPanel()`, ao abrir, adiciona a chave de tudo que está renderizado em `#notif-list
[data-notif-key]` nesse Set. `data-notif-key` substituiu o antigo `data-notif-id` (que só existia nos itens
de sistema) — agora todo item renderizado (ação/reserva/sistema) carrega o atributo. `notif_dismissed`
sobrevive a `logout()` de propósito (mesmo comportamento já assumido pelo mecanismo antigo) — é por navegador/
perfil, não por usuário; múltiplos usuários no mesmo navegador compartilhariam o estado de dispensado, mesma
limitação que já existia antes, não introduzida por esta mudança. Verificado via Playwright contra o
servidor real: badge com 2 notificações → abrir painel → fechar → reload da página (simula "próximo login")
→ badge some e lista mostra o estado vazio, zero erro de console.

**Refinado a pedido do usuário (2026-08-26) — dispensa deixou de ser automática ao abrir o painel**: a versão
acima dispensava TUDO que estava visível no momento em que o painel era aberto, sem ação nenhuma do usuário
— na prática, ação/reserva sumiam só de o usuário abrir o sino, mesmo sem ele "ter feito nada" com aquela
notificação específica. Pedido explícito: ação/reserva (prazo real, dinheiro real em jogo) devem ficar
visíveis até o usuário fechar cada uma manualmente; coleta (só informativo) pode ganhar uma opção de
desativar o tipo inteiro. `toggleNotifPanel()` não dispensa mais nada ao abrir — só chama `loadNotificacoes()`
pra mostrar o estado atual. Nova função `dismissNotifItem(key, event)` — botão "✕" em cada linha (`closeBtn`
em `loadNotificacoes()`), `event.stopPropagation()` pra não disparar o `onclick` da própria linha
(`viewAcao`/`showView('reservas')`) ao clicar no ✕. Novo checkbox no rodapé do painel ("Ocultar notificações
de coleta", `#notif-toggle-sistema` em index.html) — grava `notif_sistema_desativado` (`'1'`/`'0'`) no
`localStorage`; quando ativo, filtra `_kind:'sistema'` inteiro em `loadNotificacoes()`, independente de já
ter sido dispensado individualmente ou não. `notif_dismissed` (mecanismo de chave estável) continua o mesmo,
só muda O QUE dispara a dispensa — de "abrir o painel" pra "clicar no ✕". Verificado via Playwright contra o
servidor real: abrir/fechar/reabrir o painel sem clicar em nada preserva todas as notificações (a mudança de
comportamento central); clicar no ✕ de uma remove só aquela; marcar o checkbox esconde as 4 notificações de
coleta do usuário de teste (mostra o estado vazio); desmarcar restaura, respeitando a que já tinha sido
dispensada manualmente antes.

### Auto-refresh
`setRefreshInterval(minutes)` — covers dashboard, projetos, ações, estimativas, reservas, coleta, and calculadora views. Countdown shown in FAB button. Timer stored in `_refreshTimer` + `_countdownTimer`, both cleared on logout and before recreation.

`manualRefresh()` — since all 7 views it knows about are `MIGRATED_VIEWS` (React), it calls `window.__reactBridge.refresh()` when `currentView` is one of them, instead of the old per-view `loadDashboard()`/`loadProjetos()`/etc. calls.
**Real bug found and fixed**: those old per-view calls used to manipulate DOM inside `#view-<nome>`, which has been permanently `display:none` since each view migrated — every branch had quietly become a no-op (the "Atualizar" button and the auto-refresh countdown did nothing for any screen). `frontend/src/bridge.ts` gained `setRefreshHandler`/`refresh()` (same registration pattern as `setViewListener`); `App.tsx` registers `() => queryClient.invalidateQueries()` once — since only the currently-mounted view's queries are "active", invalidating the whole cache correctly refreshes just what's on screen without needing a per-view handler.

### Interval lifecycle (app.js)
All recurring timers have named references and are cleared on logout:
```
_dbStatusInterval   checkDbStatus()       every 30 s
_notifInterval      loadNotificacoes()    every 5 min
_refreshTimer       manualRefresh()       configurable (default 10 min)
_countdownTimer     countdown display     same as _refreshTimer
_inactivityTimer    showTimeoutWarning()  15 min idle
```

---

## Environment variables

```
JWT_SECRET      string   Required in prod — default 'finops-secret-2024' triggers startup warning
JWT_EXPIRES     string   Token TTL, default '8h'
MASTER_KEY      string   Required in prod — default triggers startup warning
DB_HOST         string   PostgreSQL host
DB_PORT         number   default 5432
DB_NAME         string   default 'finops_db'
DB_USER         string   default 'postgres'
DB_PASSWORD     string   required
PORT            number   default 3000
ALLOWED_ORIGIN  string   CORS origin — null reflects all origins (dev only); set in prod
DATABASE_URL    string   Optional — parsed into DB_* vars (Railway/Render/Fly.io)
```

Config priority: `DB_HOST` env var → `DATABASE_URL` → `.finops_setup` file → setup wizard.

---

## Generating JWT_SECRET and MASTER_KEY

Never invent these values manually. Use one of the commands below to generate cryptographically secure strings:

**Node.js (recommended — already on the server):**
```bash
node -e "const c=require('crypto'); console.log('JWT_SECRET=' + c.randomBytes(48).toString('hex')); console.log('MASTER_KEY=' + c.randomBytes(48).toString('hex'));"
```
Prints both lines ready to paste into `.env`.

**PowerShell (Windows):**
```powershell
# Run twice — once per variable
[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

**Rules:**
- Minimum **32 characters** (both methods above produce 96)
- Never share `JWT_SECRET` — anyone who has it can forge valid login tokens
- If `MASTER_KEY` changes after setup, `.finops_setup` becomes unreadable — store it in a safe place
- Server prints a console warning on startup if either value is still the insecure default

---

## Cloud deployment

### Railway (quickest start)
1. Create project → **+ New > Database > PostgreSQL** — `DATABASE_URL` injected automatically
2. Add variables: `JWT_SECRET`, `MASTER_KEY`, `ALLOWED_ORIGIN`
3. Start command: `node server.js`
4. `DATABASE_URL` is parsed automatically into `DB_*` vars — no need to set them separately

### Render
1. Web Service: Build = `npm install`, Start = `node server.js`
2. Create PostgreSQL → copy **Internal Database URL** → set as `DATABASE_URL` in env vars
3. Add `JWT_SECRET`, `MASTER_KEY`, `ALLOWED_ORIGIN`

### Fly.io
```bash
fly launch --name finops-manager --region gru   # gru = São Paulo
fly postgres create --name finops-db
fly postgres attach finops-db                   # injects DATABASE_URL
fly secrets set JWT_SECRET=<value> MASTER_KEY=<value> ALLOWED_ORIGIN=https://...
fly deploy
```

### Docker
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```
```bash
docker run -d --name finops -p 3000:3000 \
  -e JWT_SECRET=... -e MASTER_KEY=... -e DATABASE_URL=... -e ALLOWED_ORIGIN=... \
  -v finops-data:/app \          # persists .finops_setup + uploads_tmp + mascote.png
  finops-manager
```

### Azure PaaS — App Service + PostgreSQL Flexible Server
```bash
az group create --name rg-finops --location brazilsouth
az postgres flexible-server create \
  --resource-group rg-finops --name finops-pg \
  --location brazilsouth --version 16 \
  --admin-user pgadmin --admin-password <senha> \
  --sku-name Standard_B1ms --tier Burstable
az postgres flexible-server db create --resource-group rg-finops \
  --server-name finops-pg --database-name finops_db
az webapp create --resource-group rg-finops --plan finops-plan \
  --name finops-manager --runtime "NODE:18-lts"
az webapp config set --resource-group rg-finops \
  --name finops-manager --startup-file "node server.js"
az webapp config appsettings set --resource-group rg-finops \
  --name finops-manager --settings \
  DATABASE_URL="postgresql://pgadmin:<senha>@finops-pg.postgres.database.azure.com:5432/finops_db?sslmode=require" \
  JWT_SECRET=<gerado> MASTER_KEY=<gerado> \
  ALLOWED_ORIGIN=https://finops-manager.azurewebsites.net
zip -r finops.zip . -x "node_modules/*" -x ".env" -x "uploads_tmp/*"
az webapp deploy --resource-group rg-finops \
  --name finops-manager --src-path finops.zip --type zip
```

---

## Configuring as a system service

### PM2 — Linux & Windows (recommended)
```bash
npm install -g pm2
pm2 start server.js --name finops-manager
pm2 save
pm2 startup
```
Key commands: `pm2 status` · `pm2 logs finops-manager` · `pm2 restart finops-manager`

### systemd — Linux
Create `/etc/systemd/system/finops-manager.service`:
```ini
[Unit]
Description=FinOps Manager - Vivo
After=network.target postgresql.service

[Service]
Type=simple
User=finops
WorkingDirectory=/opt/finops-manager
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/opt/finops-manager/.env

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable finops-manager
sudo systemctl start finops-manager
sudo journalctl -u finops-manager -f
```

### Windows Service — NSSM
```powershell
nssm install FinOpsManager
nssm set FinOpsManager Application  "C:\Program Files\nodejs\node.exe"
nssm set FinOpsManager AppDirectory "C:\finops-manager"
nssm set FinOpsManager AppParameters "server.js"
nssm set FinOpsManager Start SERVICE_AUTO_START
nssm start FinOpsManager
```

---

## Production checklist

- [ ] `JWT_SECRET` set to a long random string (≥ 32 chars)
- [ ] `MASTER_KEY` set to a long random string (≥ 32 chars)
- [ ] `ALLOWED_ORIGIN` set to the exact frontend domain
- [ ] `DB_PASSWORD` set and not default
- [ ] `.env.enc` used instead of plain `.env` (run `node encrypt-env.js encrypt`)
- [ ] HTTPS termination at reverse proxy (nginx / Caddy) — Node runs HTTP only
- [ ] `uploads_tmp/` writable by the Node process
- [ ] PostgreSQL accessible from Node host on configured port
- [ ] `mascote.png` present in the app directory (not tracked by git — copy manually)
- [ ] Windows Firewall: port 3000 open for inbound connections (if accessed from network)
- [ ] PM2 or systemd configured for auto-restart on crash/reboot
- [ ] Portal Público: se ativado, verificar que `subscription_ids` está configurado — sem isso, nenhum dado é exposto
- [ ] Portal Público: `solicitar_identificacao=true` ou `dominios_aceitos` configurado para restringir acesso
