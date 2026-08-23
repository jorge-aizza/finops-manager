import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCmsDropdownPosition } from '../hooks/useCmsDropdownPosition'

// Variante multi-select do dropdown "CMS" (mesmo .cms-wrap/.cms-trigger/
// .cms-dropdown/.cms-option da Calculadora legada) — CmsSelect.tsx (Reservas)
// é single-select com radio; aqui os itens usam checkbox e o rodapé tem
// Todos/Limpar/OK. Mesmo padrão pending→commit: só "OK" aplica a seleção.
// Suporta cascata pai→filho (RG gerenciado, ex: DATABRICKS-RG-* sob seu RG
// pai) — marcar/desmarcar o pai propaga pros filhos, só dentro do pending.

export interface CmsMultiOption {
  value: string
  label: string
  sublabel?: string
  parentValue?: string | null
}

interface CmsMultiSelectProps {
  values: string[]
  options: CmsMultiOption[]
  searchPlaceholder: string
  triggerLabel: string
  loading?: boolean
  onChange: (values: string[]) => void
}

export default function CmsMultiSelect({
  values,
  options,
  searchPlaceholder,
  triggerLabel,
  loading,
  onChange,
}: CmsMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<Set<string>>(new Set(values))
  const wrapRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const pos = useCmsDropdownPosition(open, wrapRef)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node
      if (wrapRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function handleToggle() {
    if (!open) {
      setPending(new Set(values))
      setSearch('')
    }
    setOpen((o) => !o)
  }

  function toggleOpcao(value: string, checked: boolean) {
    setPending((prev) => {
      const next = new Set(prev)
      if (checked) next.add(value); else next.delete(value)
      // cascata: marcar/desmarcar o pai propaga pros filhos gerenciados
      for (const o of options) {
        if (o.parentValue === value) {
          if (checked) next.add(o.value); else next.delete(o.value)
        }
      }
      return next
    })
  }

  function handleConfirm() {
    onChange([...pending])
    setOpen(false)
  }

  function handleTodos() {
    setPending(new Set(options.map((o) => o.value)))
  }

  function handleLimpar() {
    setPending(new Set())
  }

  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  return (
    <div className="cms-wrap" ref={wrapRef}>
      <div className="cms-trigger" onClick={handleToggle}>
        <span style={{ flex: 1, fontSize: 13, color: values.length ? 'var(--text)' : 'var(--text-muted)' }}>
          {triggerLabel}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
        </svg>
      </div>
      {open && pos && createPortal(
        <div className="cms-dropdown" ref={dropdownRef} style={{ position: 'fixed', top: pos.top, left: pos.left, right: 'auto', width: pos.width }}>
          <div className="cms-search-wrap">
            <input
              className="cms-search"
              placeholder={searchPlaceholder}
              autoComplete="off"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="cms-options">
            {loading ? (
              <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>Nenhum resultado</div>
            ) : (
              filtered.map((o) => (
                <label className="cms-option" key={o.value} style={o.parentValue ? { paddingLeft: 28 } : undefined}>
                  <input
                    type="checkbox"
                    checked={pending.has(o.value)}
                    onChange={(e) => toggleOpcao(o.value, e.target.checked)}
                  />
                  {o.parentValue && <span style={{ color: 'var(--text-muted)' }}>↳ </span>}
                  <span className="cms-option-label" title={o.label}>{o.label}</span>
                  {o.sublabel && <span className="cms-option-sub" style={{ color: 'var(--text-muted)' }}>{o.sublabel}</span>}
                </label>
              ))
            )}
          </div>
          <div className="cms-footer">
            <button type="button" className="cms-btn" onClick={handleTodos}>Todos</button>
            <button type="button" className="cms-btn" onClick={handleLimpar}>Limpar</button>
            <button type="button" className="cms-btn cms-btn-ok" onClick={handleConfirm}>OK ✓</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
