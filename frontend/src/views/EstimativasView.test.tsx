import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import EstimativasView from './EstimativasView'
import * as estimativasApi from '../api/estimativas'
import type { Estimativa, EstimativaResumo } from '../types/estimativa'

vi.mock('../api/estimativas')

const mockList: EstimativaResumo[] = [
  {
    id: 1, projeto_id: 5, projeto_nome: 'Projeto Alpha', numero: 'EST-100001', titulo: 'Estimativa Azure',
    responsavel: 'Ana Souza', validade_dias: 5, data_estimativa: '2026-08-15', horas: 720,
    pct_imposto: 8.5, pct_cond: 0, vl_imposto: 1234.56, vl_cond: 0,
    total_brl: 14523.1, total_final: 15757.66, observacoes: 'Ambiente de POC',
    status: 'Pendente', criado_em: '2026-08-15T13:22:01.000Z', atualizado_em: '2026-08-15T13:22:01.000Z',
    projeto_nome_atual: 'Projeto Alpha',
  },
]

const mockDetalhe: Estimativa = {
  ...mockList[0],
  recursos: [
    {
      resource_id: 'r1', nome: 'VM produção', sku: 'Standard_D4s_v3', categoria: 'Virtual Machines',
      consumed_service: 'Microsoft.Compute', resource_group: 'RG-PROD', uom: '1 Hour',
      tipo_custo: 'hora', fixo_mensal: false, isHora: true, horas: 720, custo_hora: 2.5,
      fonte_estimado: 'billing', custo_mes: 1800, dias_ativos: 30, total_cobrado: 1800,
      estimado_brl: 1800, moeda: 'BRL',
    },
  ],
}

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <EstimativasView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(estimativasApi.listEstimativas).mockResolvedValue(mockList)
  vi.mocked(estimativasApi.getEstimativa).mockResolvedValue(mockDetalhe)
})

describe('EstimativasView', () => {
  it('lista as estimativas vindas da API', async () => {
    renderWithClient()
    const row = (await screen.findByText('EST-100001')).closest('tr')!
    expect(row).toHaveTextContent('Projeto Alpha')
    expect(row).toHaveTextContent('R$ 15.757,66')
  });

  it('mostra estado vazio quando não há estimativas', async () => {
    vi.mocked(estimativasApi.listEstimativas).mockResolvedValue([])
    renderWithClient()
    expect(await screen.findByText('Nenhuma estimativa encontrada')).toBeInTheDocument()
  });

  it('filtra por texto de busca', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('EST-100001')

    await user.type(screen.getByPlaceholderText('Buscar por número, projeto, título...'), 'inexistente')
    expect(screen.getByText('Nenhuma estimativa encontrada')).toBeInTheDocument()
  });

  it('abre o detalhe e mostra os recursos', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('EST-100001')

    await user.click(screen.getByTitle('Ver detalhes'))

    expect(await screen.findByText('VM produção')).toBeInTheDocument()
    expect(screen.getByText('Standard_D4s_v3')).toBeInTheDocument()
  });

  it('aprova uma estimativa a partir da tabela', async () => {
    const user = userEvent.setup()
    vi.mocked(estimativasApi.setEstimativaStatus).mockResolvedValue(mockDetalhe)
    renderWithClient()
    const row = (await screen.findByText('EST-100001')).closest('tr')!

    await user.click(within(row).getByTitle('Aprovar'))

    await waitFor(() => expect(estimativasApi.setEstimativaStatus).toHaveBeenCalledWith(1, 'Aprovado'))
  });

  it('exclui uma estimativa após confirmação', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.mocked(estimativasApi.deleteEstimativa).mockResolvedValue({ message: 'ok' })
    renderWithClient()
    const row = (await screen.findByText('EST-100001')).closest('tr')!

    await user.click(within(row).getByTitle('Excluir'))

    await waitFor(() => expect(estimativasApi.deleteEstimativa).toHaveBeenCalledWith(1))
  });
});
