import { Fragment, useMemo, useState } from 'react'
import type { DetalheDiarioRow } from '../types/calculadora'

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Porta de _renderDetalhe (visão "Por Data") — agrupa por (data, resource_id),
// expande pra ver o breakdown por serviço/meter daquele dia+recurso.
export default function DetalheDiarioTable({ rows }: { rows: DetalheDiarioRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const grupos = useMemo(() => {
    const map = new Map<string, { costDate: string; resourceId: string; nomeRecurso: string; resourceType: string; location: string; resourceGroupName: string; subscriptionName: string; total: number; subs: DetalheDiarioRow[] }>()
    const ordem: string[] = []
    for (const row of rows) {
      const k = row.cost_date + '||' + (row.resource_id || '')
      if (!map.has(k)) {
        map.set(k, {
          costDate: row.cost_date, resourceId: row.resource_id || '',
          nomeRecurso: row.nome_recurso || row.resource_id || '—',
          resourceType: row.resource_type || '—',
          location: row.location || '—',
          resourceGroupName: row.resource_group_name || '—',
          subscriptionName: row.subscription_name || '—',
          total: 0, subs: [],
        })
        ordem.push(k)
      }
      const g = map.get(k)!
      g.total += Number(row.cost) || 0
      g.subs.push(row)
    }
    return ordem.map((k) => ({ key: k, ...map.get(k)! }))
  }, [rows])

  if (!rows.length) {
    return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 12 }}>Nenhum dado encontrado para o período.</div>
  }

  function toggle(k: string) {
    setExpanded((prev) => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next })
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-card)' }}>
        <tr>
          <th className="cth" style={{ width: 28 }} />
          <th className="cth">Data</th>
          <th className="cth">Recurso</th>
          <th className="cth">Tipo</th>
          <th className="cth">Localização</th>
          <th className="cth">Resource Group</th>
          <th className="cth">Assinatura</th>
          <th className="cth" style={{ textAlign: 'right' }}>Custo (BRL)</th>
        </tr>
      </thead>
      <tbody>
        {grupos.map((g) => {
          const open = expanded.has(g.key)
          const dt = g.costDate ? g.costDate.slice(0, 10) : '—'
          const nomeShort = g.nomeRecurso.length > 60 ? '…' + g.nomeRecurso.slice(-50) : g.nomeRecurso
          return (
            <Fragment key={g.key}>
              <tr style={{ cursor: 'pointer', borderBottom: '1px solid var(--border)', background: open ? 'rgba(147,51,234,.08)' : undefined }} onClick={() => toggle(g.key)}>
                <td style={{ padding: '8px 6px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <span style={{ display: 'inline-block', transition: 'transform .2s', transform: open ? 'rotate(-180deg)' : undefined }}>▾</span>
                </td>
                <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text)', whiteSpace: 'nowrap' }}>{dt}</td>
                <td style={{ padding: '8px 10px', fontSize: 11, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span title={g.resourceId} style={{ color: 'var(--accent)', fontSize: 11 }}>{nomeShort}</span>
                </td>
                <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-dim)' }}>{g.resourceType}</td>
                <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-dim)' }}>{g.location}</td>
                <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-dim)' }}>{g.resourceGroupName}</td>
                <td style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-dim)' }}>{g.subscriptionName}</td>
                <td style={{ padding: '8px 10px', fontSize: 12, fontWeight: 700, color: 'var(--accent)', textAlign: 'right', whiteSpace: 'nowrap' }}>{brl(g.total)}</td>
              </tr>
              {open && (
                <tr>
                  <td colSpan={8} style={{ padding: '0 0 4px 32px', background: 'rgba(147,51,234,.05)', borderBottom: '2px solid var(--border)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '5px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', textAlign: 'left' }}>Nome do Serviço</th>
                          <th style={{ padding: '5px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', textAlign: 'left' }}>Meter</th>
                          <th style={{ padding: '5px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', textAlign: 'right' }}>Custo (BRL)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.subs.map((s, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                            <td style={{ padding: '5px 10px', fontSize: 11, color: 'var(--text)' }}>{s.service_name || '—'}</td>
                            <td style={{ padding: '5px 10px', fontSize: 11, color: 'var(--text-dim)' }}>{s.meter || '—'}</td>
                            <td style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, color: 'var(--accent)', textAlign: 'right' }}>{brl(Number(s.cost) || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )
}
