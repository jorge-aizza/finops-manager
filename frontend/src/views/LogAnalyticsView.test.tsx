import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TenantFilterProvider } from '../contexts/TenantFilterContext'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import LogAnalyticsView from './LogAnalyticsView'
import * as logAnalyticsApi from '../api/logAnalytics'
import * as coletaApi from '../api/coleta'
import type {
  LogAnalyticsWorkspace, LogAnalyticsResumo, LogAnalyticsRecomendacao, LogAnalyticsTabelasResposta,
  LogAnalyticsFontesResposta, LogAnalyticsCustoObservabilidade, LogAnalyticsExportResposta,
  LogAnalyticsRecursosVolumeResposta, LogAnalyticsAppInsights, LogAnalyticsDiagnosticSetting,
} from '../api/logAnalytics'

vi.mock('../api/logAnalytics')
vi.mock('../api/coleta')

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <TenantFilterProvider>
        <LogAnalyticsView />
      </TenantFilterProvider>
    </QueryClientProvider>,
  )
  return { ...rendered, queryClient }
}

// "LA-SharedServices-PROD" aparece em até 4 lugares ao mesmo tempo (ranking, dropdown de
// workspace, legenda do gráfico, linha da tabela) — qualquer findByText/getByText por esse
// nome quebra com "multiple elements". `resource_group` só existe na tabela, então serve de
// sinal único de "a lista carregou" sem precisar de `getAllByText`; pra clicar na linha, o role
// `cell` isola o <td> da tabela do <option> do dropdown (mesmo texto, roles diferentes).
const linhaWorkspace = (nome: string) => screen.getByRole('cell', { name: nome })

// Dois workspaces: um em Capacity Reservation com Sentinel (espelha LA-SharedServices-PROD,
// que motivou boa parte do motor de Commitment Tier), outro simples em PAYG — cobertura total
// do mês inteiro (dias_com_gb === dias_janela), pra não disparar o aviso de cobertura parcial
// por acidente nos testes que não testam isso.
const wsSharedServices: LogAnalyticsWorkspace = {
  resource_id: '/subscriptions/sub-1/resourcegroups/rg-shared/providers/microsoft.operationalinsights/workspaces/la-sharedservices-prod',
  workspace_guid: 'guid-shared', subscription_id: 'sub-1', resource_group: 'rg-shared',
  nome: 'LA-SharedServices-PROD', retencao_dias: 90, sku: 'capacityreservation', daily_cap_gb: null,
  atualizado_em: '2026-10-10T00:00:00.000Z',
  ingestao_mes_gb: 6000, recomendacoes_abertas: 1, tabelas_retencao_customizada: 2,
  custo_mes_total: 10000, custo_mes_ingestao: 3000, custo_mes_retencao: 0,
  custo_mes_sentinel: 4000, custo_mes_commitment: 3000,
  economia_commitment_tier_periodo: 500, ingestao_media_gb_dia: 200,
  retencao_gb_faturado: 0, dias_com_gb: 30, dias_janela: 30,
}
const wsBasic: LogAnalyticsWorkspace = {
  resource_id: '/subscriptions/sub-1/resourcegroups/rg-app/providers/microsoft.operationalinsights/workspaces/ws-app-prod',
  workspace_guid: 'guid-basic', subscription_id: 'sub-1', resource_group: 'rg-app',
  nome: 'ws-app-prod', retencao_dias: 30, sku: 'PerGB2018', daily_cap_gb: null,
  atualizado_em: '2026-10-10T00:00:00.000Z',
  ingestao_mes_gb: 500, recomendacoes_abertas: 0, tabelas_retencao_customizada: 0,
  custo_mes_total: 1250, custo_mes_ingestao: 1200, custo_mes_retencao: 50,
  custo_mes_sentinel: 0, custo_mes_commitment: 0,
  economia_commitment_tier_periodo: null, ingestao_media_gb_dia: 16.67,
  retencao_gb_faturado: 20, dias_com_gb: 30, dias_janela: 30,
}
const mockWorkspaces: LogAnalyticsWorkspace[] = [wsSharedServices, wsBasic]

const mockResumo: LogAnalyticsResumo = {
  mes: '2026-10', mes_label: 'Outubro/2026',
  kpis: {
    subsNoEscopo: 1, workspaces: 2, gbIngeridoMes: 6500, custoRealMes: 11000,
    economiaCommitmentTierMes: 500, tabelasRetencaoAlta: 2, recursosComDiagSetting: 1, dcrsMapeadas: 0,
  },
  custo_consolidado_ate: '2026-10-09',
  custoPorWorkspace: [{ label: 'LA-SharedServices-PROD', valor: 10000 }],
  topTabelas: [{ label: 'AzureDiagnostics', valor: 1536.2 }],
  fontes: [{ label: 'Diagnostic Setting', valor: 10 }],
  distribuicaoRetencao: [{ label: '90 dias', valor: 2 }],
}

const mockRecomendacoes: LogAnalyticsRecomendacao[] = [
  {
    id: 1, workspace_guid: 'guid-shared', workspace_nome: 'LA-SharedServices-PROD', subscription_id: 'sub-1',
    regra: 'commitment_tier_sentinel', severidade: 'critico',
    detalhe: 'O Sentinel deste workspace está em Pay-As-You-Go — contratar o tier de 200 GB/dia economizaria ~R$ 22.980,64/mês.',
    criado_em: '2026-10-10T21:00:00.000Z',
  },
]

const mockObservabilidade: LogAnalyticsCustoObservabilidade = {
  mes: '2026-10', mes_label: 'Outubro/2026', total: 0, coberto_pela_tela: 0, coberto_pct: null,
  workspaces_no_recorte: null, baldes: [],
}
const mockExportSemWs: LogAnalyticsExportResposta = {
  mes: '2026-10', mes_label: 'Outubro/2026', total: 0, sem_workspace: 0, itens: [],
}
const mockFontes: LogAnalyticsFontesResposta = { fontes: [], diagnostic_settings_atualizado_em: null }
const mockDiagSettings: LogAnalyticsDiagnosticSetting[] = []
const mockAppInsights: LogAnalyticsAppInsights[] = []
const mockRecursosVolume: LogAnalyticsRecursosVolumeResposta = {
  tabelas_sem_atribuicao: [], cobertura_pct: null, recursos: [],
}

const mockTabelasResposta: LogAnalyticsTabelasResposta = {
  auditoria_consultas_habilitada: false,
  taxas: {
    analytics: 17.36, basic: 4.43, sentinel_analytics: 17.71, sentinel_basic: 2.21,
    gb_analytics_total: 35.07, gb_basic_total: 6.64, tem_sentinel: true,
    cobranca_via_commitment: true, origem_taxa_basic: 'workspace', fator: 5.28,
  },
  commitment: {
    suficiente: true, dias: 41, media: 180.2, p25: 163.2, p75: 226.2,
    tier_atual: 100, em_commitment: true,
    ingestao: {
      fator_calibragem: 4.42, taxa_real_gb: 17.36, custo_atual_mes: 99764.19, payg_gb_estimado: 76.8,
      opcoes: [
        { gb_dia: 100, preco_gb_estimado: 17.36, custo_mes_estimado: 99764.19, dias_ociosos: 6, atual: true, economia_mes_estimada: 0 },
        { gb_dia: 200, preco_gb_estimado: 16.29, custo_mes_estimado: 105087.67, dias_ociosos: 19, atual: false, economia_mes_estimada: -5323.48 },
      ],
      recomendado: null, tendencia: null,
    },
    sentinel: {
      em_commitment: false, fator_calibragem: 2.06, taxa_real_gb: 17.71, custo_atual_mes: 95770.02,
      opcoes: [
        { gb_dia: 200, preco_gb_estimado: 11.11, custo_mes_estimado: 71646.51, dias_ociosos: 19, atual: false, economia_mes_estimada: 22619.82 },
      ],
      recomendado: { gb_dia: 200, preco_gb_estimado: 11.11, custo_mes_estimado: 71646.51, dias_ociosos: 19, atual: false, economia_mes_estimada: 22619.82 },
      tendencia: null,
    },
    historico: [],
  },
  tabelas: [
    {
      tabela: 'AzureDiagnostics', plano: 'Analytics', retencao_dias: 90, retencao_total_dias: 90,
      retencao_arquivo_dias: null, retencao_e_padrao: true, gb_mes: 1536.2,
      custo_ingestao_estimado: 26666, custo_retencao_estimado: 0,
      consultas_30d: null, gb_escaneado_30d: null, ultima_consulta: null,
      custo_gb_atual: 35.07, custo_gb_se_basic: 6.64, economia_periodo_se_basic: 43670.17,
      ja_em_basico: false, custo_sentinel_estimado: 27208.83, nativa_sentinel: false,
    },
    {
      tabela: 'SecurityAlert', plano: 'Analytics', retencao_dias: 90, retencao_total_dias: 90,
      retencao_arquivo_dias: null, retencao_e_padrao: true, gb_mes: 0.1,
      custo_ingestao_estimado: 2, custo_retencao_estimado: 0,
      consultas_30d: null, gb_escaneado_30d: null, ultima_consulta: null,
      custo_gb_atual: 35.07, custo_gb_se_basic: 6.64, economia_periodo_se_basic: 3,
      ja_em_basico: false, custo_sentinel_estimado: 76.87, nativa_sentinel: true,
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  window.showToast = vi.fn()
  vi.mocked(coletaApi.listSPs).mockResolvedValue([])
  // A barra de progresso das coletas consulta isto ao montar; sem o default a query resolve
  // undefined e o React Query reclama em toda renderização da tela.
  vi.mocked(logAnalyticsApi.getProgressoLogAnalytics).mockResolvedValue({ execucoes: [] })
  vi.mocked(logAnalyticsApi.getLogAnalyticsWorkspaces).mockResolvedValue(mockWorkspaces)
  vi.mocked(logAnalyticsApi.getLogAnalyticsResumo).mockResolvedValue(mockResumo)
  vi.mocked(logAnalyticsApi.getLogAnalyticsRecomendacoes).mockResolvedValue(mockRecomendacoes)
  vi.mocked(logAnalyticsApi.getLogAnalyticsCustoObservabilidade).mockResolvedValue(mockObservabilidade)
  vi.mocked(logAnalyticsApi.getLogAnalyticsExportSemWorkspace).mockResolvedValue(mockExportSemWs)
  vi.mocked(logAnalyticsApi.getLogAnalyticsAppInsights).mockResolvedValue(mockAppInsights)
  vi.mocked(logAnalyticsApi.getLogAnalyticsTabelas).mockResolvedValue(mockTabelasResposta)
  vi.mocked(logAnalyticsApi.getLogAnalyticsFontes).mockResolvedValue(mockFontes)
  vi.mocked(logAnalyticsApi.getLogAnalyticsDiagnosticSettings).mockResolvedValue(mockDiagSettings)
  vi.mocked(logAnalyticsApi.getLogAnalyticsRecursosVolume).mockResolvedValue(mockRecursosVolume)
})

describe('LogAnalyticsView', () => {
  it('mostra "Carregando..." enquanto os workspaces não chegam', () => {
    vi.mocked(logAnalyticsApi.getLogAnalyticsWorkspaces).mockReturnValue(new Promise(() => {}))
    renderWithClient()
    expect(screen.getAllByText('Carregando...').length).toBeGreaterThan(0)
  })

  it('mostra o estado vazio quando não há workspace descoberto ainda', async () => {
    vi.mocked(logAnalyticsApi.getLogAnalyticsWorkspaces).mockResolvedValue([])
    renderWithClient()
    expect(await screen.findByText(/Nenhum workspace descoberto ainda/)).toBeInTheDocument()
  })

  it('soma os KPIs de todos os workspaces, inclusive Sentinel e Commitment Tier', async () => {
    renderWithClient()
    await screen.findByText('rg-shared') // sinal de que a tabela carregou
    // custo_mes_total: 10000 + 1250
    expect(screen.getByText('R$ 11.250,00')).toBeInTheDocument()
    // custo_mes_ingestao: 3000 + 1200 — sem Sentinel/Commitment misturado dentro, ao contrário
    // do que acontecia antes da etapa B0 (ver commit ec31e22)
    expect(screen.getByText('R$ 4.200,00')).toBeInTheDocument()
    // custo_mes_sentinel: só o workspace com Sentinel
    expect(screen.getByText('Custo Sentinel (Outubro/2026)')).toBeInTheDocument()
    expect(screen.getByText('R$ 4.000,00')).toBeInTheDocument()
    expect(screen.getByText('Commitment Tier (Outubro/2026)')).toBeInTheDocument()
    expect(screen.getByText('R$ 3.000,00')).toBeInTheDocument() // custo_mes_commitment
    expect(screen.getByText('R$ 50,00')).toBeInTheDocument() // custo_mes_retencao: 0 + 50
  })

  it('não mostra os cards de Sentinel/Commitment Tier quando nenhum workspace tem esse custo', async () => {
    vi.mocked(logAnalyticsApi.getLogAnalyticsWorkspaces).mockResolvedValue([wsBasic])
    renderWithClient()
    await screen.findByText('rg-app')
    expect(screen.queryByText(/Custo Sentinel/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Commitment Tier \(/)).not.toBeInTheDocument()
  })

  it('mostra os cards de volume (ingestão total, média, retenção faturada) sem aviso quando o mês está totalmente coberto', async () => {
    renderWithClient()
    await screen.findByText('rg-shared')
    expect(screen.getByText('Ingestão total (Outubro/2026)')).toBeInTheDocument()
    expect(screen.getByText('6.500,00 GB')).toBeInTheDocument() // 6000 + 500
    expect(screen.queryByText(/dias foram medidos/)).not.toBeInTheDocument()
    expect(screen.getByText('Retenção faturada (Outubro/2026)')).toBeInTheDocument()
    expect(screen.getByText('20,00 GB')).toBeInTheDocument() // só wsBasic tem retenção faturada
  })

  it('marca a ingestão como parcial quando a coleta de GB cobriu poucos dias do mês', async () => {
    // Espelha agosto/2026 real: a coleta própria de GB só começou em 30/08, 2 de 31 dias
    // medidos — card tem que avisar, não afirmar um total 15x menor como se fosse o mês inteiro.
    const wsParcial: LogAnalyticsWorkspace = {
      ...wsSharedServices, ingestao_mes_gb: 60, dias_com_gb: 2, dias_janela: 31,
    }
    vi.mocked(logAnalyticsApi.getLogAnalyticsWorkspaces).mockResolvedValue([wsParcial])
    renderWithClient()
    await screen.findByText('rg-shared')
    expect(screen.getByText('parcial')).toBeInTheDocument()
    expect(screen.getByText('Só 2 de 31 dias foram medidos — o mês real foi maior')).toBeInTheDocument()
    // média recalculada sobre os dias medidos (60 / 2 = 30,00 GB/dia), não diluída pelos 31
    expect(screen.getByText('Apurada sobre os 2 dias medidos, não sobre 31')).toBeInTheDocument()
  })

  it('troca o mês e refaz as consultas que dependem dele', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('rg-shared')
    vi.mocked(logAnalyticsApi.getLogAnalyticsWorkspaces).mockClear()
    vi.mocked(logAnalyticsApi.getLogAnalyticsResumo).mockClear()

    await user.selectOptions(screen.getByLabelText('Período'), '2026-09')

    await waitFor(() => expect(logAnalyticsApi.getLogAnalyticsWorkspaces).toHaveBeenCalledWith('2026-09'))
    expect(logAnalyticsApi.getLogAnalyticsResumo).toHaveBeenCalledWith('2026-09', null, [])
  })

  it('"Mostrar só com custo" tira da tabela quem tem custo zero', async () => {
    const wsSemCusto: LogAnalyticsWorkspace = { ...wsBasic, nome: 'ws-sem-custo', workspace_guid: 'guid-zero', custo_mes_total: 0 }
    vi.mocked(logAnalyticsApi.getLogAnalyticsWorkspaces).mockResolvedValue([wsSharedServices, wsSemCusto])
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('rg-app') // só existe na linha da tabela, não no dropdown
    expect(linhaWorkspace('ws-sem-custo')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Mostrar só com custo'))

    // o dropdown de workspace continua listando todos — só a TABELA filtra por custo
    expect(screen.queryByRole('cell', { name: 'ws-sem-custo' })).not.toBeInTheDocument()
    expect(linhaWorkspace('LA-SharedServices-PROD')).toBeInTheDocument()
  })

  it('clicar numa linha seleciona o workspace, carrega o detalhe e rola até ele', async () => {
    const scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView')
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('rg-shared')

    await user.click(linhaWorkspace('LA-SharedServices-PROD'))

    expect(await screen.findByText('Tabelas — LA-SharedServices-PROD')).toBeInTheDocument()
    await waitFor(() => expect(logAnalyticsApi.getLogAnalyticsTabelas).toHaveBeenCalledWith('guid-shared', '2026-10'))
    expect(logAnalyticsApi.getLogAnalyticsFontes).toHaveBeenCalledWith('guid-shared')
    expect(scrollSpy).toHaveBeenCalled()
  })

  it('o botão "Fechar" tira o recorte por workspace e volta pra visão de todos', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('rg-shared')
    await user.click(linhaWorkspace('LA-SharedServices-PROD'))
    await screen.findByText('Tabelas — LA-SharedServices-PROD')

    await user.click(screen.getByRole('button', { name: 'Fechar' }))

    expect(screen.queryByText('Tabelas — LA-SharedServices-PROD')).not.toBeInTheDocument()
  })

  it('filtrar as recomendações por severidade chama a API com o parâmetro certo', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('rg-shared')

    await user.click(screen.getByRole('button', { name: 'Crítico' }))

    await waitFor(() => expect(logAnalyticsApi.getLogAnalyticsRecomendacoes).toHaveBeenCalledWith('critico', null))
  })

  it('"Atualizar agora" atualiza os gráficos após a coleta terminar', async () => {
    vi.mocked(logAnalyticsApi.forcarColetaLogAnalytics).mockResolvedValue({ ok: true, message: 'Coleta iniciada' })
    const user = userEvent.setup()
    const { queryClient } = renderWithClient()
    await screen.findByText('rg-shared')
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    await user.click(screen.getByRole('button', { name: '↻ Atualizar agora' }))

    await waitFor(() => expect(window.showToast).toHaveBeenCalledWith('Coleta iniciada', 'success'))
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['log-analytics-consumo-diario'] })

    queryClient.setQueryData(['log-analytics-progresso'], { execucoes: [{
      tipo: 'coleta', fase: 'concluído', atual: 1, total: 1, detalhe: null,
      iniciado_em: '2026-10-26T10:00:00.000Z', concluido_em: '2026-10-26T10:05:00.000Z',
      erro: null, em_execucao: false, segundos: 300,
    }] })

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['log-analytics-consumo-diario'] }))
  })

  // Backfill de volume (2026-10-21, pedido do usuário: "gostaria de poder coletar dados antigo
  // para deixar no banco") — campo próprio de dias, separado do botão "Atualizar agora" que
  // sempre olha os últimos 30 dias fixos.
  it('"Backfill de volume" envia o número de dias digitado', async () => {
    vi.mocked(logAnalyticsApi.backfillVolumeLogAnalytics).mockResolvedValue({ ok: true, message: 'Backfill de 90 dia(s) iniciado' })
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('rg-shared')

    // 90 é o valor inicial do campo — clicar sem digitar já dispara com ele.
    await user.click(screen.getByRole('button', { name: '📥 Coletar volume' }))
    await waitFor(() => expect(logAnalyticsApi.backfillVolumeLogAnalytics).toHaveBeenCalledWith(90))
    await waitFor(() => expect(window.showToast).toHaveBeenCalledWith('Backfill de 90 dia(s) iniciado', 'success'))

    const campo = screen.getByLabelText('Dias para backfill de volume')
    await user.clear(campo)
    await user.type(campo, '45')
    await user.click(screen.getByRole('button', { name: '📥 Coletar volume' }))
    await waitFor(() => expect(logAnalyticsApi.backfillVolumeLogAnalytics).toHaveBeenCalledWith(45))
  })

  // Backfill de atribuição por recurso (2026-10-21) — campo e botão próprios, valor inicial
  // diferente do de volume (30, não 90) porque a maioria das tabelas desta base retém só 30 dias.
  it('"Backfill de atribuição" envia o número de dias digitado, separado do de volume', async () => {
    vi.mocked(logAnalyticsApi.backfillAtribuicaoRecursoLogAnalytics).mockResolvedValue({ ok: true, message: 'Backfill de 30 dia(s) iniciado' })
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('rg-shared')

    await user.click(screen.getByRole('button', { name: '📥 Coletar atribuição' }))
    await waitFor(() => expect(logAnalyticsApi.backfillAtribuicaoRecursoLogAnalytics).toHaveBeenCalledWith(30))
    await waitFor(() => expect(window.showToast).toHaveBeenCalledWith('Backfill de 30 dia(s) iniciado', 'success'))
    // Não deve ter acionado o de volume por engano — são mutations independentes.
    expect(logAnalyticsApi.backfillVolumeLogAnalytics).not.toHaveBeenCalled()

    const campo = screen.getByLabelText('Dias para backfill de atribuição por recurso')
    await user.clear(campo)
    await user.type(campo, '15')
    await user.click(screen.getByRole('button', { name: '📥 Coletar atribuição' }))
    await waitFor(() => expect(logAnalyticsApi.backfillAtribuicaoRecursoLogAnalytics).toHaveBeenCalledWith(15))
  })

  it('"Exportar Excel" baixa com o mês e os workspaces do FILTRO — clicar na linha só abre o detalhe, não recorta o export', async () => {
    vi.mocked(logAnalyticsApi.baixarLogAnalyticsExcel).mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('rg-shared')

    // Clicar na linha seleciona pra VER o detalhe (workspaceClicado), mas não mexe no filtro
    // (workspaceFiltro) que o export de fato usa — são dois estados diferentes de propósito.
    await user.click(linhaWorkspace('LA-SharedServices-PROD'))
    await screen.findByText('Tabelas — LA-SharedServices-PROD')
    await user.click(screen.getByRole('button', { name: /Exportar Excel/ }))
    await waitFor(() => expect(logAnalyticsApi.baixarLogAnalyticsExcel).toHaveBeenCalledWith('2026-10', null, []))

    // Escolher no multi-select "Filtrar por Workspace" é o que de fato recorta o export.
    await user.click(screen.getByText('Todos os workspaces (2)'))
    await user.click(await screen.findByText('LA-SharedServices-PROD', { selector: '.cms-option *, .cms-option' }))
    await user.click(screen.getByRole('button', { name: /OK/ }))
    await user.click(screen.getByRole('button', { name: /Exportar Excel/ }))
    await waitFor(() => expect(logAnalyticsApi.baixarLogAnalyticsExcel).toHaveBeenCalledWith('2026-10', null, ['guid-shared']))
  })

  it('o filtro de workspace aceita mais de um — a tela soma o conjunto e o detalhe espera um clique', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('rg-shared')

    await user.click(screen.getByText('Todos os workspaces (2)'))
    await user.click(await screen.findByText('LA-SharedServices-PROD', { selector: '.cms-option *, .cms-option' }))
    await user.click(screen.getByText('ws-app-prod', { selector: '.cms-option *, .cms-option' }))
    await user.click(screen.getByRole('button', { name: /OK/ }))

    // Com dois no recorte a tela entra em modo comparação: nenhum detalhe abre sozinho.
    expect(await screen.findByText(/comparando 2/)).toBeInTheDocument()
    expect(screen.queryByText(/^Tabelas — /)).not.toBeInTheDocument()
    await waitFor(() => expect(logAnalyticsApi.getLogAnalyticsResumo)
      .toHaveBeenCalledWith('2026-10', null, ['guid-shared', 'guid-basic']))
  })

  it('mostra a sugestão de Commitment Tier avaliada dia a dia, não pela média', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('rg-shared')
    await user.click(linhaWorkspace('LA-SharedServices-PROD'))

    expect(await screen.findByText('Commitment Tier — sugestão de nível')).toBeInTheDocument()
    // Ingestão: já em contrato (em_commitment), e nenhum nível vizinho compensa subir —
    // o tier atual de 100 GB/dia continua sendo o melhor pra este volume.
    expect(screen.getByText('O nível contratado já é o melhor para este volume — subir pagaria capacidade ociosa nos dias fracos.')).toBeInTheDocument()
    // Sentinel: sem contrato, e o tier de 200 GB/dia compensa de verdade
    expect(screen.getByText('Melhor nível: 200 GB/dia — R$ 22.619,82/mês, com 19 dos 41 dias abaixo do contratado.')).toBeInTheDocument()
  })

  it('mostra quem está pagando a análise do Sentinel, tabela por tabela', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('rg-shared')
    await user.click(linhaWorkspace('LA-SharedServices-PROD'))

    expect(await screen.findByText('Análise do Sentinel — quem está pagando')).toBeInTheDocument()
    // "AzureDiagnostics" também aparece no ranking "Top Tabelas por Volume" — escopa a busca
    // na tabela deste card (achada pela coluna "Análise Sentinel", que só existe nela).
    const tabelaSentinel = screen.getByText('Análise Sentinel').closest('table')!
    expect(within(tabelaSentinel).getByText('AzureDiagnostics')).toBeInTheDocument()
    expect(within(tabelaSentinel).getByText('R$ 27.208,83')).toBeInTheDocument()
    // SecurityAlert é "nativa" — marca visível ao lado do nome
    const linhaSecurityAlert = within(tabelaSentinel).getByText('SecurityAlert').closest('td')!
    expect(within(linhaSecurityAlert).getByText('nativa')).toBeInTheDocument()
  })

  it('mostra a comparação de custo por GB entre Analytics e Basic quando há tabela candidata', async () => {
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('rg-shared')
    await user.click(linhaWorkspace('LA-SharedServices-PROD'))

    expect(await screen.findByText('Custo por GB — Analytics vs Basic')).toBeInTheDocument()
    // fator 5.28 arredondado pra 1 casa com vírgula, como o card formata
    expect(screen.getByText('5,3×', { exact: false })).toBeInTheDocument()
  })

  it('workspace sem histórico suficiente não mostra nenhum card de Commitment Tier', async () => {
    vi.mocked(logAnalyticsApi.getLogAnalyticsTabelas).mockResolvedValue({
      ...mockTabelasResposta,
      commitment: { suficiente: false, dias: 5, motivo: 'Menos de 14 dias de histórico.' },
    })
    const user = userEvent.setup()
    renderWithClient()
    await screen.findByText('rg-shared')
    await user.click(linhaWorkspace('LA-SharedServices-PROD'))

    await screen.findByText('Tabelas — LA-SharedServices-PROD')
    expect(screen.queryByText('Commitment Tier — sugestão de nível')).not.toBeInTheDocument()
  })
})
