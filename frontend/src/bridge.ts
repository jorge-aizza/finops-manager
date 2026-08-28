// Ponte entre o shell legado (app.js / showView()) e o React.
// app.js chama window.__reactBridge.mount(view) quando o usuário navega pra
// uma tela já migrada; App.tsx escuta essa mudança via setViewListener().
// Ver "Arquitetura: ponte (bridge) strangler-fig" no plano.

export type ViewChangeListener = (view: string | null) => void
export type DashboardTabListener = (tab: string) => void
export type RefreshHandler = () => void | Promise<unknown>

let currentView: string | null = null
let listener: ViewChangeListener | null = null

// Dashboard tem duas sub-abas (Ações/Estimativas) trocadas pelo sub-nav da
// sidebar sem passar por showView() de novo — precisa de um canal próprio,
// separado do mount/unmount genérico usado pelas demais telas migradas.
let currentDashboardTab = 'acoes'
let dashboardTabListener: DashboardTabListener | null = null

// Databricks ganhou o mesmo padrão (2026-08-28) — 3 sub-abas (Dashboard/Orçamentos e
// Anomalias/Quotas) dentro da mesma DatabricksDashboardView.tsx montada, trocadas pelo
// sub-nav sem remount. Canal separado do de Dashboard — cada view migrada com sub-abas
// tem o seu próprio, não compartilham estado.
let currentDatabricksTab = 'dashboard'
let databricksTabListener: DashboardTabListener | null = null

// manualRefresh() (app.js, botão "Atualizar" + countdown de auto-refresh)
// chama isso pra telas migradas em vez de reimplementar refetch por tela —
// App.tsx registra um handler único (queryClient.invalidateQueries()) que
// vale pra qualquer view montada, já que só as queries ativas realmente
// refazem a chamada de rede quando invalidadas.
let refreshHandler: RefreshHandler | null = null

export function setViewListener(fn: ViewChangeListener): void {
  listener = fn
  fn(currentView)
}

export function setDashboardTabListener(fn: DashboardTabListener): void {
  dashboardTabListener = fn
  fn(currentDashboardTab)
}

export function setDatabricksTabListener(fn: DashboardTabListener): void {
  databricksTabListener = fn
  fn(currentDatabricksTab)
}

export function setRefreshHandler(fn: RefreshHandler): void {
  refreshHandler = fn
}

function mount(view: string): void {
  currentView = view
  listener?.(view)
}

function unmount(): void {
  currentView = null
  listener?.(null)
}

function setDashboardTab(tab: string): void {
  currentDashboardTab = tab
  dashboardTabListener?.(tab)
}

function setDatabricksTab(tab: string): void {
  currentDatabricksTab = tab
  databricksTabListener?.(tab)
}

async function refresh(): Promise<void> {
  await refreshHandler?.()
}

declare global {
  interface Window {
    __reactBridge: { mount: typeof mount; unmount: typeof unmount; setDashboardTab: typeof setDashboardTab; setDatabricksTab: typeof setDatabricksTab; refresh: typeof refresh }
    __reactBridgeQueuedView?: string
    currentUser?: { nome?: string; email?: string; perfil?: string } | null
    logout?: (pedirConfirmacao?: boolean) => void
    showToast?: (msg: string, type?: 'success' | 'error' | 'warn') => void
    exportarExcel?: () => void
    showView?: (view: string) => void
    suspendInactivityTimer?: () => void
    resumeInactivityTimer?: () => void
  }
}

window.__reactBridge = { mount, unmount, setDashboardTab, setDatabricksTab, refresh }

// Bug real: `react-app.js` (<script type="module">) só executa depois que o
// parsing do documento termina — mais tarde que o <script src="app.js">
// clássico. Se app.js chamar showView() antes disso (restauração automática
// de sessão dispara enterApp() assim que o script carrega, sem esperar
// nenhum evento), `window.__reactBridge` ainda não existia no momento da
// chamada — app.js enfileira o nome da view em `window.__reactBridgeQueuedView`
// nesse caso (ver showView() em app.js). Drena essa fila assim que o bridge
// fica pronto, senão a primeira tela após login/restauração de sessão
// (tipicamente o Dashboard) ficava em branco pra sempre — só uma navegação
// manual seguinte "descobria" o bridge já pronto.
if (window.__reactBridgeQueuedView) {
  mount(window.__reactBridgeQueuedView)
  window.__reactBridgeQueuedView = undefined
}
