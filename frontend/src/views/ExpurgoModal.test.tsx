import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import ExpurgoModal from './ExpurgoModal'
import * as coletaApi from '../api/coleta'

vi.mock('../api/coleta')

function renderWithClient(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { onClose, ...render(
    <QueryClientProvider client={queryClient}>
      <ExpurgoModal onClose={onClose} />
    </QueryClientProvider>,
  ) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(coletaApi.getAzureResumo).mockResolvedValue({
    resumo: { total: 12000, data_inicio: '2026-07-01', data_fim: '2026-08-20', total_billing: 5000.5, moeda: 'BRL' },
    por_mes: [{ mes: '2026-08', registros: 500, total_billing: 1000 }],
  })
  vi.mocked(coletaApi.getImports).mockResolvedValue([
    { importado_em: '2026-08-01T00:00:00.000Z', arquivo_origem: 'agosto.csv', linhas: 100, periodo_inicio: '2026-08-01', periodo_fim: '2026-08-20', total_billing: 900, moeda: 'BRL' },
  ])
  window.showToast = vi.fn()
})

describe('ExpurgoModal', () => {
  it('carrega o resumo do banco', async () => {
    renderWithClient()
    expect(await screen.findByText('12.000')).toBeInTheDocument()
  });

  it('modo período: verifica e habilita confirmar só depois do preview com total > 0', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.getPurgePreview).mockResolvedValue({ total: 340 })
    renderWithClient()
    await screen.findByText('12.000')

    expect(screen.getByRole('button', { name: /Confirmar Expurgo/ })).toBeDisabled()

    await user.type(screen.getByLabelText('Data início'), '2026-08-01')
    await user.type(screen.getByLabelText('Data fim'), '2026-08-20')
    await user.click(screen.getByRole('button', { name: /Verificar quantos registros/ }))

    expect(await screen.findByText(/340 registros serão removidos/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Confirmar Expurgo/ })).not.toBeDisabled()
  });

  it('modo período: confirmar pede confirmação e chama executarPurge com as datas', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(coletaApi.getPurgePreview).mockResolvedValue({ total: 10 })
    vi.mocked(coletaApi.executarPurge).mockResolvedValue({ message: '10 registros removidos.', removidos: 10 })
    renderWithClient()
    await screen.findByText('12.000')

    await user.type(screen.getByLabelText('Data início'), '2026-08-01')
    await user.type(screen.getByLabelText('Data fim'), '2026-08-20')
    await user.click(screen.getByRole('button', { name: /Verificar quantos registros/ }))
    await screen.findByText(/10 registros serão removidos/)

    await user.click(screen.getByRole('button', { name: /Confirmar Expurgo/ }))

    await waitFor(() => expect(coletaApi.executarPurge).toHaveBeenCalledWith({ data_inicio: '2026-08-01', data_fim: '2026-08-20' }))
    expect(await screen.findByText(/10 registros removidos/)).toBeInTheDocument()
  });

  it('modo "tudo": confirmar fica habilitado sem precisar verificar antes', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('12.000')

    await user.click(screen.getByLabelText('Todos os dados'))
    expect(screen.getByRole('button', { name: /Confirmar Expurgo/ })).not.toBeDisabled()
  });

  it('modo arquivo: lista os imports reais no select e verifica por arquivo', async () => {
    const user = userEvent.setup()
    vi.mocked(coletaApi.getPurgePreview).mockResolvedValue({ total: 100 })
    renderWithClient()
    await screen.findByText('12.000')

    await user.click(screen.getByLabelText('Por arquivo importado'))
    await user.selectOptions(screen.getByRole('combobox'), 'agosto.csv')
    await user.click(screen.getByRole('button', { name: '🔍 Verificar' }))

    await waitFor(() => expect(coletaApi.getPurgePreview).toHaveBeenCalledWith({ arquivo: 'agosto.csv' }))
  });
});
