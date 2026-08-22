import { useMemo, useState } from 'react'

export interface CheckboxItem {
  id: string
  label: string
  sublabel?: string
}

interface CheckboxSearchListProps {
  items: CheckboxItem[]
  selected: Set<string>
  onToggle: (id: string, checked: boolean) => void
  onSelectAll: (checked: boolean) => void
  loading?: boolean
  emptyText?: string
  searchPlaceholder?: string
}

// Lista com busca + "Selecionar todos" — usado pelos pickers ao vivo de
// subscriptions/resource groups do wizard de coleta e do modal de
// agendamento rápido (Fase B). Diferente de CmsMultiSelect (dropdown
// pending→commit): aqui a seleção já é o estado real, sempre visível
// (porta de _wizardRenderSubs/_wizardRenderRGs/_agendRenderSubs).
export default function CheckboxSearchList({
  items, selected, onToggle, onSelectAll, loading, emptyText = 'Nenhum item encontrado.',
  searchPlaceholder = 'Buscar...',
}: CheckboxSearchListProps) {
  const [busca, setBusca] = useState('')

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.label.toLowerCase().includes(q) || (i.sublabel || '').toLowerCase().includes(q))
  }, [items, busca])

  const todosMarcados = filtrados.length > 0 && filtrados.every((i) => selected.has(i.id))

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
        <input type="text" className="ci" placeholder={searchPlaceholder} value={busca} onChange={(e) => setBusca(e.target.value)} style={{ flex: 1 }} />
        <button type="button" className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }} onClick={() => onSelectAll(!todosMarcados)}>
          {todosMarcados ? 'Limpar' : 'Todos'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{selected.size} selecionado{selected.size !== 1 ? 's' : ''}</span>
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Carregando...</div>}
        {!loading && filtrados.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{emptyText}</div>
        )}
        {!loading && filtrados.map((item) => (
          <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', fontSize: 12, borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.has(item.id)} onChange={(e) => onToggle(item.id, e.target.checked)} />
            <span>
              {item.label}
              {item.sublabel && <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 11 }}>{item.sublabel}</span>}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
