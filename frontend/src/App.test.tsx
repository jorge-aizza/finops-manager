import { act, render, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import App from './App'

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
