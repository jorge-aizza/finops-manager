// Contrato de server.js — GET /api/databricks-coleta/job-runs (2026-08-29, pedido do
// usuário: "coletar o tempo que um Job executou e quanto custou"). Fonte:
// system.lakeflow.job_run_timeline + system.lakeflow.jobs (duração/status), correlacionado
// em leitura com databricks_consumo.usage_metadata->>'job_run_id' (custo). Ver
// _coletarJobRunsDatabricks/ _DBX_OPTIONAL_TABLES em server.js.

// result_state — valores confirmados na documentação oficial do Databricks (não um enum
// fechado no nosso lado — um valor novo/desconhecido ainda renderiza, só sem badge colorido
// específico, ver STATUS_BADGE em JobRunsCard).
export type DatabricksJobRunResultState =
  | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED' | 'TIMED_OUT' | 'ERROR' | 'BLOCKED'

export interface DatabricksJobRun {
  workspace_id: string
  job_id: string
  run_id: string
  job_name: string | null
  run_name: string | null
  run_type: string | null // JOB_RUN | SUBMIT_RUN | WORKFLOW_RUN
  trigger_type: string | null
  iniciado_em: string | null
  concluido_em: string | null
  duracao_segundos: number | null
  // custo_estimado === null (não 0) quando não há nenhuma linha de billing com esse
  // job_run_id — a documentação do Databricks confirma que esse campo só é populado pra
  // jobs em job compute/serverless compute, nunca em cluster all-purpose. 0 sugeriria
  // "rodou de graça"; null deixa claro que o dado não está disponível pra esse run.
  custo_estimado: number | null
  result_state: DatabricksJobRunResultState | string | null
  termination_code: string | null
}

export interface DatabricksJobRunsResposta {
  periodo: { inicio: string; fim: string }
  tem_dados: boolean
  total: number
  runs: DatabricksJobRun[]
}
