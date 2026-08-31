import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { getDatabricksQueryHistory } from '../api/databricksColeta'

// Custo/performance por Query em SQL Warehouse (2026-08-29, auditoria pedida pelo
// usuário) — equivalente ao que "Execuções de Job" trouxe pra Jobs, mas pra queries SQL.
// Fonte: system.query.history — sem coluna de custo própria; custo_estimado é uma
// ALOCAÇÃO PROPORCIONAL calculada em server.js (não um valor de billing exato).

function fmtBRL(v: number): string {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDuracao(ms: number | null): string {
  if (ms == null) return '—'
  const s = Math.round(ms / 1000)
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

const STATUS_COLOR: Record<string, string> = {
  FINISHED: 'var(--green,#22c55e)', FAILED: 'var(--red,#ff4d6a)', CANCELED: 'var(--text-muted)',
}

export default function DatabricksQueryHistoryCard({ periodo }: { periodo: { inicio: string; fim: string } }) {
  const q = useQuery({
    queryKey: ['databricks-query-history', periodo.inicio, periodo.fim],
    queryFn: () => getDatabricksQueryHistory(periodo.inicio, periodo.fim),
    placeholderData: keepPreviousData,
  })
  const data = q.data

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Queries em SQL Warehouse</span>
        {data && data.total > 0 && <span className="badge">{data.total}{data.total >= 200 ? '+' : ''}</span>}
      </div>
      <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
        Fonte: <code>system.query.history</code> — schema separado de <code>system.billing</code>.
        <strong> Custo é uma alocação proporcional</strong> (custo diário do warehouse dividido
        pela duração de cada query naquele dia) — a Statement Execution API não expõe custo por
        query individual, então isso é uma estimativa, não um valor de billing exato.
      </div>

      {q.isLoading && <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}

      {data && data.total === 0 && (
        <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          Nenhuma query encontrada no período. Se o schema <code>system.query</code> não estiver
          habilitado na conta Databricks, esta lista fica sempre vazia.
        </div>
      )}

      {data && data.total > 0 && (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>Warehouse</th><th>Usuário</th><th>Tipo</th><th>Início</th><th>Duração</th><th>Status</th><th style={{ textAlign: 'right' }}>Custo (estimado)</th></tr>
            </thead>
            <tbody>
              {data.queries.map((qi) => (
                <tr key={qi.workspace_id + '/' + qi.statement_id}>
                  <td style={{ fontSize: 12 }}>{qi.warehouse_id || '—'}</td>
                  <td style={{ fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={qi.executed_by || ''}>{qi.executed_by || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{qi.statement_type || '—'}</td>
                  <td style={{ fontSize: 12 }}>{fmtQuando(qi.iniciado_em)}</td>
                  <td style={{ fontSize: 12 }}>{fmtDuracao(qi.duracao_total_ms)}</td>
                  <td style={{ fontSize: 12, color: (qi.execution_status && STATUS_COLOR[qi.execution_status]) || 'var(--text-muted)' }}>{qi.execution_status || '—'}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: qi.custo_estimado == null ? 'var(--text-muted)' : undefined }}
                      title={qi.custo_estimado == null ? 'Sem custo de warehouse pra correlacionar nesse dia' : 'Alocação proporcional pela duração — não é um valor de billing exato'}>
                    {qi.custo_estimado == null ? '—' : fmtBRL(qi.custo_estimado)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total >= 200 && (
        <div style={{ padding: '0 20px 16px', fontSize: 11, color: 'var(--text-muted)' }}>
          Mostrando as 200 queries mais recentes do período.
        </div>
      )}
    </div>
  )
}
