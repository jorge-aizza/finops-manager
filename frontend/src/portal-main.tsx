import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import PortalApp from './PortalApp.tsx'

// Bundle separado do app autenticado (react-app.js) — usuários anônimos do
// Portal Público não devem baixar o código das 7 telas internas. Monta em
// #portal-root, que existe no portal.html (produção) servido pelo Express.
const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: false } },
})

const container = document.getElementById('portal-root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <PortalApp />
      </QueryClientProvider>
    </StrictMode>,
  )
} else {
  console.error('portal-app: #portal-root não encontrado em portal.html')
}
