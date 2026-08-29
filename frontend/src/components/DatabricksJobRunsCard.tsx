import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { getDatabricksJobRuns } from '../api/databricksColeta'
import type { DatabricksJobRun } from '../types/databricksJobRuns'

// Execuções de Job — tempo + custo (2026-08-29, pedido do usuário: "coletar o tempo que
// um Job executou e quanto custou"). Fonte: system.lakeflow.job_run_timeline (duração,
// status) — ver _coletarJobRunsDatabricks (server.js). Reaproveita o mesmo `periodo` e o
// filtro de drill-down `jobId` já usados pelo resto do Dashboard (clicar num job em "Por
// Job" também escopa esta lista, sem precisar de um seletor de período próprio).

function fmtBRL(v: number): string {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Igual ao formatDuracao já usado em ColetaView.tsx, com um degrau a mais pra horas —
// execuções de Job (diferente de uma coleta) rotineiramente passam de 1h.
function fmtDuracao(segundos: number | null): string {
  if (segundos == null) return '—'
  const s = Math.round(segundos)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function fmtQuando(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// result_state — valores confirmados na documentação oficial (ver types/databricksJobRuns.ts).
// Um valor desconhecido/futuro ainda renderiza, só cai no fallback cinza.
const RESULT_STATE_BADGE: Record<string, { color: string; bg: string; label: string }> = {
  SUCCEEDED: { color: 'var(--green,#22c55e)', bg: 'rgba(34,197,94,.10)', label: '✅ Sucesso' },
  FAILED: { color: 'var(--red,#ff4d6a)', bg: 'rgba(255,77,106,.10)', label: '❌ Falhou' },
  ERROR: { color: 'var(--red,#ff4d6a)', bg: 'rgba(255,77,106,.10)', label: '❌ Erro' },
  TIMED_OUT: { color: 'var(--orange,#ff8c42)', bg: 'rgba(255,140,66,.10)', label: '⏱ Timeout' },
  CANCELLED: { color: 'var(--text-muted)', bg: 'rgba(122,106,158,.10)', label: '⊘ Cancelado' },
  SKIPPED: { color: 'var(--text-muted)', bg: 'rgba(122,106,158,.10)', label: '⤼ Pulado' },
  BLOCKED: { color: 'var(--text-muted)', bg: 'rgba(122,106,158,.10)', label: '🚫 Bloqueado' },
}
const RESULT_STATE_DEFAULT = { color: 'var(--text-muted)', bg: 'rgba(122,106,158,.10)', label: '— Em andamento' }

function ResultStateBadge({ state }: { state: string | null }) {
  const b = (state && RESULT_STATE_BADGE[state]) || RESULT_STATE_DEFAULT
  const label = state && !RESULT_STATE_BADGE[state] ? state : b.label
  return (
    <span style={{ background: b.bg, color: b.color, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

export default function DatabricksJobRunsCard({ periodo, jobId }: { periodo: { inicio: string; fim: string }; jobId?: string }) {
  const runsQuery = useQuery({
    queryKey: ['databricks-job-runs', periodo.inicio, periodo.fim, jobId],
    queryFn: () => getDatabricksJobRuns(periodo.inicio, periodo.fim, jobId ? { job_id: jobId } : undefined),
    placeholderData: keepPreviousData,
  })
  const data = runsQuery.data

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Execuções de Job — Tempo e Custo</span>
        {data && data.total > 0 && <span className="badge">{data.total}{data.total >= 200 ? '+' : ''}</span>}
      </div>
      <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
        Duração e status vêm de <code>system.lakeflow.job_run_timeline</code> — schema separado de
        <code> system.billing</code>, precisa ser habilitado à parte por um account admin (ver "Testar
        Conexão"). Custo é correlacionado por <code>job_run_id</code> e só existe pra jobs em job
        compute/serverless compute — <code>—</code> nessa coluna significa "sem dado", não "grátis".
        {jobId && <> Filtrado pelo job selecionado acima.</>}
      </div>

      {runsQuery.isLoading && <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}

      {data && data.total === 0 && (
        <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          Nenhuma execução encontrada no período{jobId ? ' para este job' : ''}. Se o schema
          <code> system.lakeflow</code> não estiver habilitado na conta Databricks, esta lista fica
          sempre vazia mesmo com jobs rodando — confira em "Testar Conexão".
        </div>
      )}

      {data && data.total > 0 && (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job</th><th>Run</th><th>Início</th><th>Duração</th><th>Status</th><th style={{ textAlign: 'right' }}>Custo</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((run: DatabricksJobRun) => (
                <tr key={run.workspace_id + '/' + run.job_id + '/' + run.run_id}>
                  <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={run.job_name || run.job_id}>
                    {run.job_name || run.job_id}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)' }} title={run.run_id}>
                    {run.run_name || run.run_id}
                  </td>
                  <td style={{ fontSize: 12 }}>{fmtQuando(run.iniciado_em)}</td>
                  <td style={{ fontSize: 12 }}>{fmtDuracao(run.duracao_segundos)}</td>
                  <td><ResultStateBadge state={run.result_state} /></td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: run.custo_estimado == null ? 'var(--text-muted)' : undefined }}
                      title={run.custo_estimado == null ? 'Sem dado de billing correlacionado a este run (comum em jobs de cluster all-purpose)' : undefined}>
                    {run.custo_estimado == null ? '—' : fmtBRL(run.custo_estimado)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total >= 200 && (
        <div style={{ padding: '0 20px 16px', fontSize: 11, color: 'var(--text-muted)' }}>
          Mostrando as 200 execuções mais recentes do período — reduza o intervalo ou filtre por job pra ver mais detalhe.
        </div>
      )}
    </div>
  )
}
