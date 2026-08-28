import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import DatabricksDashboardView from './DatabricksDashboardView'
import * as databricksColetaApi from '../api/databricksColeta'
import * as genieBudgetsApi from '../api/genieBudgets'
import type { DatabricksResumo } from '../types/databricksResumo'

vi.mock('../api/databricksColeta')
vi.mock('../api/genieBudgets')

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
    por_job: [], por_cluster: [], por_warehouse: [],
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
  vi.mocked(genieBudgetsApi.listGenieBudgets).mockResolvedValue([])
  // `bridge.ts` mantém currentDatabricksTab como estado de módulo (singleton) — sem
  // resetar aqui, um teste que troca de aba (Orçamentos/Quotas) vaza pro próximo.
  window.__reactBridge?.setDatabricksTab('dashboard')
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

  it('mostra Por Job/Cluster/Warehouse (agregado sobre usage_metadata) e permite drill-down por job', async () => {
    vi.mocked(databricksColetaApi.getDatabricksResumo).mockResolvedValue(makeResumo({
      por_job: [{ job_id: '123', job_name: 'ETL Noturno', custo: 4000 }, { job_id: '456', job_name: null, custo: 1000 }],
      por_cluster: [{ cluster_id: 'cl-abc', custo: 3000 }],
      por_warehouse: [{ warehouse_id: 'wh-xyz', custo: 2000 }],
    }))
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('Custo Total no Período')

    expect(screen.getByText('ETL Noturno')).toBeInTheDocument()
    expect(screen.getByText('456')).toBeInTheDocument() // sem job_name, cai pro job_id
    expect(screen.getByText('cl-abc')).toBeInTheDocument()
    expect(screen.getByText('wh-xyz')).toBeInTheDocument()

    await user.click(screen.getByText('ETL Noturno'))
    await waitFor(() => expect(databricksColetaApi.getDatabricksResumo).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), { job_id: '123' },
    ))
  })

  it('lista orçamentos existentes na tabela (aba Orçamentos e Anomalias)', async () => {
    vi.mocked(databricksColetaApi.getDatabricksResumo).mockResolvedValue(makeResumo())
    vi.mocked(databricksColetaApi.listDatabricksBudgets).mockResolvedValue([
      {
        id: 1, nome: 'Orçamento Global', escopo_tipo: 'global', workspace_id: null,
        tag_key: null, tag_valor: null, valor_mensal: 4000, threshold_atencao: 75, threshold_critico: 90,
        ativo: true, criado_em: '', atualizado_em: '',
      },
    ])
    window.__reactBridge.setDatabricksTab('orcamentos')
    renderWithClient()

    expect(await screen.findByText('Orçamento Global')).toBeInTheDocument()
    expect(screen.getByText('Todos os workspaces')).toBeInTheDocument()
  })

  it('lista quotas Genie e mostra o badge de bloqueio quando aplicável (aba Quotas)', async () => {
    vi.mocked(databricksColetaApi.getDatabricksResumo).mockResolvedValue(makeResumo())
    vi.mocked(genieBudgetsApi.listGenieBudgets).mockResolvedValue([
      {
        budget_configuration_id: 'gb-1', display_name: 'Quota Genie Bloqueio', resource_type: 'BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY',
        alert_configurations: [{
          quantity_threshold: '500', scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED',
          action_configurations: [{ action_type: 'BLOCK_USAGE' }],
        }],
      },
    ])
    window.__reactBridge.setDatabricksTab('quotas')
    renderWithClient()

    expect(await screen.findByText('Quota Genie Bloqueio')).toBeInTheDocument()
    expect(screen.getByText('🚫 Bloqueia')).toBeInTheDocument()
  })

  it('mostra o banner de modo demonstração quando os budgets vêm com _demo:true', async () => {
    vi.mocked(databricksColetaApi.getDatabricksResumo).mockResolvedValue(makeResumo())
    vi.mocked(genieBudgetsApi.listGenieBudgets).mockResolvedValue([
      {
        budget_configuration_id: 'demo-001', display_name: 'Quota Fictícia', resource_type: 'BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY',
        alert_configurations: [{ quantity_threshold: '100', scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED', action_configurations: [{ action_type: 'EMAIL_NOTIFICATION' }] }],
        _demo: true,
      },
    ])
    window.__reactBridge.setDatabricksTab('quotas')
    renderWithClient()

    expect(await screen.findByText(/Modo demonstração/)).toBeInTheDocument()
  })

  it('não mostra o banner de demonstração quando os budgets são reais (sem _demo)', async () => {
    vi.mocked(databricksColetaApi.getDatabricksResumo).mockResolvedValue(makeResumo())
    vi.mocked(genieBudgetsApi.listGenieBudgets).mockResolvedValue([
      {
        budget_configuration_id: 'gb-real', display_name: 'Quota Real', resource_type: 'BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY',
        alert_configurations: [{ quantity_threshold: '100', scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED', action_configurations: [{ action_type: 'EMAIL_NOTIFICATION' }] }],
      },
    ])
    window.__reactBridge.setDatabricksTab('quotas')
    renderWithClient()

    await screen.findByText('Quota Real')
    expect(screen.queryByText(/Modo demonstração/)).not.toBeInTheDocument()
  })

  it('botão Editar abre o modal de Quota Genie pré-preenchido com os dados do budget', async () => {
    vi.mocked(databricksColetaApi.getDatabricksResumo).mockResolvedValue(makeResumo())
    vi.mocked(genieBudgetsApi.listGenieBudgets).mockResolvedValue([
      {
        budget_configuration_id: 'gb-9', display_name: 'Quota pra Editar', resource_type: 'BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY',
        alert_configurations: [{
          quantity_threshold: '300', scope_type: 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED',
          action_configurations: [{ action_type: 'EMAIL_NOTIFICATION' }],
        }],
      },
    ])
    const user = userEvent.setup()
    window.__reactBridge.setDatabricksTab('quotas')
    renderWithClient()

    await screen.findByText('Quota pra Editar')
    await user.click(screen.getByRole('button', { name: 'Editar' }))

    expect(await screen.findByText('🧞 Editar Quota Genie')).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveValue('Quota pra Editar')
    expect(screen.getByLabelText('Limite mensal (US$)')).toHaveValue(300)
  })

  it('mostra a mensagem de erro do servidor quando a conexão padrão não é OAuth M2M (aba Quotas)', async () => {
    vi.mocked(databricksColetaApi.getDatabricksResumo).mockResolvedValue(makeResumo())
    vi.mocked(genieBudgetsApi.listGenieBudgets).mockRejectedValue(new Error('A conexão padrão usa modo PAT — quotas Genie exigem OAuth M2M com Account Admin.'))
    window.__reactBridge.setDatabricksTab('quotas')
    renderWithClient()

    expect(await screen.findByText(/exigem OAuth M2M com Account Admin/)).toBeInTheDocument()
  })

  it('troca de aba via setDatabricksTabListener (ponte com o sidebar legado)', async () => {
    vi.mocked(databricksColetaApi.getDatabricksResumo).mockResolvedValue(makeResumo())
    renderWithClient()
    await screen.findByText('Custo Total no Período')

    window.__reactBridge.setDatabricksTab('orcamentos')
    expect(await screen.findByText('Orçamentos')).toBeInTheDocument()
    expect(screen.queryByText('Custo Total no Período')).not.toBeInTheDocument()

    window.__reactBridge.setDatabricksTab('quotas')
    expect(await screen.findByText(/Quotas Genie \(Databricks nativo\)/)).toBeInTheDocument()
  })
})
