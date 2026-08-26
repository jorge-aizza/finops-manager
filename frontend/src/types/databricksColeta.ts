// Contrato de server.js — Coleta Databricks. Fase 1: configuração da conexão (credenciais
// OAuth M2M do Service Principal + endpoint de execução SQL). Fase 2: agendamento +
// coleta real contra system.billing.usage/system.billing.list_prices. Espelha 1:1 o
// contrato de ServicePrincipal/ServicePrincipalInput (types/coleta.ts) usado pela Coleta
// Azure. Dashboard (Fase 3) ainda não existe — ver CLAUDE.md "Coleta Databricks".

export interface DatabricksConfig {
  id: number
  nome: string
  account_id: string
  client_id: string
  workspace_host: string
  warehouse_id: string
  ativo: boolean
  is_padrao: boolean
  granularidade_dias: number
  dia_execucao: number
  hora_execucao: number | null
  dias_semana: string | null
  auto_coleta: boolean
  proxima_coleta: string | null
  atualizado_em: string
}

// client_secret nunca volta do GET — só é enviado (opcional) no save.
export interface DatabricksConfigInput {
  nome: string
  account_id: string
  client_id: string
  client_secret?: string
  workspace_host: string
  warehouse_id: string
  ativo: boolean
}

export interface TestarDatabricksResponse {
  ok: boolean
  message: string
}

// Fase 2 — coleta real + agendamento
export interface AgendamentoDatabricksInput {
  hora_execucao: number | null
  dias_semana: string | null
  auto_coleta: boolean
  granularidade_dias?: number
}

export interface DatabricksLogEntry {
  ts: string
  msg: string
}

export interface DatabricksColetaProgresso {
  fase: string
  ins: number
  upd: number
  err: number
  log: DatabricksLogEntry[]
}

export interface DatabricksColetaStatus {
  em_execucao: boolean
  iniciada_em: string | null
  progresso: DatabricksColetaProgresso
}
