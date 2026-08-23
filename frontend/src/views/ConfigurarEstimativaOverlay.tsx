import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { buildEstimativa } from '../lib/buildEstimativa'
import { calcEstimado } from '../lib/calcEstimado'
import { calcHorasPeriodo, defaultHorarioLivre } from '../lib/periodo'
import { recursoKey, type UseCalculadoraReturn } from '../hooks/useCalculadora'
import type { EstimativaCalculada, HorarioLivre, Periodo } from '../types/calculadora'

function brl(v: number): string {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const TAXA_IMP_DEF = 18.65
const TAXA_COND_DEF = 13.00
const TAXA_GORD_DEF = 0
const LS_IMP = 'finops_taxa_imposto'
const LS_COND = 'finops_taxa_cond'
const LS_GORD = 'finops_taxa_gordura'

const DIAS_SEMANA = [
  { v: 1, label: 'Seg' }, { v: 2, label: 'Ter' }, { v: 3, label: 'Qua' }, { v: 4, label: 'Qui' },
  { v: 5, label: 'Sex' }, { v: 6, label: 'Sáb' }, { v: 0, label: 'Dom' },
]

const LOTE = 100

// Portal Público Fase B — porta de _aplicarRestricoesPortal()/_carregarTaxas()
// (calculadora.js): admin pode travar imposto/condomínio/horário livre com
// valores fixos (campo não-null na config), ou deixar o público editar
// livremente (campo null/undefined). Gordura sempre oculta no portal —
// nunca fez parte do fluxo público, só do autenticado.
export interface PublicTaxConfig {
  imposto: number | null
  cond: number | null
  horarioLivre: HorarioLivre | null
}

interface Props {
  calc: UseCalculadoraReturn
  taxaBrl: number
  onClose: () => void
  onVisualizarEstimativa: (estimativa: EstimativaCalculada, periodos: Periodo[]) => void
  publicConfig?: PublicTaxConfig
}

export default function ConfigurarEstimativaOverlay({ calc, taxaBrl, onClose, onVisualizarEstimativa, publicConfig }: Props) {
  const [modo, setModo] = useState<'horas' | 'periodo'>('horas')
  const [periodos, setPeriodos] = useState<Periodo[]>([])
  const [iniData, setIniData] = useState('')
  const [iniHora, setIniHora] = useState('00:00')
  const [fimData, setFimData] = useState('')
  const [fimHora, setFimHora] = useState('00:00')
  const [horarioLivre, setHorarioLivre] = useState<HorarioLivre>(() => publicConfig?.horarioLivre || defaultHorarioLivre())
  const [pctImposto, setPctImposto] = useState(() => publicConfig ? (publicConfig.imposto ?? TAXA_IMP_DEF) : TAXA_IMP_DEF)
  const [pctCond, setPctCond] = useState(() => publicConfig ? (publicConfig.cond ?? TAXA_COND_DEF) : TAXA_COND_DEF)
  const [pctGordura, setPctGordura] = useState(TAXA_GORD_DEF)
  const [visiveis, setVisiveis] = useState(LOTE)

  const impostoTravado = !!publicConfig && publicConfig.imposto != null
  const condTravado = !!publicConfig && publicConfig.cond != null
  const horarioLivreTravado = !!publicConfig?.horarioLivre

  // Portal público não persiste taxas em localStorage (sessão anônima, sem
  // sentido "lembrar" entre visitantes diferentes de um terminal compartilhado)
  // — só o fluxo autenticado usa esse comportamento.
  useEffect(() => {
    if (publicConfig) return
    const si = localStorage.getItem(LS_IMP)
    const sc = localStorage.getItem(LS_COND)
    const sg = localStorage.getItem(LS_GORD)
    setPctImposto(si !== null ? parseFloat(si) : TAXA_IMP_DEF)
    setPctCond(sc !== null ? parseFloat(sc) : TAXA_COND_DEF)
    setPctGordura(sg !== null ? parseFloat(sg) : TAXA_GORD_DEF)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (publicConfig) return
    localStorage.setItem(LS_IMP, String(pctImposto))
    localStorage.setItem(LS_COND, String(pctCond))
    localStorage.setItem(LS_GORD, String(pctGordura))
  }, [publicConfig, pctImposto, pctCond, pctGordura])

  const vIni = iniData ? `${iniData}T${iniHora}` : ''
  const vFim = fimData ? `${fimData}T${fimHora}` : ''
  const previa = useMemo(() => calcHorasPeriodo(vIni, vFim, horarioLivre), [vIni, vFim, horarioLivre])

  function incluirPeriodo() {
    if (!previa.valido) return
    setPeriodos((prev) => [...prev, { inicio: vIni, fim: vFim, horas: previa.horasCobradas, horasTotal: previa.horas, horasLivres: previa.horasLivres }])
    setIniData(''); setFimData('')
  }

  function removerPeriodo(i: number) {
    setPeriodos((prev) => prev.filter((_, idx) => idx !== i))
  }

  const totalPeriodos = periodos.reduce((s, p) => s + p.horas, 0)

  function aplicarTotalPeriodos() {
    if (!periodos.length) return
    const next: Record<string, number> = {}
    for (const r of calc.recursos) next[recursoKey(r)] = totalPeriodos
    calc.setSelecionados(next)
    calc.setChGlobal(totalPeriodos)
    calc.setHorasAplicadas(true)
  }

  // ── Estimativa (Subtotal/Total) — fonte única: buildEstimativa/calcEstimado ──
  const estimativa = useMemo(
    () => buildEstimativa(calc.recursos, calc.selecionados, calc.dbTaxaMap, { pctImposto, pctCond, pctGordura }, taxaBrl, calc.chGlobal),
    [calc.recursos, calc.selecionados, calc.dbTaxaMap, pctImposto, pctCond, pctGordura, taxaBrl, calc.chGlobal],
  )

  const selKeys = useMemo(() => Object.keys(calc.selecionados), [calc.selecionados])
  const rMap = useMemo(() => new Map(calc.recursos.map((r) => [recursoKey(r), r])), [calc.recursos])
  const ordenados = useMemo(
    () => [...selKeys].sort((a, b) => {
      const rgA = rMap.get(a)?.resource_group_name || ''
      const rgB = rMap.get(b)?.resource_group_name || ''
      return rgA.localeCompare(rgB)
    }),
    [selKeys, rMap],
  )
  const visiveisKeys = ordenados.slice(0, visiveis)

  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setVisiveis((v) => Math.min(v + LOTE, ordenados.length))
    }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [ordenados.length])

  // Guard-rail — CLAUDE.md/legado: seleção grande demais provavelmente reflete
  // o custo de manter o ambiente inteiro rodando, não um recorte de projeto.
  const guardrail = useMemo(() => {
    const rgsSel = new Set(selKeys.map((k) => (rMap.get(k)?.resource_group_name || '').toUpperCase()).filter(Boolean))
    const rgsTot = new Set(calc.recursos.map((r) => (r.resource_group_name || '').toUpperCase()).filter(Boolean))
    const pct = rgsTot.size > 0 ? rgsSel.size / rgsTot.size : 0
    const ativo = selKeys.length > 500 && rgsTot.size >= 5 && pct >= 0.7
    return { ativo, rgsSelSize: rgsSel.size, rgsTotSize: rgsTot.size }
  }, [selKeys, rMap, calc.recursos])

  function visualizarEstimativa() {
    if (!estimativa.resultados.length) return
    onVisualizarEstimativa(estimativa, periodos)
  }

  // Portal pro <body> — CalculadoraView.tsx (único chamador com esse
  // problema hoje) tem `overflow:hidden` no container raiz, e um
  // .modal-overlay (position:fixed) continua sendo recortado por QUALQUER
  // ancestral com overflow != visible, mesmo sendo fixed. Sem o portal, o
  // overlay ficava visível só dentro da área de conteúdo (não cobria
  // sidebar/topbar) — visualmente quebrado.
  return createPortal(
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" style={{ maxWidth: 1200 }}>
        <div className="modal-header">
          <span>Configurar Estimativa — {selKeys.length} recurso{selKeys.length !== 1 ? 's' : ''} selecionado{selKeys.length !== 1 ? 's' : ''}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
          {/* ── Coluna esquerda: recursos ── */}
          <div>
            {guardrail.ativo && (
              <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: 'rgba(255,140,66,.1)', border: '1px solid rgba(255,140,66,.3)', fontSize: 12, color: 'var(--orange,#ff8c42)' }}>
                ⚠️ Você selecionou <strong>{selKeys.length.toLocaleString('pt-BR')} recursos</strong> em <strong>{guardrail.rgsSelSize} de {guardrail.rgsTotSize} Resource Groups</strong> carregados
                nesta busca — isso reflete o custo de manter praticamente todo o ambiente rodando em paralelo, não o de um recorte específico de projeto. Confira a seleção antes de usar este valor.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {visiveisKeys.map((rid) => {
                const r = rMap.get(rid)
                if (!r) return null
                const horas = calc.selecionados[rid] || 720
                const calcR = calcEstimado(r, horas, calc.dbTaxaMap, taxaBrl)
                return <EstimativaCard key={rid} r={r} horas={horas} calc={calcR} />
              })}
              {visiveis < ordenados.length && <div ref={sentinelRef} style={{ height: 1 }} />}
            </div>
          </div>

          {/* ── Coluna direita: período/horário livre/taxas/totais ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="crcard-ov" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Período de Estimativa</div>
              <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,.06)', borderRadius: 7, padding: 2, marginBottom: 10 }}>
                <button onClick={() => setModo('horas')} style={{ flex: 1, padding: '4px 0', fontSize: 11, fontWeight: 600, borderRadius: 5, border: 'none', cursor: 'pointer', background: modo === 'horas' ? 'var(--accent)' : 'transparent', color: modo === 'horas' ? '#fff' : 'var(--text-muted)' }}>Horas</button>
                <button onClick={() => setModo('periodo')} style={{ flex: 1, padding: '4px 0', fontSize: 11, fontWeight: 600, borderRadius: 5, border: 'none', cursor: 'pointer', background: modo === 'periodo' ? 'var(--accent)' : 'transparent', color: modo === 'periodo' ? '#fff' : 'var(--text-muted)' }}>Período</button>
              </div>

              {modo === 'horas' ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input type="number" min={1} className="ci" value={calc.chGlobal} onChange={(e) => calc.setChGlobal(parseInt(e.target.value, 10) || 1)} style={{ flex: 1 }} />
                  <button className="btn-primary" onClick={calc.aplicarHorasGlobal}>Aplicar</button>
                </div>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '38px 1fr 90px', gap: 3, alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Início</span>
                    <input type="date" className="ci" value={iniData} onChange={(e) => setIniData(e.target.value)} style={{ height: 30, fontSize: 12 }} />
                    <input type="time" step={3600} className="ci" value={iniHora} onChange={(e) => setIniHora(e.target.value)} style={{ height: 30, fontSize: 12 }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '38px 1fr 90px', gap: 3, alignItems: 'center' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Fim</span>
                    <input type="date" className="ci" value={fimData} onChange={(e) => setFimData(e.target.value)} style={{ height: 30, fontSize: 12 }} />
                    <input type="time" step={3600} className="ci" value={fimHora} onChange={(e) => setFimHora(e.target.value)} style={{ height: 30, fontSize: 12 }} />
                  </div>
                  <div style={{ fontSize: 11, color: previa.erro ? 'var(--danger)' : 'var(--accent)', textAlign: 'right', minHeight: 14, fontFamily: "'IBM Plex Mono',monospace", margin: '6px 0' }}>
                    {previa.erro || (previa.valido ? `${previa.horas}h · ${horarioLivre.ativo && previa.horasLivres > 0 ? `−${previa.horasLivres}h livres → ${previa.horasCobradas}h cobradas` : ''}` : '')}
                  </div>
                  <button onClick={incluirPeriodo} disabled={!previa.valido}
                    style={{ width: '100%', height: 30, borderRadius: 6, border: '1px solid var(--border)', background: previa.valido ? 'var(--accent)' : 'rgba(100,100,100,.08)', color: previa.valido ? '#fff' : 'var(--text-muted)', fontSize: 11, fontWeight: 700, cursor: previa.valido ? 'pointer' : 'not-allowed' }}>
                    + Incluir na Estimativa
                  </button>
                  {periodos.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {periodos.map((p, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)' }}>
                          <span>{p.inicio.slice(0, 16).replace('T', ' ')} → {p.fim.slice(0, 16).replace('T', ' ')} ({p.horas}h)</span>
                          <button onClick={() => removerPeriodo(i)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>✕</button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, marginTop: 4 }}>
                        <span>Total: {totalPeriodos}h</span>
                        <button className="btn-primary" style={{ fontSize: 11, padding: '2px 10px' }} onClick={aplicarTotalPeriodos}>Aplicar Total</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="crcard-ov" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <input type="checkbox" checked={horarioLivre.ativo} disabled={horarioLivreTravado}
                  onChange={(e) => setHorarioLivre((h) => ({ ...h, ativo: e.target.checked }))} style={{ width: 'auto', flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 700 }}>Horário Livre (desconta horas fora do expediente)</span>
              </div>
              {horarioLivreTravado && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8 }}>⚙ Configurado pelo administrador</div>
              )}
              {horarioLivre.ativo && (
                <>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                    {DIAS_SEMANA.map((d) => (
                      <label key={d.v} style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 3, cursor: horarioLivreTravado ? 'default' : 'pointer', opacity: horarioLivreTravado && !horarioLivre.dias.includes(d.v) ? 0.4 : 1 }}>
                        <input type="checkbox" checked={horarioLivre.dias.includes(d.v)} disabled={horarioLivreTravado}
                          onChange={(e) => setHorarioLivre((h) => ({ ...h, dias: e.target.checked ? [...h.dias, d.v] : h.dias.filter((x) => x !== d.v) }))} style={{ width: 'auto', flexShrink: 0 }} />
                        {d.label}
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Dias úteis:</span>
                    <input type="time" className="ci" value={horarioLivre.inicio} disabled={horarioLivreTravado} onChange={(e) => setHorarioLivre((h) => ({ ...h, inicio: e.target.value }))} style={{ height: 26, fontSize: 11 }} />
                    <span>→</span>
                    <input type="time" className="ci" value={horarioLivre.fim} disabled={horarioLivreTravado} onChange={(e) => setHorarioLivre((h) => ({ ...h, fim: e.target.value }))} style={{ height: 26, fontSize: 11 }} />
                  </div>
                </>
              )}
            </div>

            <div className="crcard-ov" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Taxas Adicionais</div>
              <div style={{ display: 'grid', gridTemplateColumns: publicConfig ? '1fr 1fr' : '1fr 1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Imposto %{impostoTravado && ' 🔒'}</label>
                  <input type="number" step={0.01} className="ci" value={pctImposto} disabled={impostoTravado}
                    title={impostoTravado ? 'Configurado pelo administrador' : ''}
                    onChange={(e) => setPctImposto(parseFloat(e.target.value) || 0)} />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Condomínio %{condTravado && ' 🔒'}</label>
                  <input type="number" step={0.01} className="ci" value={pctCond} disabled={condTravado}
                    title={condTravado ? 'Configurado pelo administrador' : ''}
                    onChange={(e) => setPctCond(parseFloat(e.target.value) || 0)} />
                </div>
                {!publicConfig && (
                  <div>
                    <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Gordura %</label>
                    <input type="number" step={0.01} className="ci" value={pctGordura} onChange={(e) => setPctGordura(parseFloat(e.target.value) || 0)} />
                  </div>
                )}
              </div>
            </div>

            <div className="crcard-ov" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                <span>Cobrado no período</span><span>{brl(estimativa.total_cobrado)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span>Subtotal</span><span>{brl(estimativa.total_brl)}</span>
              </div>
              {estimativa.total_fixo_mes > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--blue,#4da6ff)', marginBottom: 4 }}>
                  <span>🔒 Infra Fixa/mês (fora do total)</span><span>{brl(estimativa.total_fixo_mes)}</span>
                </div>
              )}
              {pctImposto > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  <span>+ Imposto ({pctImposto}%)</span><span>{brl(estimativa.vl_imposto)}</span>
                </div>
              )}
              {pctCond > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  <span>+ Condomínio ({pctCond}%)</span><span>{brl(estimativa.vl_cond)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700, color: 'var(--accent)', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                <span>Total Final</span><span>{brl(estimativa.total_final)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Fechar</button>
          <button className="btn-primary" disabled={!estimativa.resultados.length} onClick={visualizarEstimativa}>Visualizar Estimativa</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function EstimativaCard({ r, horas, calc }: { r: import('../types/calculadora').RecursoBilling; horas: number; calc: ReturnType<typeof calcEstimado> }) {
  const { label, color } = col1Label(r, calc)
  return (
    <div className="crcard-ov" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 10, alignItems: 'center' }}>
      <div style={{ overflow: 'hidden' }}>
        <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.nome_recurso}</div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.resource_group_name}</div>
        <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
          {calc.dbValida && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: 'rgba(77,166,255,.12)', color: 'var(--blue,#4da6ff)' }}>⚡ Databricks</span>}
        </div>
      </div>
      <div style={{ textAlign: 'right', fontSize: 10, color }}>{label}</div>
      <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>{horas}h</div>
      <div style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", fontSize: 13, fontWeight: 700, color: calc.usaPico || calc.usaPicoCluster ? 'var(--orange,#ff8c42)' : calc.dbValida ? 'var(--blue,#4da6ff)' : 'var(--text)' }}>
        {brl(calc.estimado)}
      </div>
    </div>
  )
}

function col1Label(r: import('../types/calculadora').RecursoBilling, c: ReturnType<typeof calcEstimado>): { label: string; color: string } {
  if (c.tipo === 'reserva') return { label: 'Amort./h 🔒', color: 'var(--blue,#4da6ff)' }
  if (c.tipo === 'mes') return { label: '🔒 Fixo/mês', color: 'var(--blue,#4da6ff)' }
  if (c.usaPico && (c.tipo === 'hora' || c.tipo === 'dia')) return { label: c.dbValida ? '⚠ Pico Cluster/h' : '⚠ Pico/h', color: 'var(--orange,#ff8c42)' }
  if (c.usaPico && c.tipo === 'periodo') return { label: '⚠ Pico/mês*', color: 'var(--orange,#ff8c42)' }
  if (c.usaPicoCluster) return { label: '⚠ Pico Cluster/h', color: 'var(--orange,#ff8c42)' }
  if (c.dbValida) return { label: '⚡ Cluster/h', color: 'var(--blue,#4da6ff)' }
  if (c.tipo === 'periodo' && (r.unidade || '').toLowerCase().includes('dbu')) return { label: '⚡ DBU/mês*', color: 'var(--blue,#4da6ff)' }
  if (c.tipo === 'periodo') return { label: 'Custo/mês*', color: 'var(--text-muted)' }
  if (c.tipo === 'dia') return { label: 'Custo/h·dia', color: 'var(--text-muted)' }
  if (r.usa_amortizado && c.tipo === 'hora' && c.chora > 0) return { label: '⚡ Amort./h', color: 'var(--blue,#4da6ff)' }
  return { label: 'Custo/h', color: 'var(--text-muted)' }
}
