// Contrato de server.js — 4 features novas da auditoria de 2026-08-29 (pedido do usuário:
// validar contra a documentação oficial do Databricks e cobrir lacunas de "Controle de
// Custos"). Cada uma lê um schema de System Tables SEPARADO de system.billing, habilitado
// à parte por um account admin — ver _DBX_OPTIONAL_TABLES/testar em server.js.

// Utilização de Cluster — system.compute.node_timeline + clusters. `ocioso` (threshold
// configurável no servidor, ver _CLUSTER_OCIOSO_CPU_PCT) sinaliza clusters candidatos a
// rightsizing — visibilidade de custo (já tínhamos) não é o mesmo que otimização de custo.
export interface DatabricksClusterUtilizacao {
  workspace_id: string
  cluster_id: string
  cluster_name: string | null
  owned_by: string | null
  avg_cpu_percent: number | null
  avg_mem_percent: number | null
  dias_observados: number
  ocioso: boolean
}
export interface DatabricksClusterUtilizacaoResposta {
  periodo: { inicio: string; fim: string }
  tem_dados: boolean
  total: number
  threshold_ocioso_pct: number
  clusters: DatabricksClusterUtilizacao[]
}

// Custo por Query em SQL Warehouse — system.query.history (sem coluna de custo própria).
// custo_estimado é uma ALOCAÇÃO PROPORCIONAL (custo diário do warehouse dividido pela
// duração de cada query naquele dia) — nunca um valor de billing exato, diferente do custo
// por Job Run (que correlaciona por job_run_id direto). null quando não há custo de
// warehouse pra correlacionar naquele dia.
export interface DatabricksQueryHistoryItem {
  workspace_id: string
  statement_id: string
  warehouse_id: string | null
  statement_type: string | null
  executed_by: string | null
  iniciado_em: string | null
  concluido_em: string | null
  duracao_total_ms: number | null
  execution_status: string | null
  custo_estimado: number | null
}
export interface DatabricksQueryHistoryResposta {
  periodo: { inicio: string; fim: string }
  tem_dados: boolean
  total: number
  queries: DatabricksQueryHistoryItem[]
}

// AI Gateway — volume de modelos externos. SEM custo em R$/US$: a documentação oficial
// confirma que system.ai_gateway.usage não tem coluna de spend (Databricks não sabe quanto
// o provedor externo cobra) — só tokens/requisições.
export interface DatabricksAiGatewayDestino {
  destination_name: string
  destination_model: string | null
  requisicoes: number
  input_tokens: number
  output_tokens: number
}
export interface DatabricksAiGatewayResposta {
  periodo: { inicio: string; fim: string }
  tem_dados: boolean
  total: number
  destinos: DatabricksAiGatewayDestino[]
}

// Otimização de Storage / Predictive Optimization — usage_quantity em ESTIMATED_DBU
// (documentação oficial confirma que é estimativa quando operações dividem recursos de
// cluster).
export interface DatabricksStorageOtimizacaoItem {
  catalog_name: string | null
  schema_name: string | null
  table_name: string | null
  operation_type: string | null
  operacoes: number
  dbus: number
  sucesso: number
}
export interface DatabricksStorageOtimizacaoResposta {
  periodo: { inicio: string; fim: string }
  tem_dados: boolean
  total: number
  operacoes: DatabricksStorageOtimizacaoItem[]
}
