import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import RecursoDetalheModal from './RecursoDetalheModal'
import * as azureInventarioApi from '../api/azureInventario'
import * as calculadoraApi from '../api/calculadora'

vi.mock('../api/azureInventario')
vi.mock('../api/calculadora')

function renderModal() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <RecursoDetalheModal resourceId="/subscriptions/s1/vm1" subscriptionId="s1" onClose={() => {}} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(calculadoraApi.listSubscriptions).mockResolvedValue([])
  vi.mocked(azureInventarioApi.getAzurePropriedadeHistorico).mockResolvedValue({ periodo: { inicio: '', fim: '' }, total: 0, mudancas: [] })
})

describe('RecursoDetalheModal — mensagem de erro', () => {
  it('404 do servidor mostra "Recurso não encontrado" e não oferece tentar de novo', async () => {
    vi.mocked(azureInventarioApi.getAzureRecursoDetalhe).mockRejectedValue(new Error('Recurso não encontrado no inventário'))
    renderModal()
    expect(await screen.findByText('Recurso não encontrado no inventário.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument()
  })

  it('timeout/erro de rede NÃO diz "não encontrado": mostra o motivo e permite tentar de novo', async () => {
    vi.mocked(azureInventarioApi.getAzureRecursoDetalhe)
      .mockRejectedValueOnce(new Error('Servidor não respondeu em 30s — verifique se o servidor está rodando'))
    renderModal()
    expect(await screen.findByText(/Não foi possível carregar o detalhe do recurso/)).toBeInTheDocument()
    expect(screen.queryByText('Recurso não encontrado no inventário.')).not.toBeInTheDocument()

    vi.mocked(azureInventarioApi.getAzureRecursoDetalhe).mockRejectedValueOnce(new Error('falha 2'))
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(await screen.findByText(/falha 2/)).toBeInTheDocument()
    expect(azureInventarioApi.getAzureRecursoDetalhe).toHaveBeenCalledTimes(2)
  })
})
