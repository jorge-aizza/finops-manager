import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { getDatabricksClusterUtilizacao } from '../api/databricksColeta'

// Utilização de Cluster (2026-08-29, auditoria pedida pelo usuário) — a diferença entre
// "visibilidade de custo" (já tínhamos, por cluster) e "otimização de custo" (rightsizing):
// mostra se um cluster caro está sendo usado de verdade ou só ligado à toa. Fonte:
// system.compute.node_timeline — ver _coletarUtilizacaoDatabricks (server.js).

function pctColor(pct: number | null): string {
  if (pct == null) return 'var(--text-muted)'
  if (pct < 15) return 'var(--red,#ff4d6a)'
  if (pct < 40) return 'var(--orange,#ff8c42)'
  return 'var(--green,#22c55e)'
}

function fmtPct(pct: number | null): string {
  return pct == null ? '—' : pct.toFixed(1) + '%'
}

export default function DatabricksClusterUtilizacaoCard({ periodo }: { periodo: { inicio: string; fim: string } }) {
  const q = useQuery({
    queryKey: ['databricks-cluster-utilizacao', periodo.inicio, periodo.fim],
    queryFn: () => getDatabricksClusterUtilizacao(periodo.inicio, periodo.fim),
    placeholderData: keepPreviousData,
  })
  const data = q.data

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Utilização de Cluster</span>
        {data && data.total > 0 && <span className="badge">{data.total}</span>}
      </div>
      <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
        Fonte: <code>system.compute.node_timeline</code> — cobre clusters all-purpose e jobs
        compute (não cobre SQL Warehouses nem serverless). Ordenado do mais ocioso pro menos
        ocioso — <strong style={{ color: 'var(--red,#ff4d6a)' }}>vermelho</strong> = CPU média
        abaixo de {data?.threshold_ocioso_pct ?? 15}% no período, candidato a rightsizing.
      </div>

      {q.isLoading && <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}

      {data && data.total === 0 && (
        <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          Nenhum dado no período. Se o schema <code>system.compute</code> não estiver habilitado
          na conta Databricks, esta lista fica sempre vazia mesmo com clusters rodando.
        </div>
      )}

      {data && data.total > 0 && (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>Cluster</th><th>Dono</th><th style={{ textAlign: 'right' }}>CPU média</th><th style={{ textAlign: 'right' }}>Memória média</th><th style={{ textAlign: 'right' }}>Dias observados</th></tr>
            </thead>
            <tbody>
              {data.clusters.map((c) => (
                <tr key={c.workspace_id + '/' + c.cluster_id}>
                  <td title={c.cluster_id}>
                    {c.ocioso && <span title={`CPU média abaixo de ${data.threshold_ocioso_pct}% — candidato a rightsizing`} style={{ marginRight: 6 }}>⚠️</span>}
                    {c.cluster_name || c.cluster_id}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.owned_by || '—'}</td>
                  <td style={{ textAlign: 'right', color: pctColor(c.avg_cpu_percent), fontWeight: 700 }}>{fmtPct(c.avg_cpu_percent)}</td>
                  <td style={{ textAlign: 'right', color: pctColor(c.avg_mem_percent) }}>{fmtPct(c.avg_mem_percent)}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>{c.dias_observados}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
