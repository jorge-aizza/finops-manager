import { useMemo, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDiagnostico } from '../api/coleta'
import type { DiagnosticoLinha } from '../types/coleta'

interface Props {
  onClose: () => void
}

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const CHARGE_COLOR: Record<string, { bg: string; fg: string }> = {
  Usage: { bg: 'rgba(147,51,234,.1)', fg: 'var(--accent)' },
  Purchase: { bg: 'rgba(255,140,66,.1)', fg: 'var(--orange,#ff8c42)' },
}
const CHARGE_DEFAULT = { bg: 'rgba(77,166,255,.1)', fg: 'var(--blue,#4da6ff)' }

// Porta de #cdiag-modal / abrirDiagnostico()/_diagFiltrar() (calculadora.js)
// — dump de combinações meter_category × consumed_service × charge_type ×
// unit_of_measure em azure_costs, usado pra identificar como classificar
// recursos ao configurar RN-006/RN-DB-001. Mesmo caso do Expurgo: só era
// acionado por abrirDiagnosticoAzure() (app.js), dentro de #view-coleta —
// inalcançável desde que 'coleta' virou view migrada.
export default function DiagnosticoModal({ onClose }: Props) {
  const diagQuery = useQuery({ queryKey: ['calc-diagnostico'], queryFn: getDiagnostico })
  const [busca, setBusca] = useState('')
  const [charge, setCharge] = useState('')
  const [uom, setUom] = useState('')

  const dados = diagQuery.data || []
  const charges = useMemo(() => [...new Set(dados.map((r) => r.charge_type).filter(Boolean))].sort(), [dados])
  const uoms = useMemo(() => [...new Set(dados.map((r) => r.unit_of_measure).filter(Boolean))].sort(), [dados])

  const filtrado = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return dados.filter((r: DiagnosticoLinha) => {
      if (charge && r.charge_type !== charge) return false
      if (uom && r.unit_of_measure !== uom) return false
      if (q) {
        const txt = [r.meter_category, r.meter_sub_category, r.consumed_service, r.charge_type, r.unit_of_measure, r.pricing_model, r.publisher_type].join(' ').toLowerCase()
        if (!txt.includes(q)) return false
      }
      return true
    })
  }, [dados, busca, charge, uom])

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" style={{ width: 'min(96vw, 900px)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <div>
            <span>🔍 Diagnóstico dos Dados</span>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontWeight: 400 }}>
              Padrões de meter_category · consumed_service · charge_type · unit_of_measure
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '10px 22px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, flexShrink: 0 }}>
          <input type="text" className="ci" placeholder="Filtrar por qualquer coluna..." style={{ flex: 1, height: 32 }} value={busca} onChange={(e) => setBusca(e.target.value)} />
          <select className="cs" style={{ width: 180, height: 32 }} value={charge} onChange={(e) => setCharge(e.target.value)}>
            <option value="">Todos charge_type</option>
            {charges.map((c) => <option key={c} value={c!}>{c}</option>)}
          </select>
          <select className="cs" style={{ width: 180, height: 32 }} value={uom} onChange={(e) => setUom(e.target.value)}>
            <option value="">Todos unit_of_measure</option>
            {uoms.map((u) => <option key={u} value={u!}>{u}</option>)}
          </select>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center', whiteSpace: 'nowrap' }}>{filtrado.length} combinações</span>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-hover)' }}>
              <tr>
                <th className="cth" style={{ minWidth: 140 }}>meter_category</th>
                <th className="cth" style={{ minWidth: 140 }}>meter_sub_category</th>
                <th className="cth" style={{ minWidth: 160 }}>consumed_service</th>
                <th className="cth" style={{ minWidth: 100 }}>charge_type</th>
                <th className="cth" style={{ minWidth: 110 }}>unit_of_measure</th>
                <th className="cth" style={{ minWidth: 90 }}>pricing_model</th>
                <th className="cth" style={{ minWidth: 90 }}>publisher_type</th>
                <th className="cth" style={{ textAlign: 'right', minWidth: 60 }}>recursos</th>
                <th className="cth" style={{ textAlign: 'right', minWidth: 80 }}>linhas</th>
                <th className="cth" style={{ textAlign: 'right', minWidth: 110 }}>total billing</th>
              </tr>
            </thead>
            <tbody>
              {diagQuery.isLoading && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Carregando dados...</td></tr>}
              {diagQuery.isError && <tr><td colSpan={10} style={{ textAlign: 'center', padding: 30, color: '#ff4d6a' }}>Erro ao carregar diagnóstico.</td></tr>}
              {!diagQuery.isLoading && !diagQuery.isError && filtrado.length === 0 && (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Nenhum resultado.</td></tr>
              )}
              {filtrado.map((r, i) => {
                const col = (r.charge_type && CHARGE_COLOR[r.charge_type]) || CHARGE_DEFAULT
                return (
                  <tr key={i}>
                    <td style={cellStyle} title={r.meter_category || ''}>{r.meter_category || '—'}</td>
                    <td style={cellStyle} title={r.meter_sub_category || ''}>{r.meter_sub_category || '—'}</td>
                    <td style={cellStyle} title={r.consumed_service || ''}>{r.consumed_service || '—'}</td>
                    <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ padding: '2px 7px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: col.bg, color: col.fg }}>{r.charge_type || '—'}</span>
                    </td>
                    <td style={cellStyle} title={r.unit_of_measure || ''}>{r.unit_of_measure || '—'}</td>
                    <td style={cellStyle} title={r.pricing_model || ''}>{r.pricing_model || '—'}</td>
                    <td style={cellStyle} title={r.publisher_type || ''}>{r.publisher_type || '—'}</td>
                    <td style={numStyle}>{r.recursos}</td>
                    <td style={numStyle}>{Number(r.linhas).toLocaleString('pt-BR')}</td>
                    <td style={{ ...numStyle, color: 'var(--accent)' }}>{brl(r.total_billing || 0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '10px 22px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
          💡 Use estes padrões para identificar quais <strong>meter_category</strong>, <strong>consumed_service</strong> ou <strong>charge_type</strong> representam SaaS nos seus dados.
        </div>
      </div>
    </div>
  )
}

const cellStyle: CSSProperties = {
  padding: '7px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-dim)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160,
}
const numStyle: CSSProperties = {
  padding: '7px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right',
  fontFamily: "'IBM Plex Mono',monospace", color: 'var(--text-dim)',
}
