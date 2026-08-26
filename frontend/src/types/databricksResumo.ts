// Contrato de server.js — Coleta Databricks Fase 3 (dashboard/orçamentos/alertas).
// Espelha GET /api/databricks-coleta/resumo, /budgets, /alertas.

export interface DatabricksResumoMes {
  mes: string   // 'YYYY-MM'
  custo: number
}

export interface DatabricksResumo {
  periodo: { inicio: string; fim: string }
  tem_dados: boolean
  total_custo: number
  por_mes: DatabricksResumoMes[]
  por_workspace: { workspace_id: string; custo: number }[]
  por_sku: { sku_name: string; custo: number }[]
  por_usuario: { usuario: string; custo: number }[]
  free_vs_pago: { free: number; pago: number }
}

export interface DatabricksBudget {
  id: number
  nome: string
  workspace_id: string | null
  valor_mensal: number
  ativo: boolean
  criado_em: string
  atualizado_em: string
}

export interface DatabricksBudgetInput {
  nome: string
  workspace_id: string | null
  valor_mensal: number
  ativo: boolean
}

export type DatabricksAlertaSeveridade = 'atencao' | 'critico' | 'estourado'

export interface DatabricksAlerta {
  budget: DatabricksBudget
  custo_atual: number
  pct: number
  severidade: DatabricksAlertaSeveridade
}
