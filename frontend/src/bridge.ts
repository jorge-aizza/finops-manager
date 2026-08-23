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

async function refresh(): Promise<void> {
  await refreshHandler?.()
}

declare global {
  interface Window {
    __reactBridge: { mount: typeof mount; unmount: typeof unmount; setDashboardTab: typeof setDashboardTab; refresh: typeof refresh }
    currentUser?: { nome?: string; email?: string; perfil?: string } | null
    logout?: (pedirConfirmacao?: boolean) => void
    showToast?: (msg: string, type?: 'success' | 'error' | 'warn') => void
    exportarExcel?: () => void
    showView?: (view: string) => void
    suspendInactivityTimer?: () => void
    resumeInactivityTimer?: () => void
  }
}

window.__reactBridge = { mount, unmount, setDashboardTab, refresh }
