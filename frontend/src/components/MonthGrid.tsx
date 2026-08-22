import { useState } from 'react'
import { MESES } from '../config/acaoOptions'

// Porta fiel do bloco "Replicar meses" (index.html + app.js: replicarTodos/
// toggleMesSelect/toggleChipAuto/selecionarTodosChips/replicarSelecionados).
// Reaproveita as classes .month-chip/.month-checkboxes/.replicate-box já
// definidas globalmente em index.html (shell), incluindo .month-chip.checked.

export type MonthValues = Record<string, string> // chave = abbrev (jan, fev...)

interface MonthGridProps {
  title: string
  values: MonthValues
  onChange: (abbrev: string, value: string) => void
  onBulkChange: (patch: MonthValues) => void
}

export default function MonthGrid({ title, values, onChange, onBulkChange }: MonthGridProps) {
  const [replicateValue, setReplicateValue] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [panelOpen, setPanelOpen] = useState(false)

  function parsedReplicate(): number | null {
    const v = parseFloat(replicateValue)
    if (isNaN(v)) {
      window.showToast?.('Informe um valor para replicar', 'error')
      return null
    }
    return v
  }

  function handleTodosMeses() {
    const v = parsedReplicate()
    if (v === null) return
    const patch: MonthValues = {}
    MESES.forEach((m) => { patch[m.abbrev] = String(v) })
    onBulkChange(patch)
    setChecked(new Set(MESES.map((m) => m.abbrev)))
    setPanelOpen(true)
    window.showToast?.('Valor aplicado em todos os 12 meses', 'success')
  }

  function handleToggleChip(abbrev: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      const willCheck = !next.has(abbrev)
      if (willCheck) next.add(abbrev)
      else next.delete(abbrev)
      const v = parseFloat(replicateValue)
      if (willCheck && !isNaN(v)) onChange(abbrev, String(v))
      else if (!willCheck) onChange(abbrev, '')
      return next
    })
  }

  function handleMarcarTodos(marcar: boolean) {
    const v = parseFloat(replicateValue)
    setChecked(marcar ? new Set(MESES.map((m) => m.abbrev)) : new Set())
    const patch: MonthValues = {}
    MESES.forEach((m) => { patch[m.abbrev] = marcar && !isNaN(v) ? String(v) : '' })
    onBulkChange(patch)
    window.showToast?.(marcar ? 'Todos os meses marcados e preenchidos' : 'Todos os meses desmarcados e limpos', 'success')
  }

  function handleAplicarSelecionados() {
    const v = parsedReplicate()
    if (v === null) return
    if (checked.size === 0) {
      window.showToast?.('Selecione ao menos um mês', 'error')
      return
    }
    const patch: MonthValues = {}
    checked.forEach((abbrev) => { patch[abbrev] = String(v) })
    onBulkChange(patch)
    window.showToast?.(`Valor aplicado em ${checked.size} mês(es) selecionado(s)`, 'success')
  }

  const total = MESES.reduce((s, m) => s + (parseFloat(values[m.abbrev]) || 0), 0)

  return (
    <>
      <div className="months-section-title">
        {title} {total > 0 && <span style={{ color: 'var(--accent)' }}>— R$ {total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>}
      </div>
      <div className="replicate-box">
        <div className="replicate-box-title">Replicar valor</div>
        <div className="replicate-row">
          <input
            type="number"
            step="0.01"
            placeholder="Ex: 1500,00"
            value={replicateValue}
            onChange={(e) => setReplicateValue(e.target.value)}
          />
          <button type="button" className="btn-rep" onClick={handleTodosMeses}>
            Todos os meses
          </button>
          <button type="button" className="btn-rep secondary" onClick={() => setPanelOpen((o) => !o)}>
            Selecionar meses
          </button>
        </div>
        <div className={'month-checkboxes' + (panelOpen ? ' open' : '')}>
          {MESES.map((m) => (
            <span
              key={m.abbrev}
              className={'month-chip' + (checked.has(m.abbrev) ? ' checked' : '')}
              onClick={() => handleToggleChip(m.abbrev)}
            >
              {m.label}
            </span>
          ))}
          <div className="month-chips-actions">
            <button type="button" className="btn-rep" onClick={handleAplicarSelecionados}>
              Aplicar nos selecionados
            </button>
            <button type="button" className="btn-rep secondary" onClick={() => handleMarcarTodos(true)}>
              Marcar todos
            </button>
            <button type="button" className="btn-rep secondary" onClick={() => handleMarcarTodos(false)}>
              Desmarcar todos
            </button>
          </div>
        </div>
      </div>
      <div className="months-grid">
        {MESES.map((m) => (
          <div className="form-group" key={m.abbrev}>
            <label htmlFor={`${title}-${m.abbrev}`}>{m.full}</label>
            <input
              id={`${title}-${m.abbrev}`}
              type="number"
              step="0.01"
              placeholder="0,00"
              aria-label={`${title} — ${m.full}`}
              value={values[m.abbrev] || ''}
              onChange={(e) => onChange(m.abbrev, e.target.value)}
            />
          </div>
        ))}
      </div>
    </>
  )
}
