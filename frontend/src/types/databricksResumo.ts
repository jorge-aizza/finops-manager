// Contrato de server.js — Coleta Databricks Fase 3 (dashboard/orçamentos/alertas).
// Espelha GET /api/databricks-coleta/resumo, /budgets, /alertas.

export interface DatabricksResumoMes {
  mes: string   // 'YYYY-MM'
  custo: number
  // free/pago (2026-08-28) — mesma heurística de free_vs_pago (sku_name ILIKE '%FREE%' OU
  // custo_estimado=0), agora por mês — alimenta o breakdown de cores da Tendência Mensal
  // (MonthlyBarChart, DatabricksDashboardView.tsx) em vez de só o total.
  free: number
  pago: number
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
  // por_model_serving (2026-08-29, auditoria) — zero coleta nova: a documentação oficial
  // confirma que custo de Model Serving já vem inteiro de system.billing.usage (SKU
  // *_SERVERLESS_REAL_TIME_INFERENCE_*), já coletado desde a Fase 2.
  por_model_serving: { endpoint: string; custo: number }[]
}

// escopo_tipo 'tag' filtra por custom_tags->>tag_key = tag_valor (projeto/time/centro de
// custo — qualquer chave já presente nos dados coletados, ver GET .../tags). 'workspace'
// usa workspace_id; 'global' não filtra nada (todos os workspaces).
// 'workspace_por_usuario' e 'usuario' vieram do cockpit "Gestão de Cotas"
// (2026-09-11), que trabalha com um teto valendo para CADA usuário do
// workspace — conceito que não existia aqui:
//   workspace_por_usuario → workspace_id + valor = teto de CADA usuário do ws
//   usuario               → teto de UM usuário (workspace_id opcional restringe)
// Não confundir com as Quotas Genie: aquelas são a Budgets API nativa do
// Databricks e controlam acesso ao Genie, não o consumo geral.
export type DatabricksBudgetEscopoTipo =
  | 'global' | 'workspace' | 'tag' | 'workspace_por_usuario' | 'usuario'

export interface DatabricksBudget {
  id: number
  nome: string
  escopo_tipo: DatabricksBudgetEscopoTipo
  workspace_id: string | null
  tag_key: string | null
  tag_valor: string | null
  usuario: string | null
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
  usuario: string | null
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


// ── Cotas (consumo × teto) — alimenta a aba "Cotas", o semáforo trazido do
// cockpit. Diferente do cockpit original, onde o percentual vinha pronto numa
// planilha e podia divergir das linhas de consumo (medido: até 28×), aqui ele
// é SEMPRE derivado de databricks_consumo no servidor.
export type DatabricksCotaStatus = 'ok' | 'atencao' | 'critico' | 'estourado' | 'sem_cota'

export interface DatabricksCotaWorkspace {
  workspace_id: string
  custo: number
  dbus: number
  // free x pago: o card de custo esconde o volume free, que custa zero por
  // definição mas consome DBU de verdade. O modal mostra os dois.
  dbus_free: number
  dbus_pago: number
  cota: number | null       // null = nenhum orçamento de escopo 'workspace'
  pct: number | null
  budget_nome: string | null
  status: DatabricksCotaStatus
}

export interface DatabricksCotaUsuario {
  workspace_id: string
  usuario: string
  custo: number
  dbus: number
  dbus_free: number
  dbus_pago: number
  limite: number | null
  pct: number | null
  // 'individual' = orçamento de escopo 'usuario' venceu; 'workspace' = herdou
  // o teto de 'workspace_por_usuario' do ws dele.
  origem_limite: 'individual' | 'workspace' | null
  budget_nome: string | null
  status: DatabricksCotaStatus
}

export interface DatabricksCotas {
  mes: string
  /** meses que tem consumo gravado, mais recente primeiro — alimenta o seletor de Periodo */
  meses_disponiveis: string[]
  por_workspace: DatabricksCotaWorkspace[]
  por_usuario: DatabricksCotaUsuario[]
  resumo: {
    custo_total: number
    cota_total: number
    workspaces_sem_cota: number
    usuarios_acima_do_limite: number
  }
}
