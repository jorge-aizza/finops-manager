// Contrato de server.js — Coleta Databricks. Fase 1: configuração da conexão (credenciais
// OAuth M2M do Service Principal + endpoint de execução SQL). Fase 2: agendamento +
// coleta real contra system.billing.usage/system.billing.list_prices. Espelha 1:1 o
// contrato de ServicePrincipal/ServicePrincipalInput (types/coleta.ts) usado pela Coleta
// Azure. Dashboard (Fase 3) ainda não existe — ver CLAUDE.md "Coleta Databricks".

// modo_auth — pedido do usuário (2026-08-26): 'oauth_m2m' (Service Principal da conta
// Databricks, o padrão original) ou 'pat' (Personal Access Token — alternativa mais
// simples pra quem não tem acesso de account admin pra criar um Service Principal;
// só precisa de workspace_host+warehouse_id+token, sem account_id/client_id/secret).
export type DatabricksAuthMode = 'oauth_m2m' | 'pat'

export interface DatabricksConfig {
  id: number
  nome: string
  modo_auth: DatabricksAuthMode
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

// client_secret/token nunca voltam do GET — só são enviados (opcional) no save.
export interface DatabricksConfigInput {
  nome: string
  modo_auth: DatabricksAuthMode
  account_id?: string
  client_id?: string
  client_secret?: string
  token?: string
  workspace_host: string
  warehouse_id: string
  ativo: boolean
}

export interface TestarDatabricksTabela {
  ok: boolean
  message: string
}

// tabelas: presente só quando a autenticação/warehouse passaram — cada uma das System
// Tables exigidas (system.billing.usage/system.billing.list_prices) testada individualmente,
// pra diferenciar "credencial errada" de "schema system.billing não habilitado na conta" ou
// "Service Principal sem grant nas tabelas" (mesmo warehouse, causas raiz bem diferentes).
// tabelas_opcionais (2026-08-29) — system.lakeflow.job_run_timeline/jobs, usadas só pela
// feature de "Execuções de Job" (tempo + status). Opcionais de propósito: um schema
// separado de system.billing, pode estar desabilitado sem afetar custo por recurso —
// `opcionais_ok=false` não derruba `ok` (a conexão continua "OK" pro básico).
export interface TestarDatabricksResponse {
  ok: boolean
  message: string
  tabelas?: Record<string, TestarDatabricksTabela>
  tabelas_opcionais?: Record<string, TestarDatabricksTabela>
  opcionais_ok?: boolean
  opcionais_aviso?: string | null
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
