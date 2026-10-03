import { useEffect, useState, type ComponentType } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setRefreshHandler, setViewListener } from './bridge'
import ProjetosView from './views/ProjetosView'
import ReservasView from './views/ReservasView'
import AcoesView from './views/AcoesView'
import ColetaView from './views/ColetaView'
import EstimativasView from './views/EstimativasView'
import DashboardView from './views/DashboardView'
import CalculadoraView from './views/CalculadoraView'
import DatabricksDashboardView from './views/DatabricksDashboardView'
import InventarioView from './views/InventarioView'
import AlocacaoView from './views/AlocacaoView'
import LogAnalyticsView from './views/LogAnalyticsView'
import DatabricksBudgetAlertModal from './components/DatabricksBudgetAlertModal'
import ErrorBoundary from './components/ErrorBoundary'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

// Cresce a cada tela migrada — ver "Ordem de migração" no plano.
const VIEWS: Record<string, ComponentType> = {
  projetos: ProjetosView,
  reservas: ReservasView,
  acoes: AcoesView,
  coleta: ColetaView,
  estimativas: EstimativasView,
  dashboard: DashboardView,
  calculadora: CalculadoraView,
  databricks: DatabricksDashboardView,
  inventario: InventarioView,
  alocacao: AlocacaoView,
  'log-analytics': LogAnalyticsView,
}

export default function App() {
  const [view, setView] = useState<string | null>(null)
  // Latch, não espelho de `view` — `view` some (null) sempre que o usuário
  // navega pra uma view legada ainda não migrada (bridge unmount()), mas o
  // popup de alerta de orçamento Databricks deve continuar montado (com seu
  // próprio estado de "já mostrei/dispensei") pelo resto da sessão, não
  // desmontar/remontar (e reabrir) a cada ida-e-volta entre view migrada e
  // legada. Vira true na primeira vez que qualquer view monta — proxy de
  // "usuário autenticado e dentro do app", já que a query de alertas exige
  // authMiddleware e não faz sentido disparar antes do login.
  const [autenticado, setAutenticado] = useState(false)

  useEffect(() => {
    setViewListener((v) => { setView(v); if (v) setAutenticado(true) })
    // Botão "Atualizar"/countdown de auto-refresh (app.js, manualRefresh()) —
    // invalida tudo; só as queries ativas (da view montada no momento) de
    // fato refazem a chamada de rede, então isso vale pra qualquer tela.
    setRefreshHandler(() => queryClient.invalidateQueries())
  }, [])

  const ViewComponent = view ? VIEWS[view] : undefined

  return (
    <QueryClientProvider client={queryClient}>
      {ViewComponent ? (
        // `key={view}` reseta o ErrorBoundary ao trocar de tela — sem isso,
        // um erro numa view ficaria "preso" mesmo navegando pra outra.
        <ErrorBoundary key={view}>
          <ViewComponent />
        </ErrorBoundary>
      ) : null}
      {autenticado && (
        <ErrorBoundary>
          <DatabricksBudgetAlertModal />
        </ErrorBoundary>
      )}
    </QueryClientProvider>
  )
}
