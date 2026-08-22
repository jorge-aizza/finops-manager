import type { PorServicoRow } from '../types/calculadora'

function brl(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Porta de _renderServico — ranking simples por consumed_service, com barra
// de % do total.
export default function PorServicoTable({ rows }: { rows: PorServicoRow[] }) {
  if (!rows.length) {
    return <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 12 }}>Nenhum dado encontrado para o período.</div>
  }
  const grand = rows.reduce((s, r) => s + (Number(r.total_brl) || 0), 0)

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-card)' }}>
        <tr>
          <th className="cth" style={{ width: 36, textAlign: 'center' }}>#</th>
          <th className="cth">Serviço (consumed_service)</th>
          <th className="cth" style={{ textAlign: 'right' }}>Recursos</th>
          <th className="cth" style={{ textAlign: 'right' }}>Resource Groups</th>
          <th className="cth" style={{ textAlign: 'right' }}>Total (BRL)</th>
          <th className="cth" style={{ textAlign: 'right' }}>% do Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const pct = grand > 0 ? ((Number(row.total_brl) || 0) / grand * 100) : 0
          return (
            <tr key={row.consumed_service} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '9px 10px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>{i + 1}</td>
              <td style={{ padding: '9px 10px', fontSize: 12, color: 'var(--text)' }}>{row.consumed_service}</td>
              <td style={{ padding: '9px 10px', fontSize: 12, color: 'var(--text-dim)', textAlign: 'right' }}>{(Number(row.qtd_recursos) || 0).toLocaleString('pt-BR')}</td>
              <td style={{ padding: '9px 10px', fontSize: 12, color: 'var(--text-dim)', textAlign: 'right' }}>{(Number(row.qtd_rgs) || 0).toLocaleString('pt-BR')}</td>
              <td style={{ padding: '9px 10px', fontSize: 12, fontWeight: 700, color: 'var(--accent)', textAlign: 'right', whiteSpace: 'nowrap' }}>{brl(Number(row.total_brl) || 0)}</td>
              <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                  <div style={{ width: 60, height: 6, borderRadius: 3, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: Math.min(pct, 100).toFixed(1) + '%', background: 'var(--accent)', borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{pct.toFixed(1)}%</span>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
