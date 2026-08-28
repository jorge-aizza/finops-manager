import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import DatabricksDashboardView from './DatabricksDashboardView'
import * as databricksColetaApi from '../api/databricksColeta'
import type { DatabricksResumo } from '../types/databricksResumo'

vi.mock('../api/databricksColeta')

function makeResumo(overrides: Partial<DatabricksResumo> = {}): DatabricksResumo {
  return {
    periodo: { inicio: '2026-02-25', fim: '2026-08-25' },
    tem_dados: true,
    total_custo: 15000,
    por_mes: [{ mes: '2026-07', custo: 7000 }, { mes: '2026-08', custo: 8000 }],
    por_workspace: [{ workspace_id: 'ws-prod', custo: 10000 }, { workspace_id: 'ws-dev', custo: 5000 }],
    por_sku: [{ sku_name: 'PREMIUM_ALL_PURPOSE_COMPUTE', custo: 9000 }, { sku_name: 'GENIE_FREE_USAGE', custo: 0 }],
    por_usuario: [{ usuario: 'joao@empresa.com', custo: 6000 }, { usuario: 'Não identificado', custo: 2000 }],
    free_vs_pago: { free: 3000, pago: 12000 },
    ...overrides,
  }
}

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DatabricksDashboardView />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.showToast = vi.fn()
  vi.mocked(databricksColetaApi.listDatabricksBudgets).mockResolvedValue([])
  vi.mocked(databricksColetaApi.getDatabricksAnomalias).mockResolvedValue({ custo_diario: [], usuarios: [] })
})

describe('DatabricksDashboardView', () => {
  it('mostra estado vazio quando não há dados no período', async () => {
    vi.mocked(databricksColetaApi.getDatabricksResumo).mockResolvedValue(makeResumo({ tem_dados: false, por_mes: [], por_workspace: [], por_sku: [], por_usuario: [] }))
    renderWithClient()

    expect(await screen.findByText(/Nenhum dado de consumo Databricks no período/)).toBeInTheDocument()
    expect(screen.queryByText('Custo Total no Período')).not.toBeInTheDocument()
  })

  it('renderiza total, free-tier vs. pago e os rankings quando há dados', async () => {
    vi.mocked(databricksColetaApi.getDatabricksResumo).mockResolvedValue(makeResumo())
    renderWithClient()

    expect(await screen.findByText('Custo Total no Período')).toBeInTheDocument()
    expect(screen.getByText('R$ 15.000,00')).toBeInTheDocument()
    // free_vs_pago: 3000/(3000+12000) = 20%
    expect(screen.getByText('20% do consumo')).toBeInTheDocument()
    expect(screen.getByText('ws-prod')).toBeInTheDocument()
    expect(screen.getByText('PREMIUM_ALL_PURPOSE_COMPUTE')).toBeInTheDocument()
    expect(screen.getByText('joao@empresa.com')).toBeInTheDocument()
  })

  it('busca um novo período ao trocar as datas e clicar em "Buscar"', async () => {
    vi.mocked(databricksColetaApi.getDatabricksResumo).mockResolvedValue(makeResumo())
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('Custo Total no Período')

    await user.clear(screen.getByLabelText('De'))
    await user.type(screen.getByLabelText('De'), '2026-01-01')
    await user.click(screen.getByRole('button', { name: 'Buscar' }))

    // Não conta chamadas totais (a view dispara uma 2ª query, sem filtro de período,
    // só pra popular a lista de workspaces do dropdown de orçamento — ver
    // workspacesQuery em DatabricksDashboardView.tsx) — confirma só que a query
    // principal foi refeita com o novo período e os filtros de drill-down (vazios).
    await waitFor(() => expect(databricksColetaApi.getDatabricksResumo).toHaveBeenCalledWith('2026-01-01', expect.any(String), {}))
  })

  it('drill-down: clicar num workspace filtra por ele e mostra chip removível', async () => {
    vi.mocked(databricksColetaApi.getDatabricksResumo).mockResolvedValue(makeResumo())
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('Custo Total no Período')

    await user.click(screen.getByText('ws-prod'))
    await waitFor(() => expect(databricksColetaApi.getDatabricksResumo).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), { workspace_id: 'ws-prod' },
    ))
    expect(await screen.findByText('Detalhando por:')).toBeInTheDocument()
    expect(screen.getByText('Workspace: ws-prod ✕')).toBeInTheDocument()

    // clicar de novo no mesmo item remove o filtro (toggle)
    await user.click(screen.getByText('ws-prod'))
    await waitFor(() => expect(screen.queryByText('Detalhando por:')).not.toBeInTheDocument())
  })

  it('lista orçamentos existentes na tabela', async () => {
    vi.mocked(databricksColetaApi.getDatabricksResumo).mockResolvedValue(makeResumo())
    vi.mocked(databricksColetaApi.listDatabricksBudgets).mockResolvedValue([
      {
        id: 1, nome: 'Orçamento Global', escopo_tipo: 'global', workspace_id: null,
        tag_key: null, tag_valor: null, valor_mensal: 4000, threshold_atencao: 75, threshold_critico: 90,
        ativo: true, criado_em: '', atualizado_em: '',
      },
    ])
    renderWithClient()

    expect(await screen.findByText('Orçamento Global')).toBeInTheDocument()
    expect(screen.getByText('Todos os workspaces')).toBeInTheDocument()
  })
})
