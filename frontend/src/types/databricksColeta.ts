// Contrato de server.js — Coleta Databricks, Fase 1 (só configuração da conexão com a
// API — credenciais OAuth M2M do Service Principal + endpoint de execução SQL). Espelha
// 1:1 o contrato de ServicePrincipal/ServicePrincipalInput (types/coleta.ts) usado pela
// Coleta Azure. A coleta agendada de verdade (Fase 2) e o dashboard (Fase 3) ainda não
// existem — ver CLAUDE.md "Coleta Databricks".

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
