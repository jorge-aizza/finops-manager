import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCmsDropdownPosition } from '../hooks/useCmsDropdownPosition'

// Porta fiel do dropdown de busca "CMS" (.cms-wrap) usado pra Subscription/
// Resource Group na Reserva Azure (app.js: rsvToggleDrop/_buildRsvCmsOptions/
// rsvConfirmDrop/rsvClearDrop). Mesmo padrão pending→commit do original:
// abrir semeia "pending" a partir do valor já commitado; só "OK" confirma.

export interface CmsOption {
  value: string
  label: string
}

interface CmsSelectProps {
  value: string
  label: string
  options: CmsOption[]
  searchPlaceholder: string
  loading?: boolean
  onChange: (value: string, label: string) => void
  onClear: () => void
}

export default function CmsSelect({
  value,
  label,
  options,
  searchPlaceholder,
  loading,
  onChange,
  onClear,
}: CmsSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<CmsOption>({ value, label })
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
      setPending({ value, label })
      setSearch('')
    }
    setOpen((o) => !o)
  }

  function handleConfirm() {
    onChange(pending.value, pending.label)
    setOpen(false)
  }

  function handleClear() {
    onClear()
    setOpen(false)
  }

  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options
  const shown = filtered.slice(0, 300)

  return (
    <div className="cms-wrap" ref={wrapRef}>
      <div className="cms-trigger" onClick={handleToggle}>
        <span style={{ flex: 1, fontSize: 13, color: label ? 'var(--text)' : 'var(--text-muted)' }}>
          {label || '— selecione —'}
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
            ) : shown.length === 0 ? (
              <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>Nenhum resultado</div>
            ) : (
              shown.map((o) => (
                <label className="cms-option" key={o.value}>
                  <input type="radio" checked={pending.value === o.value} onChange={() => setPending(o)} />
                  <span className="cms-option-label">{o.label}</span>
                </label>
              ))
            )}
          </div>
          <div className="cms-footer">
            <button type="button" className="cms-btn" onClick={handleClear}>
              Limpar
            </button>
            <button type="button" className="cms-btn cms-btn-ok" onClick={handleConfirm}>
              OK ✓
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
