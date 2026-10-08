import { useQuery } from '@tanstack/react-query'
import { listSPs } from '../api/coleta'
import { useTenantFilter } from '../contexts/TenantFilterContext'

export function TenantSelector() {
  const spsQuery = useQuery({
    queryKey: ['coleta-sps'],
    queryFn: () => listSPs().then(sps => sps.filter(sp => sp.ativo)),
  })

  const { selectedTenantId, setSPFilter } = useTenantFilter()
  const sps = spsQuery.data || []

  // Não renderiza se há 1 ou menos SPs
  if (sps.length <= 1) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        Filtrar por Service Principal:
      </label>
      <select
        value={selectedTenantId === null ? 'all' : String(selectedTenantId)}
        onChange={(e) => setSPFilter(e.target.value === 'all' ? null : parseInt(e.target.value, 10))}
        style={{
          padding: '6px 10px',
          fontSize: 12,
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--surface)',
          color: 'var(--text)',
          cursor: 'pointer',
          flex: 1,
          maxWidth: 300,
        }}
      >
        <option value="all">🌐 Todas as SPs</option>
        {sps.map((sp) => (
          <option key={sp.id} value={String(sp.id)}>
            {sp.nome}
          </option>
        ))}
      </select>
    </div>
  )
}
