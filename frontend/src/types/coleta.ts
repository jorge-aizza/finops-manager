// Contrato de server.js — Coleta Azure. Fase A cobriu CRUD + relatórios.
// Fase B (abaixo) cobre o wizard de 4 passos, o monitor de coleta ao vivo e
// os botões "Testar"/"Coletar agora" — todos dependentes de chamadas reais
// à API da Azure, verificados contra o servidor local (build/tipos/CRUD)
// mas não contra credenciais Azure reais (sem acesso a elas neste ambiente).

export type ModoColeta = 'billing_profile' | 'subscription'

export interface ServicePrincipal {
  id: number
  nome: string
  tenant_id: string
  client_id: string
  ativo: boolean
  is_padrao: boolean
  expiracao_secret: string | null
  billing_account_id: string | null
  billing_profile_id: string | null
  modo_coleta: ModoColeta
  subscription_ids: string | null
  granularidade_dias: number
  dia_execucao: number
  hora_execucao: number | null
  dias_semana: string | null
  auto_coleta: boolean
  proxima_coleta: string | null
  atualizado_em: string
}

// client_secret nunca volta do GET — só é enviado (opcional) no save.
export interface ServicePrincipalInput {
  nome: string
  tenant_id: string
  client_id: string
  client_secret?: string
  expiracao_secret: string | null
  modo_coleta: ModoColeta
  billing_account_id: string | null
  billing_profile_id: string | null
  subscription_ids: string | null
  ativo: boolean
  dia_execucao: number
  granularidade_dias: number
}

export interface StorageConfig {
  id: number
  nome: string
  storage_account: string
  storage_container: string
  storage_prefix: string | null
  price_list_prefix: string | null
  ativo: boolean
  sp_id: number | null
  criado_em: string
  atualizado_em: string
}

export interface StorageConfigInput {
  nome: string
  storage_account: string
  storage_container: string
  storage_prefix: string
  price_list_prefix: string
  sp_id: number | null
  ativo: boolean
}

export interface CoberturaMes {
  mes: string
  subscription_id: string
  subscription_name: string
  registros: number
  dias_com_dados: number
  dias_no_mes: number
  ultima_importacao: string | null
  total_brl: number
}

export interface ValidacaoJson {
  total_registros: number | null
  custo_total: number | null
  dias_com_dados: number | null
  dias_esperados: number | null
  subs_com_dados: number | null
  subs_esperadas: number | null
  subs_sem_dados: string[] | null
  dias_sem_dados: string[] | null
  validado_em: string | null
}

export interface HistoricoItem {
  id: number
  tipo: string | null
  origem: string
  iniciado_em: string
  concluido_em: string | null
  status: string
  linhas_inseridas: number
  linhas_atualizadas: number
  linhas_erro: number
  mensagem: string | null
  detalhes: { log?: { ts: string; msg: string }[] } | null
  periodo_inicio: string | null
  periodo_fim: string | null
  validacao_status: string | null
  validacao_json: ValidacaoJson | null
  sp_nome: string | null
}

export interface ImportItem {
  importado_em: string
  arquivo_origem: string
  linhas: number
  periodo_inicio: string
  periodo_fim: string
  total_billing: number
  moeda: string
}

export interface Pendente {
  id: number
  sp_id: number | null
  sp_nome: string | null
  subscription_id: string | null
  sub_name: string | null
  data_inicio: string
  data_fim: string
  descricao: string | null
  criado_em: string
}

// ── Fase B ────────────────────────────────────────────────────────

export interface SubscriptionPreview {
  subscriptionId: string
  nome: string
}

export interface RGPreview {
  subscriptionId: string
  name: string
}

export interface TesteResultado {
  ok: boolean
  msg: string
}

export interface TestarSPResponse {
  ok: boolean
  message: string
  results: { management: TesteResultado; storage: TesteResultado }
}

export interface TestarStorageResponse {
  ok: boolean
  total: number
  totalSizeMB: string
  preview: { name: string; sizeMB: string; lastModified: string }[]
}

export type MetricColeta = 'ActualCost' | 'AmortizedCost'

export interface ColetarAPIInput {
  modo: ModoColeta
  data_inicio: string
  data_fim: string
  metric: MetricColeta
  billing_account_id?: string
  billing_profile_id?: string
  subscription_ids?: string[]
  resource_groups?: string[]
}

export interface ColetaProgresso {
  tipo: 'api' | 'storage'
  fase: string
  sub_atual?: string
  chunk_atual?: number
  chunk_total?: number
  chunk_idx?: number
  ins: number
  upd: number
  err: number
  sub_idx?: number
  sub_total?: number
  log: { ts: string; msg: string }[]
}

export interface ColetaStatus {
  em_execucao: boolean
  cancelando: boolean
  progresso: ColetaProgresso | null
  ultimo: HistoricoItem | null
  ultimo_api: HistoricoItem | null
  ultimo_storage: HistoricoItem | null
  agendador_ativo: boolean
  circuit_breaker: { state: string; failures: number; open_until: string | null }
}

export interface AgendamentoSPInput {
  hora_execucao: number | null
  dias_semana: string | null
  auto_coleta: boolean
}

export interface AgendamentoStorageInput {
  hora_execucao: number | null
  dias_semana: string | null
}

export interface DiagAgendadorSP {
  id: number
  nome: string
  ativo: boolean
  auto_coleta: boolean
  modo_coleta: ModoColeta
  hora_execucao: number | null
  dias_semana: string | null
  tem_subs: boolean
  tem_billing: boolean
  proxima_coleta: string | null
  agora_pg: string
  deveria_rodar: boolean
}

export interface DiagAgendadorStorage {
  id: number
  nome: string
  ativo: boolean
  hora_execucao: number | null
  dias_semana: string | null
  auto_coleta_horas: number | null
  tem_storage: boolean
  proxima_coleta: string | null
  agora_pg: string
  deveria_rodar: boolean
}

// ── Expurgo / Diagnóstico de azure_costs — porta de Purge/Diagnóstico
// (calculadora.js). Vive conceitualmente na tela Coleta Azure (Import
// Manual) — mesmo lugar de onde os botões legados abrirPurgeAzure()/
// abrirDiagnosticoAzure() eram acionados.

export interface AzureResumoMes {
  mes: string
  registros: number
  total_billing: number
}

export interface AzureResumo {
  resumo: {
    total: number
    data_inicio: string | null
    data_fim: string | null
    total_billing: number | null
    moeda: string | null
  }
  por_mes: AzureResumoMes[]
}

export interface PurgeResult {
  message: string
  removidos: number
}

export interface DiagnosticoLinha {
  meter_category: string
  meter_sub_category: string | null
  consumed_service: string | null
  charge_type: string | null
  unit_of_measure: string | null
  pricing_model: string | null
  publisher_type: string | null
  recursos: number
  linhas: number
  total_billing: number
  moeda: string | null
}

// ── Import Manual (upload CSV/Parquet/ZIP) ──────────────────────────
export interface ImportErroDet {
  linha?: number
  msg?: string
  cost_date?: string
  subscription_id?: string
  resource_id?: string
}

export interface ImportJob {
  id: string
  arquivo: string
  idx: number
  total: number
  status: 'running' | 'done' | 'error'
  linhas: number
  inseridos: number
  atualizados: number
  erros: number
  erros_det: ImportErroDet[]
  subArquivo: string | null
  erro: string | null
  iniciado: number
  concluido: number | null
}

export interface DiagAgendador {
  agora_node: string
  agora_node_local: string
  tz_process: string
  coleta_em_execucao: boolean
  agendador_ativo: boolean
  api_sps: DiagAgendadorSP[]
  storage_sps: DiagAgendadorStorage[]
}
