// Contrato de server.js — Coleta Databricks Fase 3 (dashboard/orçamentos/alertas).
// Espelha GET /api/databricks-coleta/resumo, /budgets, /alertas.

export interface DatabricksResumoMes {
  mes: string   // 'YYYY-MM'
  custo: number
}

// por_job/por_cluster/por_warehouse (2026-08-28) — zero coleta nova: agregados sobre
// usage_metadata (JSONB) já capturado por recurso desde a Fase 2. Sem nome amigável pra
// cluster/warehouse (usage_metadata não traz cluster_name — só node_type; nome de
// verdade precisaria de uma coleta nova contra system.compute.clusters, fora de escopo).
export interface DatabricksResumo {
  periodo: { inicio: string; fim: string }
  tem_dados: boolean
  total_custo: number
  por_mes: DatabricksResumoMes[]
  por_workspace: { workspace_id: string; custo: number }[]
  por_sku: { sku_name: string; custo: number }[]
  por_usuario: { usuario: string; custo: number }[]
  free_vs_pago: { free: number; pago: number }
  // dbus_free_vs_pago (2026-08-28) — mesma heurística free/pago (sku_name ILIKE '%FREE%'
  // OU custo_estimado=0) aplicada sobre usage_quantity (DBUs) em vez de custo_estimado
  // (R$) — quantas unidades de DBU foram consumidas, não quanto custaram.
  dbus_free_vs_pago: { free: number; pago: number }
  por_job: { job_id: string; job_name: string | null; custo: number }[]
  por_cluster: { cluster_id: string; custo: number }[]
  por_warehouse: { warehouse_id: string; custo: number }[]
}

// escopo_tipo 'tag' filtra por custom_tags->>tag_key = tag_valor (projeto/time/centro de
// custo — qualquer chave já presente nos dados coletados, ver GET .../tags). 'workspace'
// usa workspace_id; 'global' não filtra nada (todos os workspaces).
export type DatabricksBudgetEscopoTipo = 'global' | 'workspace' | 'tag'

export interface DatabricksBudget {
  id: number
  nome: string
  escopo_tipo: DatabricksBudgetEscopoTipo
  workspace_id: string | null
  tag_key: string | null
  tag_valor: string | null
  valor_mensal: number
  threshold_atencao: number // % — antes fixo em 75 no servidor, agora configurável por orçamento
  threshold_critico: number // % — antes fixo em 90
  ativo: boolean
  criado_em: string
  atualizado_em: string
}

export interface DatabricksBudgetInput {
  nome: string
  escopo_tipo: DatabricksBudgetEscopoTipo
  workspace_id: string | null
  tag_key: string | null
  tag_valor: string | null
  valor_mensal: number
  threshold_atencao: number
  threshold_critico: number
  ativo: boolean
}

export type DatabricksAlertaSeveridade = 'atencao' | 'critico' | 'estourado'

export interface DatabricksAlerta {
  budget: DatabricksBudget
  custo_atual: number
  pct: number
  severidade: DatabricksAlertaSeveridade
}

// Anomaly Detection — GET /api/databricks-coleta/anomalias (ver _computeAnomaliasDatabricks,
// server.js). custo_diario = Z-score sobre a série de custo/dia (global ou por workspace);
// usuarios = % de crescimento da janela recente (7d) vs. histórica (4 semanas anteriores),
// crescimento_pct null = usuário novo sem histórico anterior pra comparar.
export interface DatabricksAnomaliaCustoDiario {
  escopo_tipo: 'global' | 'workspace'
  escopo_valor: string | null
  usage_date: string
  custo: number
  media: number
  desvio: number
  zscore: number
}

export interface DatabricksAnomaliaUsuario {
  usuario: string
  custo_recente: number
  media_diaria_recente: number
  custo_historico: number
  media_diaria_historica: number
  crescimento_pct: number | null
}

export interface DatabricksAnomalias {
  custo_diario: DatabricksAnomaliaCustoDiario[]
  usuarios: DatabricksAnomaliaUsuario[]
}
