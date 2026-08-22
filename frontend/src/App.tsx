import { useEffect, useState, type ComponentType } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setViewListener } from './bridge'
import ProjetosView from './views/ProjetosView'
import ReservasView from './views/ReservasView'
import AcoesView from './views/AcoesView'
import ColetaView from './views/ColetaView'
import EstimativasView from './views/EstimativasView'
import DashboardView from './views/DashboardView'

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
}

export default function App() {
  const [view, setView] = useState<string | null>(null)

  useEffect(() => {
    setViewListener(setView)
  }, [])

  const ViewComponent = view ? VIEWS[view] : undefined

  return (
    <QueryClientProvider client={queryClient}>
      {ViewComponent ? <ViewComponent /> : null}
    </QueryClientProvider>
  )
}
