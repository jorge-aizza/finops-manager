// Quotas Genie via Databricks Account Budgets API — contrato espelha
// GET/POST/DELETE /api/databricks-coleta/genie-budgets (server.js). Diferente de
// DatabricksBudget (types/databricksResumo.ts — orçamento calculado por nós sobre
// databricks_consumo, só alerta): isto é a Budgets API NATIVA do Databricks
// (resource_type=BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY), aplicada pelo próprio
// Databricks — inclusive podendo bloquear acesso real ao Genie (ação BLOCK_USAGE).
// Pesquisado via documentação oficial, não validado contra uma conta Databricks real
// neste ambiente — nomes exatos de campo (principalmente spend status) podem precisar
// de ajuste na primeira chamada real.

export type GenieActionType = 'EMAIL_NOTIFICATION' | 'BLOCK_USAGE'
export type GenieScopeType = 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED' | 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER'

export interface GenieBudgetThresholdInput {
  quantity_threshold: string // dólares, como string (mesmo formato exigido pela API)
  scope_type: GenieScopeType
  action_type: GenieActionType
  email_target?: string // usado só quando action_type = EMAIL_NOTIFICATION
}

export interface GenieBudgetTagInput {
  key: string
  value: string
}

// Overrides (limite individual por usuário/grupo, até 20 por budget) só valem com
// threshold.scope_type = ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER — o Databricks os
// ignora silenciosamente em budgets de escopo compartilhado (validado também no
// servidor, ver POST /genie-budgets). principal_id vem da busca por e-mail/nome via
// Account SCIM API (ver GeniePrincipal abaixo) — a Budgets API só aceita o ID numérico
// interno, nunca o e-mail direto.
export interface GenieBudgetPrincipalOverride {
  principal_id: number
  override_threshold: string
}

export interface GenieBudgetInput {
  display_name: string
  workspace_ids: number[]
  tags: GenieBudgetTagInput[]
  threshold: GenieBudgetThresholdInput
  confirmar_bloqueio?: boolean // obrigatório (true) quando threshold.action_type = BLOCK_USAGE
  principal_overrides?: GenieBudgetPrincipalOverride[]
}

// GET /api/databricks-coleta/genie-principals — resultado de busca por e-mail (tipo
// 'user') ou nome (tipo 'group') via Account SCIM v2.1 API.
export interface GeniePrincipal {
  id: string
  nome: string
}

// Resposta crua da Budgets API — campos vistos na documentação; qualquer campo extra
// (ex: spend status, cujo shape exato não foi confirmado) passa direto sem tipagem
// rígida, renderizado defensivamente no card.
export interface GenieBudgetActionConfiguration {
  action_type: GenieActionType
  target?: string
}

export interface GenieBudgetAlertConfiguration {
  alert_configuration_id?: string
  time_period?: string
  trigger_type?: string
  quantity_type?: string
  quantity_threshold: string
  scope_type: GenieScopeType
  action_configurations: GenieBudgetActionConfiguration[]
}

export interface GenieBudgetFilter {
  workspace_id?: { operator?: string; values?: number[] }
  tags?: { key: string; value?: { operator?: string; values?: string[] } }[]
}

export interface GenieBudget {
  budget_configuration_id: string
  display_name: string
  resource_type: string
  filter?: GenieBudgetFilter
  alert_configurations: GenieBudgetAlertConfiguration[]
  create_time?: number
  update_time?: number
  [extra: string]: unknown // spend status e outros campos não confirmados pela documentação
}
