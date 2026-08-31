import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { getDatabricksStorageOtimizacao } from '../api/databricksColeta'

// Otimização de Storage / Predictive Optimization (2026-08-29, auditoria pedida pelo
// usuário) — TCO geral, fora do escopo de custo de compute. Fonte:
// system.storage.predictive_optimization_operations_history. usage_quantity em
// ESTIMATED_DBU (a documentação oficial confirma que é uma estimativa quando operações
// dividem recursos de cluster).

function fmtNum(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
}

export default function DatabricksStorageOtimizacaoCard({ periodo }: { periodo: { inicio: string; fim: string } }) {
  const q = useQuery({
    queryKey: ['databricks-storage-otimizacao', periodo.inicio, periodo.fim],
    queryFn: () => getDatabricksStorageOtimizacao(periodo.inicio, periodo.fim),
    placeholderData: keepPreviousData,
  })
  const data = q.data

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Otimização de Storage (Predictive Optimization)</span>
        {data && data.total > 0 && <span className="badge">{data.total}</span>}
      </div>
      <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
        Fonte: <code>system.storage.predictive_optimization_operations_history</code>.
        DBUs são <strong>estimados</strong> (a documentação oficial é explícita quando
        operações dividem recursos de cluster) — TCO de storage, separado do custo de compute.
      </div>

      {q.isLoading && <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}

      {data && data.total === 0 && (
        <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          Nenhuma operação encontrada no período. Predictive Optimization precisa estar
          habilitado no metastore, além do schema <code>system.storage</code> estar acessível.
        </div>
      )}

      {data && data.total > 0 && (
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr><th>Tabela</th><th>Operação</th><th style={{ textAlign: 'right' }}>Execuções</th><th style={{ textAlign: 'right' }}>Sucesso</th><th style={{ textAlign: 'right' }}>DBUs (estimado)</th></tr>
            </thead>
            <tbody>
              {data.operacoes.map((o, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 12 }} title={`${o.catalog_name}.${o.schema_name}.${o.table_name}`}>
                    {o.catalog_name}.{o.schema_name}.{o.table_name}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{o.operation_type || '—'}</td>
                  <td style={{ textAlign: 'right', fontSize: 12 }}>{o.operacoes}</td>
                  <td style={{ textAlign: 'right', fontSize: 12, color: o.sucesso < o.operacoes ? 'var(--orange,#ff8c42)' : 'var(--green,#22c55e)' }}>{o.sucesso}/{o.operacoes}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtNum(o.dbus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
