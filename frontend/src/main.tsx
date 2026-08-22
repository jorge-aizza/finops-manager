import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './bridge'
import App from './App.tsx'

// Monta uma única vez em #react-root (existe sempre no index.html do shell
// legado). App.tsx decide o que renderizar via a ponte (bridge.ts) —
// não desmonta/remonta a cada troca de tela, só troca o componente ativo.
const container = document.getElementById('react-root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
} else {
  console.error('react-app: #react-root não encontrado em index.html')
}
