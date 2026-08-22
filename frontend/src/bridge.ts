// Ponte entre o shell legado (app.js / showView()) e o React.
// app.js chama window.__reactBridge.mount(view) quando o usuário navega pra
// uma tela já migrada; App.tsx escuta essa mudança via setViewListener().
// Ver "Arquitetura: ponte (bridge) strangler-fig" no plano.

export type ViewChangeListener = (view: string | null) => void
export type DashboardTabListener = (tab: string) => void

let currentView: string | null = null
let listener: ViewChangeListener | null = null

// Dashboard tem duas sub-abas (Ações/Estimativas) trocadas pelo sub-nav da
// sidebar sem passar por showView() de novo — precisa de um canal próprio,
// separado do mount/unmount genérico usado pelas demais telas migradas.
let currentDashboardTab = 'acoes'
let dashboardTabListener: DashboardTabListener | null = null

export function setViewListener(fn: ViewChangeListener): void {
  listener = fn
  fn(currentView)
}

export function setDashboardTabListener(fn: DashboardTabListener): void {
  dashboardTabListener = fn
  fn(currentDashboardTab)
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

declare global {
  interface Window {
    __reactBridge: { mount: typeof mount; unmount: typeof unmount; setDashboardTab: typeof setDashboardTab }
    currentUser?: { nome?: string; email?: string; perfil?: string } | null
    logout?: (pedirConfirmacao?: boolean) => void
    showToast?: (msg: string, type?: 'success' | 'error' | 'warn') => void
    exportarExcel?: () => void
    showView?: (view: string) => void
  }

  // `calculadora.js` declara `const Calculadora = (() => {...})()` no escopo
  // top-level de um <script> clássico — bindings const/let de script top-level
  // NUNCA viram propriedade de `window` (só var/function declarations viram),
  // mas continuam resolvíveis como identificador global "solto" via escopo
  // léxico (visível até de dentro de um <script type="module">, já que
  // módulos compartilham o global lexical environment do realm). Por isso o
  // acesso correto é `typeof Calculadora !== 'undefined'` / `Calculadora.x`,
  // NUNCA `window.Calculadora` (sempre undefined) — mesmo padrão de app.js.
  // Só `init` é chamado por código React hoje — PortalApp.tsx (Portal
  // Público, calculadora pública ainda 100% legada). O fluxo de PDF/invoice
  // (antes `abrirInvoiceExterno`/`gerarPDFSalvo`) foi portado pra
  // frontend/src/lib/buildPdfHtml.ts + InvoiceModal/InvoicePreviewModal e
  // removido do calculadora.js — não bridgeado mais.
  // eslint-disable-next-line no-var
  var Calculadora: {
    init: (opts?: unknown) => void
  } | undefined
}

window.__reactBridge = { mount, unmount, setDashboardTab }
