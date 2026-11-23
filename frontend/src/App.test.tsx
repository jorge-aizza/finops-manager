import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import App, { FinOpsQueryLoadingNotice } from './App'

const wikiModuleLoaded = vi.hoisted(() => vi.fn())
vi.mock('./views/WikiView', () => {
  wikiModuleLoaded()
  return { default: () => <div>Wiki carregada</div> }
})

// manualRefresh() (app.js) chama window.__reactBridge.refresh() pro botão
// "Atualizar"/countdown de auto-refresh — verifica que App.tsx registra um
// handler que de fato invalida as queries do QueryClient usado pelas views.
describe('App — bridge de refresh (window.__reactBridge.refresh)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('window.__reactBridge.refresh() invalida as queries do QueryClient', async () => {
    const spy = vi.spyOn(QueryClient.prototype, 'invalidateQueries')
    render(<App />)

    expect(window.__reactBridge).toBeDefined()
    await window.__reactBridge.refresh()

    expect(spy).toHaveBeenCalled()
  });

  it('carrega a Wiki sob demanda ao navegar para a tela', async () => {
    render(<App />)

    expect(wikiModuleLoaded).not.toHaveBeenCalled()
    await act(async () => window.__reactBridge.mount('wiki'))

    expect(await screen.findByText('Wiki carregada')).toBeInTheDocument()
    expect(wikiModuleLoaded).toHaveBeenCalledOnce()
  })

  it('sinaliza quando a primeira tela do app é montada', async () => {
    const listener = vi.fn()
    window.addEventListener('finops:app-view-mounted', listener)
    render(<App />)

    await act(async () => window.__reactBridge.mount('dashboard'))

    expect(listener).toHaveBeenCalled()
    window.removeEventListener('finops:app-view-mounted', listener)
  })
});

describe('FinOpsQueryLoadingNotice', () => {
  it('só aparece quando uma consulta inicial continua carregando por 2 segundos', async () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function PendingQuery() {
      useQuery({ queryKey: ['pending-notice-test'], queryFn: () => new Promise<never>(() => {}) })
      return null
    }

    render(
      <QueryClientProvider client={queryClient}>
        <PendingQuery />
        <FinOpsQueryLoadingNotice />
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(1999) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('status')).toHaveTextContent('Consultando...')
    queryClient.clear()
    vi.useRealTimers()
  })

  it('não cobre a tela durante uma atualização que já tem dados em cache', async () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['cached-query-notice-test'], ['dados existentes'])
    function PendingRefresh() {
      useQuery({ queryKey: ['cached-query-notice-test'], queryFn: () => new Promise<never>(() => {}) })
      return null
    }

    render(
      <QueryClientProvider client={queryClient}>
        <PendingRefresh />
        <FinOpsQueryLoadingNotice />
      </QueryClientProvider>,
    )

    await act(async () => { vi.advanceTimersByTime(2500) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    queryClient.clear()
    vi.useRealTimers()
  })
})
