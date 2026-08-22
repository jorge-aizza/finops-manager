import type { CSSProperties } from 'react'
import type { DbTaxaInfo, RecursoBilling } from '../types/calculadora'

// Porta fiel de _custoHora (calculadora.js:4856-4975) — coluna "Custo/h · /mês"
// da tabela de recursos. Sempre baseado na MÉDIA do billing (nunca pico —
// isso só existe no overlay Configurar Estimativa). JSX estruturado em vez
// de string HTML, mas mesmos valores/textos/cores do legado.

function brl(v: number): string {
  return 'R$\xA0' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function qLinha(n: number, sufixo: string, cor?: string) {
  if (n <= 0) return null
  return (
    <div style={{ fontSize: 9, color: cor || 'var(--text-muted)', marginTop: 1, whiteSpace: 'nowrap' }}>
      {n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}{' '}{sufixo}
    </div>
  )
}

interface CustoHoraCellProps {
  r: RecursoBilling
  isBRL: boolean
  taxaBrl: number
  dbInfo: DbTaxaInfo | null
}

export default function CustoHoraCell({ r, isBRL, taxaBrl, dbInfo }: CustoHoraCellProps) {
  const mono: CSSProperties = { fontFamily: "'IBM Plex Mono',monospace" }
  const uom = (r.unidade || '').toLowerCase()
  const tipo = r.tipo_custo || (uom.includes('hour') || uom.includes('hora') ? 'hora' : 'periodo')
  const tcDB = Number(r.taxa_cambio) || 0
  const convR = !isBRL ? (tcDB > 1 ? tcDB : taxaBrl) : 1
  const raw = Number(r.custo_hora_billing) || 0
  const preco = isBRL ? raw : raw * convR
  const moedaTitle = !isBRL
    ? `${r.moeda || 'USD'} × ${(tcDB > 1 ? tcDB : taxaBrl).toFixed(2)} = BRL${tcDB > 1 ? ' (taxa Azure)' : ' (taxa manual)'}`
    : undefined

  const totalQty = Number(r.total_qty) || 0
  const horasR = Number(r.horas_reais) || 0

  if (tipo === 'reserva') {
    return (
      <>
        <div style={{ ...mono, fontSize: 11, color: 'var(--blue,#4da6ff)', whiteSpace: 'nowrap' }} title={moedaTitle}>{brl(preco)}</div>
        <div style={{ fontSize: 9, color: 'var(--blue,#4da6ff)' }} title="Amortizado pelo term da reserva (1 ano=8.760h / 3 anos=26.280h)">🔒 amort./h</div>
        {qLinha(totalQty, r.unidade || 'un.')}
      </>
    )
  }

  if (tipo === 'hora') {
    const uomFator = Math.max(parseFloat((r.unidade || '').replace(/[^0-9]/g, '') || '1'), 1)
    const h = horasR > 0 ? Math.round(horasR) : Math.round(totalQty * uomFator)
    const taxaAmortH = (Number(r.taxa_hora_rate) || 0) * convR
    const precoEfet = raw > 0 ? preco : (r.usa_amortizado && taxaAmortH > 0 ? taxaAmortH : preco)
    const dbCtxVld = !!(dbInfo && dbInfo.valida)
    const billBrlH = isBRL ? (Number(r.total_billing) || 0) : (Number(r.total_billing) || 0) * convR
    const taxaClH = dbCtxVld ? billBrlH / dbInfo!.hDriver : 0
    return (
      <>
        <div style={{ ...mono, fontSize: 11, color: 'var(--accent)', whiteSpace: 'nowrap' }} title={moedaTitle}>{brl(precoEfet)}</div>
        {uom.includes('dbu')
          ? <div style={{ fontSize: 9, color: 'var(--blue,#4da6ff)' }}>⚡{' '}/DBU·h</div>
          : <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>/h cobrado</div>}
        {r.usa_amortizado && raw === 0 && taxaAmortH > 0 && (
          <div style={{ fontSize: 9, color: 'var(--blue,#4da6ff)', marginTop: 1, whiteSpace: 'nowrap' }}
            title="Custo amortizado: VM coberta por Reserva ou Savings Plan — effective_price × qty ÷ qty = taxa real proporcional">
            ⚡{' '}amort./h
          </div>
        )}
        {r.usa_30d && (
          <div style={{ fontSize: 9, color: 'var(--blue,#4da6ff)', marginTop: 1, whiteSpace: 'nowrap' }}
            title="Média dos últimos 30 dias do billing — período selecionado tem menos de 30 dias">
            📅{' '}30d
          </div>
        )}
        {dbCtxVld && (
          <div style={{ fontSize: 9, color: 'var(--blue,#4da6ff)', marginTop: 2, whiteSpace: 'nowrap', borderTop: '1px solid rgba(77,166,255,.15)', paddingTop: 2 }}
            title="Taxa proporcional do workspace: billing_vm ÷ H_driver = contribuição desta VM ao custo/h do cluster">
            ⚡{' '}cluster:{' '}{brl(taxaClH)}/h
          </div>
        )}
        {qLinha(h, 'h consumidas')}
      </>
    )
  }

  if (tipo === 'dia') {
    return (
      <>
        <div style={{ ...mono, fontSize: 11, color: 'var(--accent)', whiteSpace: 'nowrap' }} title={moedaTitle}>{brl(preco)}</div>
        <div style={{ fontSize: 9, color: 'var(--text-muted)' }} title="UoM diária ÷ 24">/h (dia)</div>
        {r.usa_30d && (
          <div style={{ fontSize: 9, color: 'var(--blue,#4da6ff)', marginTop: 1, whiteSpace: 'nowrap' }}
            title="Média dos últimos 30 dias do billing — período selecionado tem menos de 30 dias">
            📅{' '}30d
          </div>
        )}
        {qLinha(totalQty, 'dias')}
      </>
    )
  }

  if (uom.includes('dbu')) {
    const custoUomRaw = Number(r.custo_uom_billing) || 0
    const custoUomBrl = isBRL ? custoUomRaw : custoUomRaw * convR
    return (
      <>
        <div style={{ ...mono, fontSize: 11, color: 'var(--blue,#4da6ff)', whiteSpace: 'nowrap' }} title={moedaTitle}>
          {custoUomBrl > 0 ? brl(custoUomBrl) : '—'}
        </div>
        <div style={{ fontSize: 9, color: 'var(--blue,#4da6ff)' }}>⚡{' '}/DBU cobrado</div>
        {qLinha(totalQty, 'DBUs', 'var(--blue,#4da6ff)')}
      </>
    )
  }

  const diasC = parseInt(String(r.dias_ativos ?? 1)) || 1
  const mesRaw = (Number(r.custo_mes_billing) || 0) || ((Number(r.total_billing) || 0) / diasC * 30)
  const mesBrl = isBRL ? mesRaw : mesRaw * convR
  const custoDia = mesBrl / 730
  const uomLabel = (r.unidade || '').replace(/^\d+\s+/, '').trim() || 'un.'
  const custoUomRaw = Number(r.custo_uom_billing) || 0
  const custoUomBrl = isBRL ? custoUomRaw : custoUomRaw * convR
  return (
    <>
      <div style={{ ...mono, fontSize: 11, color: 'var(--orange,#ff8c42)', whiteSpace: 'nowrap' }} title={moedaTitle}>{brl(custoDia)}</div>
      <div style={{ fontSize: 9, color: 'var(--orange,#ff8c42)' }} title="Cobrado por consumo (GB, Req…) — custo diário = custo mensal ÷ 30">/dia cobrado</div>
      {r.usa_30d && (
        <div style={{ fontSize: 9, color: 'var(--blue,#4da6ff)', marginTop: 1, whiteSpace: 'nowrap' }}
          title="Média dos últimos 30 dias do billing — período selecionado tem menos de 30 dias">
          📅{' '}30d
        </div>
      )}
      {custoUomBrl > 0 && (
        <div style={{ fontSize: 9, color: 'var(--orange,#ff8c42)', marginTop: 2, whiteSpace: 'nowrap', borderTop: '1px solid rgba(255,140,66,.15)', paddingTop: 2 }}
          title="Cost ÷ Qty: taxa real por unidade de medida — valor infalível para auditar a fatura">
          {brl(custoUomBrl)}{' / '}{uomLabel}
        </div>
      )}
      {qLinha(totalQty, uomLabel, 'var(--orange,#ff8c42)')}
    </>
  )
}
