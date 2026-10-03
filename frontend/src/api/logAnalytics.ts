import { apiFetch } from './client'
import { API_BASE, getToken } from './client'

export interface LogAnalyticsWorkspace {
  resource_id: string
  workspace_guid: string
  subscription_id: string | null
  resource_group: string | null
  nome: string | null
  retencao_dias: number | null
  sku: string | null
  /** Teto diário de ingestão configurado (workspaceCapping.dailyQuotaGb no ARM) — null = sem limite. */
  daily_cap_gb: number | null
  atualizado_em: string
  ingestao_mes_gb: number
  recomendacoes_abertas: number
  tabelas_retencao_customizada: number
  /** Custo real do mês (JOIN com azure_costs por resource_id) — não é estimativa. */
  custo_mes_total: number
  custo_mes_ingestao: number
  custo_mes_retencao: number
}

export interface LogAnalyticsIngestaoDia {
  dia: string
  tabela: string
  gb: number
}

export interface LogAnalyticsTabela {
  tabela: string
  plano: 'Analytics' | 'Basic' | 'Auxiliary' | null
  retencao_dias: number | null
  retencao_total_dias: number | null
  retencao_arquivo_dias: number | null
  /** false = retenção customizada nesta tabela, diferente do padrão do workspace. */
  retencao_e_padrao: boolean | null
  gb_mes: number
  /** Rateio estimado (peso por GB/dias) do custo real do workspace — não é a fatura exata por tabela. */
  custo_ingestao_estimado: number
  custo_retencao_estimado: number
  /** null = auditoria de consultas (LAQueryLogs) não habilitada neste workspace, ver auditoriaConsultasHabilitada. */
  consultas_30d: number | null
  gb_escaneado_30d: number | null
  ultima_consulta: string | null
}

export interface LogAnalyticsTabelasResposta {
  auditoria_consultas_habilitada: boolean
  tabelas: LogAnalyticsTabela[]
}

export interface LogAnalyticsFonte {
  mecanismo: 'Diagnostic Setting' | 'Data Collection Rule'
  tipo: string
  contagem: number
  detalhe: string | null
}

export interface LogAnalyticsFontesResposta {
  fontes: LogAnalyticsFonte[]
  diagnostic_settings_atualizado_em: string | null
}

export interface LogAnalyticsRecursoDetalhado {
  resource_id: string
  gb: number
}

export interface LogAnalyticsRankingItem {
  label: string
  valor: number
}

export interface LogAnalyticsAppInsights {
  resource_id: string
  subscription_id: string | null
  resource_group: string | null
  nome: string | null
  /** % da telemetria efetivamente ingerida — <100 já reduz custo na origem. */
  sampling_percentage: number | null
  retencao_dias: number | null
  ingestion_mode: 'ApplicationInsights' | 'ApplicationInsightsWithDiagnosticSettings' | 'LogAnalytics' | null
  /** Presente = workspace-based (fatura pelo workspace de Log Analytics vinculado). */
  workspace_resource_id: string | null
  workspace_nome: string | null
  daily_cap_gb: number | null
  atualizado_em: string
}

export interface LogAnalyticsDiagnosticSetting {
  nome_config: string | null
  recurso_id: string
  recurso_tipo: string | null
  categorias_habilitadas: string | null
  categorias_desabilitadas: string | null
  grupos_categoria: string | null
  metricas_habilitadas: string | null
  metricas_desabilitadas: string | null
  envia_storage: boolean
  envia_eventhub: boolean
  /** Fan-out: mesmo recurso também aponta pra outro(s) workspace(s) — ingestão paga em dobro. */
  outros_workspaces: string[] | null
  atualizado_em: string
}

export interface LogAnalyticsResumo {
  kpis: {
    subsNoEscopo: number
    workspaces: number
    gbIngeridoMes: number
    custoRealMes: number
    tabelasRetencaoAlta: number
    recursosComDiagSetting: number
    dcrsMapeadas: number
  }
  custoPorWorkspace: LogAnalyticsRankingItem[]
  topTabelas: LogAnalyticsRankingItem[]
  fontes: LogAnalyticsRankingItem[]
  distribuicaoRetencao: LogAnalyticsRankingItem[]
}

export type LogAnalyticsSeveridade = 'atencao' | 'critico'

export interface LogAnalyticsRecomendacao {
  id: number
  workspace_guid: string
  workspace_nome: string
  subscription_id: string | null
  regra: string
  severidade: LogAnalyticsSeveridade
  detalhe: string
  criado_em: string
}

export const getLogAnalyticsWorkspaces = () =>
  apiFetch<LogAnalyticsWorkspace[]>('GET', '/log-analytics/workspaces')

export const getLogAnalyticsAppInsights = () =>
  apiFetch<LogAnalyticsAppInsights[]>('GET', '/log-analytics/app-insights')

export const getLogAnalyticsIngestao = (workspaceGuid: string) =>
  apiFetch<LogAnalyticsIngestaoDia[]>('GET', '/log-analytics/workspaces/' + encodeURIComponent(workspaceGuid) + '/ingestao')

export const getLogAnalyticsTabelas = (workspaceGuid: string) =>
  apiFetch<LogAnalyticsTabelasResposta>('GET', '/log-analytics/workspaces/' + encodeURIComponent(workspaceGuid) + '/tabelas')

// Liga a auditoria de consultas (LAQueryLogs) no workspace — ação de ESCRITA na Azure (único
// PUT de todo o projeto), por isso é disparada manualmente por um botão, não automática. Exige
// que a Service Principal tenha permissão de escrita no workspace; sem ela, o backend devolve
// 403 com uma mensagem explicando o que falta.
export const habilitarAuditoriaConsultas = (workspaceGuid: string) =>
  apiFetch<{ ok: boolean; message: string }>(
    'POST', '/log-analytics/workspaces/' + encodeURIComponent(workspaceGuid) + '/auditoria-consultas/habilitar',
  )

export const getLogAnalyticsRecomendacoes = (severidade?: LogAnalyticsSeveridade) =>
  apiFetch<LogAnalyticsRecomendacao[]>('GET', '/log-analytics/recomendacoes' + (severidade ? '?severidade=' + severidade : ''))

// Mesmos dados do "📊 Gerar Dashboard" (HTML p/ download), só que como JSON — pro painel
// nativo dentro da tela (ver _coletarResumoLogAnalytics em server.js, reaproveitado pelos dois).
export const getLogAnalyticsResumo = () =>
  apiFetch<LogAnalyticsResumo>('GET', '/log-analytics/resumo')

export const getLogAnalyticsFontes = (workspaceGuid: string) =>
  apiFetch<LogAnalyticsFontesResposta>('GET', '/log-analytics/workspaces/' + encodeURIComponent(workspaceGuid) + '/fontes')

// Detalhe por recurso (não agregado como getLogAnalyticsFontes) — quais categorias de log
// estão habilitadas/desabilitadas em cada Diagnostic Setting.
export const getLogAnalyticsDiagnosticSettings = (workspaceGuid: string) =>
  apiFetch<LogAnalyticsDiagnosticSetting[]>('GET', '/log-analytics/workspaces/' + encodeURIComponent(workspaceGuid) + '/diagnostic-settings')

// Roda uma query KQL de verdade (custo de scan real), janela curta de 3 dias — não é dado
// pré-coletado como o resto da tela. Ver comentário do endpoint em server.js. Timeout de 60s
// (maior que os 45s do backend pra Azure) — do contrário o front abortava antes do backend
// terminar numa tabela grande/verbosa, e o usuário só via "servidor não respondeu" sem saber
// que a query ainda estava rodando do lado de lá.
export const detalharRecursoTabela = (workspaceGuid: string, tabela: string) =>
  apiFetch<{ recursos: LogAnalyticsRecursoDetalhado[]; janela_dias: number }>(
    'POST', '/log-analytics/workspaces/' + encodeURIComponent(workspaceGuid) + '/tabelas/' + encodeURIComponent(tabela) + '/detalhar-recurso',
    undefined, 60_000,
  )

export const forcarColetaLogAnalytics = () =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/log-analytics/coleta/forcar')

// Etapa separada e mais cara (1 chamada por recurso monitorável do tenant) — cadência própria
// (semanal), disparo manual independente do "Atualizar agora" de cima.
export const forcarColetaDiagnosticSettings = () =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/log-analytics/diagnostic-settings/forcar')

// Mesmo padrão de baixarAzureInventarioExcel (api/azureInventario.ts) — resposta binária,
// não passa por apiFetch (que espera JSON).
export async function baixarLogAnalyticsExcel() {
  const token = getToken()
  const resp = await fetch(API_BASE + '/log-analytics/export/excel', {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Erro desconhecido' }))
    throw new Error(err.error || 'Erro ao exportar')
  }
  const blob = await resp.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'log-analytics-finops-' + new Date().toISOString().slice(0, 10) + '.xlsx'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// Dashboard HTML autocontido (Chart.js embutido inline — abre sem servidor/internet). Mesmo
// padrão binário do export Excel acima.
export async function baixarLogAnalyticsDashboardHtml() {
  const token = getToken()
  const resp = await fetch(API_BASE + '/log-analytics/export/dashboard', {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Erro desconhecido' }))
    throw new Error(err.error || 'Erro ao gerar dashboard')
  }
  const blob = await resp.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'log-analytics-dashboard-' + new Date().toISOString().slice(0, 10) + '.html'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
