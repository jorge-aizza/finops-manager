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
  /** Só ingestão de dados. Até 2026-10 este campo somava Sentinel e Commitment Tier junto, e a
   * tela rotulava o conjunto como "ingestão" — em workspace com Sentinel o número era ~75x o
   * valor real da ingestão. */
  custo_mes_ingestao: number
  custo_mes_retencao: number
  /** Análise do Sentinel, cobrada por cima da ingestão num medidor próprio. */
  custo_mes_sentinel: number
  /** Capacidade pré-paga (Commitment Tier). Quando contratada, substitui a cobrança por GB. */
  custo_mes_commitment: number
  /** Economia REAL do período selecionado (billing de `azure_costs`, não um snapshot do "agora")
   * — vs Pay-As-You-Go pelo mesmo volume real ingerido nesse período. null = não houve cobrança
   * de Commitment Tier nesse período (não estava contratado então, mesmo que esteja hoje) —
   * "não sabemos/não aplicável" nunca vira 0. Pode ser negativo (comprometido acima do necessário). */
  economia_commitment_tier_periodo: number | null
  /** Média de GB/dia no período selecionado (ingestao_mes_gb / dias da janela) — mesma janela
   * móvel/mês civil de `_janelaLogAnalytics` no backend, null só se a janela não puder ser
   * determinada (não deveria acontecer em uso normal). */
  ingestao_media_gb_dia: number | null
  /** GB que a Azure FATUROU no medidor de retenção no período. Não é o volume configurado para
   *  retenção: o período incluído sem cobrança varia (90 dias com Sentinel, 31 sem), então só a
   *  quantidade da fatura separa quem paga de quem não paga. */
  retencao_gb_faturado: number
  /** Quantos dias da janela têm coleta própria de GB. Menor que `dias_janela` significa que o
   *  total de ingestão é parcial — não que o workspace ingeriu pouco. */
  dias_com_gb: number
  /** Dias que a janela do mês cobre. No mês corrente termina no último dia com custo fechado. */
  dias_janela: number
}

/** Um ponto do gráfico de consumo diário (ver `getLogAnalyticsConsumoDiario`). */
export interface LogAnalyticsConsumoDiarioPonto {
  dia: string
  gb: number
  /** Custo TOTAL do dia (ingestão + retenção, já com imposto) — não só ingestão. */
  custo: number
}

export interface LogAnalyticsConsumoDiarioResposta {
  workspace_nome: string | null
  pontos: LogAnalyticsConsumoDiarioPonto[]
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
  /** R$/GB que esta tabela paga hoje, pelo plano em que está (ingestão + análise do Sentinel). */
  custo_gb_atual: number | null
  custo_gb_se_basic: number | null
  /** Zero para tabela já em Basic/Auxiliary — não há para onde mover. */
  economia_periodo_se_basic: number
  ja_em_basico: boolean
  /** Taxa de análise do Sentinel atribuída a esta tabela. null = Sentinel desligado aqui. */
  custo_sentinel_estimado: number | null
  /** Tabela criada pela própria solução Sentinel. Não significa "usada em detecção". */
  nativa_sentinel: boolean
}

/** Preço por GB derivado da fatura deste workspace, não de tabela de preço. */
export interface LogAnalyticsTaxasGb {
  analytics: number | null
  basic: number | null
  sentinel_analytics: number | null
  sentinel_basic: number | null
  /** Ingestão + Sentinel somados: o que um GB custa de fato em cada caminho. */
  gb_analytics_total: number | null
  gb_basic_total: number | null
  tem_sentinel: boolean
  /** Workspace em Capacity Reservation: a ingestão é cobrada no medidor de Commitment Tier. */
  cobranca_via_commitment: boolean
  /** 'referencia' = o workspace não tem tabela em Basic, a tarifa veio dos outros workspaces. */
  origem_taxa_basic: 'workspace' | 'referencia' | null
  fator: number | null
}

/** Um nível de Commitment Tier avaliado contra a série diária real de ingestão. */
export interface LogAnalyticsTierOpcao {
  gb_dia: number
  /** Preço de lista do tier ajustado pelo desconto que a fatura comprova. */
  preco_gb_estimado: number
  custo_mes_estimado: number
  /** Quantos dos dias observados ficariam abaixo do contratado, pagando capacidade ociosa. */
  dias_ociosos: number
  atual: boolean
  /** Negativa quando o tier custaria MAIS que o arranjo atual. */
  economia_mes_estimada: number
}

/** Janela curta discordando da longa: o patamar recente já justifica um tier que a média
 *  de 60 dias ainda não alcançou. Luz amarela, não recomendação firme. */
export interface LogAnalyticsTierTendencia {
  janela_dias: number
  media: number
  media_longa: number
  recomendado: LogAnalyticsTierOpcao
}

export interface LogAnalyticsTierBloco {
  fator_calibragem: number
  taxa_real_gb: number
  custo_atual_mes: number
  payg_gb_estimado?: number | null
  opcoes: LogAnalyticsTierOpcao[]
  recomendado: LogAnalyticsTierOpcao | null
  tendencia?: LogAnalyticsTierTendencia | null
}

/** Conclusão gravada num dia. Uma linha por workspace por dia — é o que permite perguntar
 *  "a tendência se manteve?", que a análise calculada na hora não consegue responder. */
export interface LogAnalyticsCommitmentSnapshot {
  dia: string
  media_gb_dia: number | null
  media_curta_gb_dia: number | null
  tier_recomendado: number | null
  economia_mes: number | null
  tendencia_tier: number | null
  tendencia_economia_mes: number | null
  sentinel_tier_recomendado: number | null
  sentinel_economia_mes: number | null
  sentinel_tendencia_tier: number | null
  sentinel_tendencia_economia_mes: number | null
}

export interface LogAnalyticsCommitment {
  suficiente: boolean
  /** Até 60 dias de conclusões anteriores, do mais recente para o mais antigo. */
  historico?: LogAnalyticsCommitmentSnapshot[]
  /** Preenchido só quando `suficiente` é false. */
  motivo?: string
  dias: number
  media?: number
  p25?: number
  p75?: number
  tier_atual?: number | null
  em_commitment?: boolean
  ingestao?: LogAnalyticsTierBloco | null
  /** null quando o Sentinel não está ligado neste workspace. */
  sentinel?: (LogAnalyticsTierBloco & { em_commitment: boolean }) | null
}

export interface LogAnalyticsTabelasResposta {
  auditoria_consultas_habilitada: boolean
  taxas: LogAnalyticsTaxasGb
  commitment: LogAnalyticsCommitment
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
  mes: string
  mes_label: string
  kpis: {
    subsNoEscopo: number
    workspaces: number
    gbIngeridoMes: number
    custoRealMes: number
    /** Soma de `economia_commitment_tier_periodo` de todos os workspaces — real do período
     * selecionado, não um snapshot do "agora". Pode ser negativo se algum workspace estiver
     * comprometido acima do necessário. */
    economiaCommitmentTierMes: number
    tabelasRetencaoAlta: number
    recursosComDiagSetting: number
    dcrsMapeadas: number
  }
  /** Até que dia o custo da janela já está fechado — os dias seguintes ainda estão sendo
   * publicados pela Azure e aparecem com valor parcial. null quando não dá pra determinar. */
  custo_consolidado_ate: string | null
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

// `mes` no formato YYYY-MM — mês selecionado na tela (dropdown "Período"), ver
// LogAnalyticsView.tsx. Sem `mes`, o backend cai no mês corrente (mesmo comportamento de antes
// do seletor existir).
export const getLogAnalyticsWorkspaces = (mes?: string) =>
  apiFetch<LogAnalyticsWorkspace[]>('GET', '/log-analytics/workspaces' + (mes ? '?mes=' + mes : ''))

// Só o filtro de Tenant: o recorte por workspace é feito na tela, que tem o "mostrar todos".
export const getLogAnalyticsAppInsights = (spId?: number | null) => {
  const q = new URLSearchParams()
  if (spId) q.set('sp_id', String(spId))
  return apiFetch<LogAnalyticsAppInsights[]>('GET', '/log-analytics/app-insights' + (q.toString() ? '?' + q : ''))
}

// Gráfico de detalhe "GB dia a dia + valor" de um workspace (2026-10-xx, pedido do usuário) —
// `mes` no mesmo formato YYYY-MM do resto da tela; sem ele, o backend cai no mês corrente.
export const getLogAnalyticsConsumoDiario = (workspaceGuid: string, mes?: string) =>
  apiFetch<LogAnalyticsConsumoDiarioResposta>(
    'GET', '/log-analytics/workspaces/' + encodeURIComponent(workspaceGuid) + '/consumo-diario' + (mes ? '?mes=' + mes : ''),
  )

export const getLogAnalyticsTabelas = (workspaceGuid: string, mes?: string) =>
  apiFetch<LogAnalyticsTabelasResposta>('GET', '/log-analytics/workspaces/' + encodeURIComponent(workspaceGuid) + '/tabelas' + (mes ? '?mes=' + mes : ''))

// Liga a auditoria de consultas (LAQueryLogs) no workspace — ação de ESCRITA na Azure (único
// PUT de todo o projeto), por isso é disparada manualmente por um botão, não automática. Exige
// que a Service Principal tenha permissão de escrita no workspace; sem ela, o backend devolve
// 403 com uma mensagem explicando o que falta.
export const habilitarAuditoriaConsultas = (workspaceGuid: string) =>
  apiFetch<{ ok: boolean; message: string }>(
    'POST', '/log-analytics/workspaces/' + encodeURIComponent(workspaceGuid) + '/auditoria-consultas/habilitar',
  )

export const getLogAnalyticsRecomendacoes = (severidade?: LogAnalyticsSeveridade, spId?: number | null) => {
  const q = new URLSearchParams()
  if (severidade) q.set('severidade', severidade)
  if (spId) q.set('sp_id', String(spId))
  return apiFetch<LogAnalyticsRecomendacao[]>('GET', '/log-analytics/recomendacoes' + (q.toString() ? '?' + q : ''))
}

// Mesmos dados do "📊 Gerar Dashboard" (HTML p/ download), só que como JSON — pro painel
// nativo dentro da tela (ver _coletarResumoLogAnalytics em server.js, reaproveitado pelos dois).
// `spId` = filtro de Tenant da tela. Os rankings do painel são agregados no banco, então o
// filtro precisa viajar até o backend — não dá pra aplicá-lo sobre a resposta.
// `wsGuid` recorta num workspace só (análise detalhada). Como `spId`, viaja até o backend:
// os rankings são agregados em SQL e não teriam como ser filtrados sobre a resposta.
export const getLogAnalyticsResumo = (mes?: string, spId?: number | null, wsGuid?: string | null) => {
  const q = new URLSearchParams()
  if (mes) q.set('mes', mes)
  if (spId) q.set('sp_id', String(spId))
  if (wsGuid) q.set('workspace_guid', wsGuid)
  return apiFetch<LogAnalyticsResumo>('GET', '/log-analytics/resumo' + (q.toString() ? '?' + q : ''))
}

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
// `limite` controla quantos recursos voltam (padrão 20 no backend, teto 5000). Subir não custa
// consulta a mais: o summarize já agrega tudo e o `top` só trunca a saída.
export const detalharRecursoTabela = (workspaceGuid: string, tabela: string, limite?: number) =>
  apiFetch<{ recursos: LogAnalyticsRecursoDetalhado[]; janela_dias: number }>(
    'POST', '/log-analytics/workspaces/' + encodeURIComponent(workspaceGuid) + '/tabelas/' + encodeURIComponent(tabela)
      + '/detalhar-recurso' + (limite ? '?limite=' + limite : ''),
    undefined, 60_000,
  )

/** Um recurso no ranking de volume do workspace — vem do acumulado, não da consulta ao vivo. */
export interface LogAnalyticsRecursoVolume {
  recurso_id: string
  gb: number
  /** Em quantas tabelas diferentes esse recurso aparece. */
  tabelas: number
  maior_tabela: string | null
  /** Por onde o dado chega. 'desconhecido' não é erro: DCR guarda a regra, não os recursos
   * associados a ela, então quem vem por agente cai aqui. É o grupo que vale investigar. */
  origem: 'diagnostic_setting' | 'app_insights' | 'desconhecido'
  primeiro_dia: string | null
  ultimo_dia: string | null
}

// Ranking de recursos por volume no workspace. Diferente de `detalharRecursoTabela`, que é uma
// consulta ao vivo de 3 dias numa tabela só, este lê o histórico acumulado e cobre todas as
// tabelas grandes de uma vez.
/** Tabela cujo volume não pôde ser atribuído a recursos, com o motivo. */
export interface LogAnalyticsTabelaSemAtribuicao {
  tabela: string
  /** 'vazio' = consulta ok, ninguém carimba `_ResourceId` (limite do dado, típico de agente).
   *  'erro' = a consulta falhou; `detalhe` traz a resposta da Azure. */
  desfecho: 'vazio' | 'erro'
  detalhe: string | null
  gb: number
}

export interface LogAnalyticsRecursosVolumeResposta {
  /** O que ficou de fora da atribuição e por quê — sem isso a cobertura é um número sem
   * explicação, e "falhou" se confunde com "não tem recurso carimbado". */
  tabelas_sem_atribuicao: LogAnalyticsTabelaSemAtribuicao[]
  /** % do volume das mesmas tabelas/dias que tem recurso identificado. Linha de agente (DCR)
   * costuma vir sem `_ResourceId` e fica de fora — sem isso o ranking passaria por total. */
  cobertura_pct: number | null
  recursos: LogAnalyticsRecursoVolume[]
}

export const getLogAnalyticsRecursosVolume = (workspaceGuid: string, dias?: number) =>
  apiFetch<LogAnalyticsRecursosVolumeResposta>(
    'GET', '/log-analytics/workspaces/' + encodeURIComponent(workspaceGuid) + '/recursos-volume' + (dias ? '?dias=' + dias : ''),
  )

export const forcarColetaIngestaoRecurso = () =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/log-analytics/ingestao-recurso/forcar')

/** Um recurso que paga "Platform Logs Data Processed" — export de Diagnostic Setting. */
export interface LogAnalyticsExportItem {
  recurso_id: string
  recurso_tipo: string | null
  custo: number
  envia_storage: boolean
  envia_eventhub: boolean
  /** false = o export não alimenta workspace nenhum: paga e não vira consulta. */
  alimenta_workspace: boolean
  /** O setting deste recurso ainda não foi coletado — tipo fora da lista ou falha na coleta.
   * Diferente de "não tem setting". */
  setting_desconhecido: boolean
}

export interface LogAnalyticsExportResposta {
  mes: string
  mes_label: string
  total: number
  sem_workspace: number
  itens: LogAnalyticsExportItem[]
}

// Custo de export de log (Storage/Event Hub). Vem carimbado no recurso de ORIGEM, por isso
// nunca apareceu no custo dos workspaces.
export const getLogAnalyticsExportSemWorkspace = (mes?: string, spId?: number | null) => {
  const q = new URLSearchParams()
  if (mes) q.set('mes', mes)
  if (spId) q.set('sp_id', String(spId))
  return apiFetch<LogAnalyticsExportResposta>('GET', '/log-analytics/export-sem-workspace' + (q.toString() ? '?' + q : ''))
}

/** Um balde do gasto de observabilidade (ingestão, Sentinel, Commitment Tier, etc.). */
export interface LogAnalyticsBaldeCusto {
  id: string
  rotulo: string
  custo: number
  /** Parte carimbada no resource_id de um workspace — o que o custo da tela já soma. */
  custo_em_workspace: number
  pct: number
  recursos: number
  medidores: { nome: string; custo: number; em_workspace: boolean }[]
  /** Workspaces que compõem o balde, do maior pro menor. Vazio quando a Azure cobra o
   *  medidor no recurso de origem (Platform Logs, alertas, agentes) — não há workspace. */
  workspaces: { nome: string; custo: number }[]
}

export interface LogAnalyticsCustoObservabilidade {
  mes: string
  mes_label: string
  total: number
  coberto_pela_tela: number
  coberto_pct: number | null
  baldes: LogAnalyticsBaldeCusto[]
}

// Gasto de observabilidade inteiro, não só o dos workspaces: Sentinel, Commitment Tier,
// Platform Logs e alertas vivem em medidores próprios e somem quando se olha só o workspace.
export const getLogAnalyticsCustoObservabilidade = (mes?: string, spId?: number | null) => {
  const q = new URLSearchParams()
  if (mes) q.set('mes', mes)
  if (spId) q.set('sp_id', String(spId))
  return apiFetch<LogAnalyticsCustoObservabilidade>('GET', '/log-analytics/custo-observabilidade' + (q.toString() ? '?' + q : ''))
}

export const forcarColetaLogAnalytics = () =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/log-analytics/coleta/forcar')

// Etapa separada e mais cara (1 chamada por recurso monitorável do tenant) — cadência própria
// (semanal), disparo manual independente do "Atualizar agora" de cima.
export const forcarColetaDiagnosticSettings = () =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/log-analytics/diagnostic-settings/forcar')

// Mesmo padrão de baixarAzureInventarioExcel (api/azureInventario.ts) — resposta binária,
// não passa por apiFetch (que espera JSON).
export async function baixarLogAnalyticsExcel(mes?: string, spId?: number | null, wsGuid?: string | null) {
  const token = getToken()
  const q = new URLSearchParams()
  if (mes) q.set('mes', mes)
  if (spId) q.set('sp_id', String(spId))
  if (wsGuid) q.set('workspace_guid', wsGuid)
  const resp = await fetch(API_BASE + '/log-analytics/export/excel' + (q.toString() ? '?' + q : ''), {
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
  a.download = 'log-analytics-finops-' + (mes || new Date().toISOString().slice(0, 7)) + '.xlsx'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

// Dashboard HTML autocontido (Chart.js embutido inline — abre sem servidor/internet). Mesmo
// padrão binário do export Excel acima.
export async function baixarLogAnalyticsDashboardHtml(mes?: string, spId?: number | null, wsGuid?: string | null) {
  const token = getToken()
  const q = new URLSearchParams()
  if (mes) q.set('mes', mes)
  if (spId) q.set('sp_id', String(spId))
  if (wsGuid) q.set('workspace_guid', wsGuid)
  const resp = await fetch(API_BASE + '/log-analytics/export/dashboard' + (q.toString() ? '?' + q : ''), {
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
  a.download = 'log-analytics-dashboard-' + (mes || new Date().toISOString().slice(0, 7)) + '.html'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
