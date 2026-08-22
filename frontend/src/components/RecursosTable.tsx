import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import CustoHoraCell from './CustoHoraCell'
import { recursoKey } from '../hooks/useCalculadora'
import type { DbTaxaInfo, RecursoBilling } from '../types/calculadora'

function brl(v: number): string {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Grid (não <table>) — cada linha virtualizada é um <div role="row"> próprio
// (fora da árvore de um único <table>), então alinhamento de coluna só é
// garantido usando o MESMO grid-template-columns no cabeçalho e em toda
// linha, em vez de depender do auto-layout de <table>.
const COLS = '32px 2.2fr 1.3fr 1fr 0.9fr 0.9fr 1fr 1.3fr 1.2fr'

interface Grupo {
  baseId: string
  filhas: RecursoBilling[]
}

interface RecursosTableProps {
  grupos: Grupo[]
  selecionados: Record<string, number>
  expandedGroups: Set<string>
  dbTaxaMap: Map<string, DbTaxaInfo>
  taxaBrl: number
  onToggleGrupo: (baseId: string) => void
  onCheck: (rid: string, checked: boolean) => void
  onCheckGrupo: (baseId: string, checked: boolean) => void
}

// Porta de _renderRecursos/_htmlFilhaRow (calculadora.js) — em vez do truque
// de RAF-chunking (anti-padrão em React, já que escreve DOM direto por fora
// da vdom), usa virtualização real (@tanstack/react-virtual) pra não montar
// milhares de linhas de uma vez — a busca não pagina no backend e ambientes
// com centenas/milhares de recursos são o caso esperado, não a exceção.
export default function RecursosTable({
  grupos, selecionados, expandedGroups, dbTaxaMap, taxaBrl,
  onToggleGrupo, onCheck, onCheckGrupo,
}: RecursosTableProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: grupos.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => {
      const g = grupos[i]
      const exp = g.filhas.length > 1 && expandedGroups.has(g.baseId)
      return g.filhas.length > 1 ? 40 + (exp ? g.filhas.length * 56 : 0) : 56
    },
    overscan: 8,
  })

  if (!grupos.length) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 12 }}>
        Nenhum recurso encontrado para os filtros selecionados.
      </div>
    )
  }

  return (
    <div ref={parentRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
      <div style={{ minWidth: 900 }}>
        <div role="row" style={{
          display: 'grid', gridTemplateColumns: COLS, position: 'sticky', top: 0, zIndex: 2,
          background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
        }}>
          <div />
          <div className="cth">Recurso / Produto</div>
          <div className="cth">Resource Group</div>
          <div className="cth">Meter Category</div>
          <div className="cth" title="Pricing Model no tooltip da célula">Charge Type</div>
          <div className="cth">Unit of Measure</div>
          <div className="cth" style={{ textAlign: 'right' }}>Consumed Quantity</div>
          <div className="cth" style={{ textAlign: 'right' }}
            title={'Hora → taxa real (effective_price)\nReserva → amortizado pelo term\nPeríodo → custo mensal estimado'}>
            Custo/h · /mês
          </div>
          <div className="cth" style={{ textAlign: 'right' }}>Total Cobrado (BRL)</div>
        </div>

        <div style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const g = grupos[vi.index]
            const temMultiplos = g.filhas.length > 1
            const isBRL = (g.filhas[0]?.moeda || 'BRL') === 'BRL'
            const exp = temMultiplos && expandedGroups.has(g.baseId)
            const nome = g.filhas[0].nome_recurso || g.baseId.split('/').filter(Boolean).pop() || g.baseId.slice(0, 60)
            const rg = g.filhas[0].resource_group_name || '—'
            const totalGrupo = g.filhas.reduce((s, r) => s + (isBRL ? (Number(r.total_billing) || 0) : (Number(r.total_billing) || 0) * taxaBrl), 0)
            const algumSel = g.filhas.some((r) => !!selecionados[recursoKey(r)])
            const todosSel = g.filhas.every((r) => !!selecionados[recursoKey(r)])

            return (
              <div
                key={g.baseId}
                ref={virtualizer.measureElement}
                data-index={vi.index}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
              >
                {temMultiplos ? (
                  <div role="row" style={{ display: 'grid', gridTemplateColumns: COLS, background: 'var(--bg-hover)', cursor: 'pointer' }} onClick={() => onToggleGrupo(g.baseId)}>
                    <div style={{ textAlign: 'center', padding: '8px 4px' }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox" checked={todosSel}
                        ref={(el) => { if (el) el.indeterminate = algumSel && !todosSel }}
                        onChange={(e) => onCheckGrupo(g.baseId, e.target.checked)}
                      />
                    </div>
                    <div style={{ gridColumn: 'span 6', padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'inline-block', transform: `rotate(${exp ? 90 : 0}deg)`, transition: 'transform .15s' }}>▶</span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }} title={g.baseId}>{nome}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{rg} &nbsp;·&nbsp; <span style={{ color: 'var(--accent)' }}>{g.filhas.length} meters</span></div>
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', padding: '8px 14px' }}>
                      <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 600, color: 'var(--accent)', whiteSpace: 'nowrap' }}>{brl(totalGrupo)}</div>
                    </div>
                  </div>
                ) : (
                  <FilhaRow r={g.filhas[0]} temMultiplos={false} rg={rg} nome={nome} isBRL={isBRL} taxaBrl={taxaBrl}
                    selected={!!selecionados[recursoKey(g.filhas[0])]} dbInfo={dbTaxaMap.get((g.filhas[0].resource_group_name || '').toLowerCase()) || null}
                    onCheck={onCheck} />
                )}
                {temMultiplos && exp && g.filhas.map((r) => (
                  <FilhaRow key={recursoKey(r)} r={r} temMultiplos rg={rg} nome={nome} isBRL={isBRL} taxaBrl={taxaBrl}
                    selected={!!selecionados[recursoKey(r)]} dbInfo={dbTaxaMap.get((r.resource_group_name || '').toLowerCase()) || null}
                    onCheck={onCheck} />
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function FilhaRow({ r, temMultiplos, rg, nome, isBRL, taxaBrl, selected, dbInfo, onCheck }: {
  r: RecursoBilling; temMultiplos: boolean; rg: string; nome: string; isBRL: boolean
  taxaBrl: number; selected: boolean; dbInfo: DbTaxaInfo | null; onCheck: (rid: string, checked: boolean) => void
}) {
  const rid = recursoKey(r)
  const totBrl = isBRL ? (Number(r.total_billing) || 0) : (Number(r.total_billing) || 0) * taxaBrl
  const isMkt = (r.publisher_type || '').toLowerCase() === 'marketplace'
  const ctColor = r.charge_type === 'Usage' ? { background: 'rgba(147,51,234,.1)', color: 'var(--accent)' } : { background: 'rgba(77,166,255,.1)', color: 'var(--blue,#4da6ff)' }
  return (
    <div role="row" style={{ display: 'grid', gridTemplateColumns: COLS, background: selected ? 'rgba(147,51,234,.04)' : undefined, borderLeft: isMkt ? '2px solid rgba(255,140,66,.4)' : undefined }}>
      <div style={{ textAlign: 'center', padding: '8px 4px' }}>
        <input type="checkbox" checked={selected} onChange={(e) => onCheck(rid, e.target.checked)} />
      </div>
      <div style={{ overflow: 'hidden', padding: '8px 10px', paddingLeft: temMultiplos ? 28 : 10 }}>
        <div style={{ fontSize: temMultiplos ? 11 : 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: temMultiplos ? 'var(--text-dim)' : 'var(--text)' }}
          title={`${r.resource_id || ''}${r.consumed_service ? ' · ' + r.consumed_service : ''}${r.pricing_model ? ' · ' + r.pricing_model : ''}`}>
          {temMultiplos ? (r.meter_categories || r.categoria || nome) : nome}
          {isMkt && <span style={{ display: 'inline-block', marginLeft: 5, padding: '1px 5px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: 'rgba(255,140,66,.18)', color: '#ff8c42', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>MKT</span>}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.publisher_name && isMkt ? r.publisher_name : (r.consumed_service || r.produto || r.subcategoria || '')}
        </div>
      </div>
      <div style={{ overflow: 'hidden', padding: '8px 10px' }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{temMultiplos ? '' : rg}</div>
      </div>
      <div style={{ padding: '8px 10px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
        <span className="cbadge">{r.categoria || '—'}</span>
      </div>
      <div style={{ padding: '8px 10px', whiteSpace: 'nowrap', overflow: 'hidden' }} title={r.pricing_model || ''}>
        <span style={{ padding: '2px 7px', borderRadius: 8, fontSize: 10, fontWeight: 600, ...ctColor }}>{r.charge_type || '—'}</span>
      </div>
      <div style={{ padding: '8px 10px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{r.unidade || '—'}</div>
      </div>
      <div style={{ textAlign: 'right', padding: '8px 10px' }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
          {(Number(r.total_qty) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
        </div>
      </div>
      <div style={{ textAlign: 'right', padding: '8px 10px' }}>
        <CustoHoraCell r={r} isBRL={isBRL} taxaBrl={taxaBrl} dbInfo={dbInfo} />
      </div>
      <div style={{ textAlign: 'right', padding: '8px 14px' }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 600, color: 'var(--accent)', whiteSpace: 'nowrap' }}>{brl(totBrl)}</div>
      </div>
    </div>
  )
}
