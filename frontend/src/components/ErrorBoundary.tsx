import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// Sem isso, um erro de render em QUALQUER componente (ex: .toLocaleString()
// num valor null) desmonta a árvore React inteira — comportamento padrão do
// React desde a v16 — e a tela vira branca sem nenhuma pista do que houve.
// Envolvendo a view (App.tsx), um erro aqui derruba só a view atual, nunca a
// sidebar/top-bar legada nem o resto do app, e mostra o erro real em vez de
// silêncio.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Erro capturado na renderização:', error, info.componentStack)
  }

  componentDidUpdate(_prevProps: Props, prevState: State) {
    // Se o usuário trocou de tela (App.tsx remonta um ViewComponent diferente
    // via `key`), o erro antigo não deve persistir bloqueando a tela nova.
    if (prevState.error && !this.state.error) return
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, maxWidth: 720, margin: '40px auto', color: 'var(--text, #e8eaf0)' }}>
          <div style={{ background: 'var(--bg-card, rgba(12,2,22,.94))', border: '1px solid var(--danger,#ff4d6a)', borderRadius: 12, padding: 24 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--danger,#ff4d6a)', marginBottom: 10 }}>
              ⚠ Erro ao carregar esta tela
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted, #7b6a9e)', marginBottom: 14 }}>
              Algo quebrou ao renderizar este componente. Detalhes abaixo — reporte esta mensagem.
            </div>
            <pre style={{
              fontSize: 12, background: 'var(--bg, #040009)', border: '1px solid var(--border,#1e0040)',
              borderRadius: 8, padding: 12, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
            <button
              className="btn-primary"
              style={{ marginTop: 14 }}
              onClick={() => this.setState({ error: null })}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
