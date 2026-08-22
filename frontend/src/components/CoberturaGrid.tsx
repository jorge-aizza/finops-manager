import { useMemo, useState } from 'react'
import type { CoberturaMes } from '../types/coleta'

// Porta fiel da agregação de loadCoberturaMeses() (app.js): agrupa por
// YYYY-MM, depois por ano em 12 células (uma por mês, agregando todas as
// subscriptions daquele mês) — cor por % de cobertura do melhor caso
// (maxDiasSub / diasNoMes), não uma média entre subscriptions.

const MESES_LABEL = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

interface MonthCell {
  totalReg: number
  diasNoMes: number
  maxDiasSub: number
  pct: number
  ultimaColeta: string | null
  rows: CoberturaMes[]
}

function cellColor(pct: number, isCurrentMonth: boolean): string {
  if (isCurrentMonth) return 'var(--blue, #4da6ff)'
  if (pct >= 95) return 'var(--green, #22c55e)'
  if (pct >= 70) return 'var(--orange, #ff8c42)'
  return 'var(--danger, #ff4d6a)'
}

interface CoberturaGridProps {
  data: CoberturaMes[]
}

export default function CoberturaGrid({ data }: CoberturaGridProps) {
  const [selected, setSelected] = useState<string | null>(null) // 'YYYY-MM'

  const porAno = useMemo(() => {
    const porMes = new Map<string, CoberturaMes[]>()
    for (const r of data) {
      const key = r.mes.slice(0, 7)
      if (!porMes.has(key)) porMes.set(key, [])
      porMes.get(key)!.push(r)
    }
    const anos = new Map<string, (MonthCell | null)[]>()
    for (const [key, rows] of porMes) {
      const [ano, mesNum] = key.split('-')
      const idx = parseInt(mesNum, 10) - 1
      if (!anos.has(ano)) anos.set(ano, Array(12).fill(null))
      const totalReg = rows.reduce((s, r) => s + r.registros, 0)
      const diasNoMes = rows[0]?.dias_no_mes || 30
      const maxDiasSub = Math.max(...rows.map((r) => r.dias_com_dados), 0)
      const ultimaColeta = rows.reduce<string | null>(
        (max, r) => (!max || (r.ultima_importacao && r.ultima_importacao > max) ? r.ultima_importacao : max),
        null,
      )
      anos.get(ano)![idx] = {
        totalReg, diasNoMes, maxDiasSub,
        pct: diasNoMes > 0 ? Math.round((maxDiasSub / diasNoMes) * 100) : 0,
        ultimaColeta, rows,
      }
    }
    return [...anos.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [data])

  const hoje = new Date()
  const mesAtualKey = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`

  const detailRows = selected ? data.filter((r) => r.mes.slice(0, 7) === selected) : []

  if (!data.length) {
    return <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Nenhum dado de cobertura disponível ainda.</div>
  }

  return (
    <div>
      {porAno.map(([ano, meses]) => (
        <div key={ano} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <div style={{ width: 40, fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>{ano}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 4, flex: 1 }}>
            {meses.map((cell, i) => {
              const key = `${ano}-${String(i + 1).padStart(2, '0')}`
              const isCurrentMonth = key === mesAtualKey
              return (
                <div
                  key={i}
                  onClick={() => cell && setSelected(selected === key ? null : key)}
                  title={cell ? `${cell.pct}% de cobertura — ${cell.totalReg.toLocaleString('pt-BR')} registros` : 'Sem dados'}
                  style={{
                    textAlign: 'center', fontSize: 10, padding: '6px 2px', borderRadius: 5,
                    cursor: cell ? 'pointer' : 'default',
                    background: cell ? cellColor(cell.pct, isCurrentMonth) + '22' : 'var(--bg-hover)',
                    color: cell ? cellColor(cell.pct, isCurrentMonth) : 'var(--text-muted)',
                    border: '1px solid ' + (cell ? cellColor(cell.pct, isCurrentMonth) + '55' : 'var(--border)'),
                    fontWeight: selected === key ? 700 : 500,
                  }}
                >
                  <div>{MESES_LABEL[i]}</div>
                  {cell && <div style={{ fontSize: 9, marginTop: 1 }}>{cell.pct}%</div>}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {selected && (
        <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-hover)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
            Detalhe — {selected}
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Subscription</th>
                <th style={{ textAlign: 'right' }}>Registros</th>
                <th style={{ textAlign: 'right' }}>Dias com dados</th>
                <th>Última importação</th>
              </tr>
            </thead>
            <tbody>
              {detailRows.map((r) => (
                <tr key={r.subscription_id}>
                  <td>{r.subscription_name || r.subscription_id}</td>
                  <td style={{ textAlign: 'right' }}>{r.registros.toLocaleString('pt-BR')}</td>
                  <td style={{ textAlign: 'right' }}>{r.dias_com_dados} / {r.dias_no_mes}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{r.ultima_importacao || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
