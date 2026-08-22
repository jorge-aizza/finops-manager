// Contrato de server.js — Fase A da Coleta Azure (CRUD + relatórios).
// Wizard de 4 passos, monitor de coleta ao vivo e botões "Testar"/"Coletar
// agora" (chamadas reais à Azure) ficam pra Fase B — ver plano de migração.

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
  periodo_inicio: string | null
  periodo_fim: string | null
  validacao_status: string | null
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
