import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { diagAzureCosts, refreshAzureCache } from '../api/calculadora'

// Porta de _diagCache()/_forcarRefreshCache() (calculadora.js) — mostrado no
// lugar de "Nenhum resultado" no dropdown de Assinatura quando a lista vem
// vazia, pra diferenciar "banco vazio, precisa importar" de "cache
// desatualizado, precisa rebuild" sem precisar abrir o DevTools.
export default function SubDiagPanel() {
  const queryClient = useQueryClient()
  const diagQuery = useQuery({ queryKey: ['azure-costs-diag'], queryFn: diagAzureCosts })
  const refreshMutation = useMutation({
    mutationFn: refreshAzureCache,
    onSuccess: (r) => {
      if (r.subs > 0) {
        queryClient.invalidateQueries({ queryKey: ['calc-subs'] })
      } else {
        queryClient.invalidateQueries({ queryKey: ['azure-costs-diag'] })
      }
    },
  })

  const d = diagQuery.data
  const total = Number(d?.azure_costs.total || 0)
  const comSub = Number(d?.azure_costs.com_sub || 0)
  const comData = Number(d?.azure_costs.com_data || 0)
  const subs = d?.subs_cache.total ?? 0

  return (
    <div style={{ padding: '10px 12px', fontSize: 11, lineHeight: 1.7 }}>
      {diagQuery.isLoading && <div style={{ color: 'var(--text-muted)' }}>Diagnosticando...</div>}
      {refreshMutation.isPending && <div style={{ color: 'var(--text-muted)' }}>Reconstruindo cache...</div>}
      {d && !refreshMutation.isPending && (
        total === 0 ? (
          <div style={{ color: 'var(--danger)', fontWeight: 600 }}>❌ azure_costs está vazia — importe um CSV/Parquet</div>
        ) : comSub === 0 ? (
          <>
            <div style={{ color: 'var(--orange,#ff8c42)', fontWeight: 600 }}>
              ⚠ {total.toLocaleString('pt-BR')} linhas importadas mas subscription_id é nulo em todos
            </div>
            {d.colunas_amostra.length > 0 && (
              <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                Colunas encontradas: <span style={{ fontFamily: 'monospace' }}>{d.colunas_amostra.join(', ')}</span>
              </div>
            )}
            {d.amostra_valores && <div style={{ color: 'var(--text-muted)' }}>Amostra: {JSON.stringify(d.amostra_valores)}</div>}
          </>
        ) : (
          <>
            <div style={{ color: 'var(--green)' }}>
              ✅ {total.toLocaleString('pt-BR')} linhas · {comSub.toLocaleString('pt-BR')} com subscription · {comData.toLocaleString('pt-BR')} com data
            </div>
            <div style={{ color: 'var(--text-muted)' }}>Cache: {subs} assinatura(s)</div>
          </>
        )
      )}
      <button
        onClick={() => refreshMutation.mutate()}
        disabled={refreshMutation.isPending}
        style={{ marginTop: 8, fontSize: 11, padding: '3px 12px', background: 'rgba(147,51,234,.15)', border: '1px solid rgba(147,51,234,.4)', color: 'var(--accent)', borderRadius: 6, cursor: refreshMutation.isPending ? 'default' : 'pointer' }}
      >
        🔄 Forçar rebuild de cache
      </button>
    </div>
  )
}
