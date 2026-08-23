import { render } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import App from './App'

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
});
