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
const LS_HL = 'finops_horario_livre'

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

  // Horário Livre — mesmo padrão de persistência das Taxas acima (auto-carrega/
  // auto-salva, sem botão "★ Salvar como padrão" explícito do legado): antes
  // desta correção o Horário Livre resetava a cada abertura do overlay, mesmo
  // autenticado, porque só o valor default era usado como estado inicial.
  useEffect(() => {
    if (publicConfig) return
    try {
      const raw = localStorage.getItem(LS_HL)
      if (raw) setHorarioLivre((h) => ({ ...h, ...JSON.parse(raw) }))
    } catch { /* localStorage corrompido — mantém o default */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (publicConfig) return
    localStorage.setItem(LS_HL, JSON.stringify(horarioLivre))
  }, [publicConfig, horarioLivre])

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

  const managedRgMap = useMemo(() => {
    const m = new Map<string, ManagedInfo>()
    for (const rg of calc.rgOptions) {
      if (rg.managed_type) m.set(rg.resource_group_name.toUpperCase(), rg)
    }
    return m
  }, [calc.rgOptions])

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
                const managed = managedRgMap.get((r.resource_group_name || '').toUpperCase())
                return <EstimativaCard key={rid} r={r} horas={horas} calc={calcR} managed={managed} />
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

type RecursoBilling = import('../types/calculadora').RecursoBilling
type ManagedInfo = { managed_type: 'databricks' | 'aks' | null; managed_label: string | null } | undefined

function EstimativaCard({ r, horas, calc, managed }: { r: RecursoBilling; horas: number; calc: ReturnType<typeof calcEstimado>; managed: ManagedInfo }) {
  const col1 = col1Info(r, calc)
  const rg = r.resource_group_name || ''
  const ct = r.charge_type || ''
  const qty = Number(r.total_qty || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })
  const isHora = calc.tipo === 'hora' || calc.tipo === 'dia'
  const horasReais = Number(r.horas_reais || 0)
  // Uso parcial: recurso ficou ligado menos de 55% do mês (~400h de 720h)
  const usoParcial = isHora && horasReais > 0 && horasReais < 400
  const isDbu = !calc.dbValida && (r.unidade || '').toLowerCase().includes('dbu')
  const estimadoFinal = calc.estimado

  const rgStyle = managed?.managed_type === 'aks'
    ? { background: 'rgba(255,140,66,.12)', color: 'var(--orange,#ff8c42)' }
    : managed?.managed_type === 'databricks'
      ? { background: 'rgba(147,51,234,.12)', color: 'var(--accent)' }
      : { background: 'rgba(77,166,255,.08)', color: 'var(--blue,#4da6ff)' }
  const rgPrefix = managed?.managed_type === 'aks' ? '☸ ' : managed?.managed_type === 'databricks' ? '⚡ ' : ''
  const rgTitle = managed?.managed_type === 'aks' ? `RG gerenciado pelo AKS — cluster: ${managed.managed_label || ''}`
    : managed?.managed_type === 'databricks' ? `RG gerenciado pelo Databricks — workspace: ${managed.managed_label || ''}`
      : rg

  const estimadoBg = calc.tipo === 'mes' ? 'rgba(77,166,255,.10)'
    : (calc.usaPicoCluster || calc.usaPico) ? 'rgba(255,140,66,.08)'
      : calc.dbValida ? 'rgba(77,166,255,.10)' : 'var(--bg-card)'
  const estimadoBorder = calc.tipo === 'mes' ? '2px solid rgba(77,166,255,.40)'
    : (calc.usaPicoCluster || calc.usaPico) ? '2px solid rgba(255,140,66,.35)'
      : calc.dbValida ? '2px solid rgba(77,166,255,.40)' : '1px solid var(--accent-glow)'
  const estimadoColor = calc.tipo === 'mes' ? 'var(--blue,#4da6ff)'
    : (calc.usaPicoCluster || calc.usaPico) ? 'var(--orange,#ff8c42)'
      : calc.dbValida ? 'var(--blue,#4da6ff)' : 'var(--text-muted)'
  const estimadoLbl = (calc.tipo === 'mes' ? '🔒 Infra Fixa' : ((calc.usaPicoCluster || calc.usaPico) ? '⚠ ' : calc.dbValida ? '⚡ ' : '') + 'Estimado')
    + (calc.tipo === 'periodo' ? ' /mês*' : '')

  return (
    <div className="crcard-ov" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }} title={r.resource_id || r.nome_recurso}>
        {r.nome_recurso}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 8 }}>
        {r.produto || r.subcategoria || r.regiao || ''}
      </div>

      {/* Badges: categoria, charge_type, RG (gerenciado-aware), consumed_service, uso parcial, databricks/DBU */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
        {r.categoria && <span style={{ fontSize: 10, background: 'var(--accent-dim)', color: 'var(--text-dim)', borderRadius: 4, padding: '2px 7px' }}>{r.categoria}</span>}
        {ct && (
          <span style={{ fontSize: 10, borderRadius: 4, padding: '2px 7px', ...(ct === 'Usage' ? { background: 'rgba(147,51,234,.1)', color: 'var(--accent)' } : { background: 'rgba(77,166,255,.1)', color: 'var(--blue,#4da6ff)' }) }}>
            {ct}
          </span>
        )}
        {rg && <span style={{ fontSize: 10, borderRadius: 4, padding: '2px 7px', ...rgStyle }} title={rgTitle}>{rgPrefix}{rg}</span>}
        {r.consumed_service && <span style={{ fontSize: 10, background: 'var(--bg-card)', color: 'var(--text-dim)', borderRadius: 4, padding: '2px 7px', border: '1px solid var(--border)' }}>{r.consumed_service}</span>}
        {usoParcial && <span style={{ fontSize: 10, background: 'rgba(255,140,66,.15)', color: 'var(--orange,#ff8c42)', borderRadius: 4, padding: '2px 7px' }} title="Recurso ficou ligado menos de 55% do mês no período importado">⚠ Uso parcial</span>}
        {calc.dbValida && <span style={{ fontSize: 10, background: 'rgba(77,166,255,.12)', color: 'var(--blue,#4da6ff)', borderRadius: 4, padding: '2px 7px' }} title="Custo estimado pela taxa proporcional do workspace Databricks">⚡ Databricks</span>}
        {isDbu && <span style={{ fontSize: 10, background: 'rgba(77,166,255,.12)', color: 'var(--blue,#4da6ff)', borderRadius: 4, padding: '2px 7px' }} title={`Databricks DBU — cobrança de software (licenciamento de runtime). Taxa: ${brl(calc.custoUomBrl)}/DBU`}>⚡ DBU</span>}
      </div>

      {/* Metadados: UoM · Qtd · H.reais · Modelo */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10, fontSize: 10, color: 'var(--text-muted)' }}>
        {r.unidade && <span><span style={{ opacity: 0.6 }}>UoM</span> {r.unidade}</span>}
        {qty !== '0' && <span><span style={{ opacity: 0.6 }}>Qtd</span> {qty}</span>}
        {isHora && horasReais > 0 && (
          <span title="Horas reais consumidas no período (qty × fator UoM)">
            <span style={{ opacity: 0.6 }}>H.reais</span>{' '}
            <strong style={{ color: usoParcial ? 'var(--orange,#ff8c42)' : 'var(--text)' }}>{Math.round(horasReais).toLocaleString('pt-BR')}h</strong>
          </span>
        )}
        {r.pricing_model && <span><span style={{ opacity: 0.6 }}>Modelo</span> {r.pricing_model}</span>}
      </div>

      {/* Grid: Custo/h (ou pico/cluster/mês) · Horas · Cobrado · Estimado */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
        <div
          style={{ textAlign: 'center', borderRadius: 6, padding: '6px 4px', ...(calc.dbValida ? { background: 'rgba(77,166,255,.08)', border: '1px solid rgba(77,166,255,.30)' } : { background: 'var(--bg-card)', border: '1px solid transparent' }) }}
          title={col1.tooltip}
        >
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700, color: col1.color, marginBottom: 2 }}>{col1.label}</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 700, color: calc.dbValida ? 'var(--blue,#4da6ff)' : col1.valueColor }}>
            {col1.value}<span style={{ fontSize: 9, fontWeight: 400 }}>{col1.suffix}</span>
          </div>
          {calc.dbValida && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>billing:&nbsp;{brl(calc.chora)}/h</div>}
          {calc.custoUomBrl > 0 && (calc.tipo === 'periodo' || calc.tipo === 'mes') && (
            <div style={{ fontSize: 8, color: 'var(--orange,#ff8c42)', opacity: 0.85, marginTop: 3, fontFamily: "'IBM Plex Mono',monospace", whiteSpace: 'nowrap', borderTop: '1px solid rgba(255,140,66,.12)', paddingTop: 2 }} title="Cost ÷ Qty = taxa real por unidade de medida — auditoria FinOps">
              {brl(calc.custoUomBrl)}&nbsp;/&nbsp;{(r.unidade || '').replace(/^\d+\s+/, '').trim() || 'un.'}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', background: 'var(--bg-card)', borderRadius: 6, padding: '6px 4px' }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-muted)', marginBottom: 2 }}>{calc.tipo === 'mes' ? 'Modelo' : 'Horas'}</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>{calc.tipo === 'mes' ? 'Mensal' : horas + 'h'}</div>
        </div>

        <div style={{ textAlign: 'center', background: 'var(--bg-card)', borderRadius: 6, padding: '6px 4px' }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-muted)', marginBottom: 2 }}>Cobrado</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 11, fontWeight: 600, color: 'var(--text-dim)' }}>{calc.bill > 0 ? brl(calc.bill) : '—'}</div>
        </div>

        <div style={{ textAlign: 'center', borderRadius: 6, padding: '6px 4px', background: estimadoBg, border: estimadoBorder }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700, color: estimadoColor, marginBottom: 2 }}>{estimadoLbl}</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 12, fontWeight: 700, color: estimadoColor }}>
            {brl(estimadoFinal)}{calc.tipo === 'mes' && <span style={{ fontSize: 9, fontWeight: 400 }}>/mês</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

interface Col1Info { label: string; valueColor: string; color: string; value: string; suffix: string; tooltip: string }

// Porta fiel da cascata de prioridade col1Lbl/col1Val/col1Tip de _ovRenderRecursos
// (calculadora.js) — nunca reordenar: cada branch é mutuamente exclusivo e a
// ordem em si é parte da regra de negócio (reserva/mês sempre vencem pico, etc).
function col1Info(r: RecursoBilling, c: ReturnType<typeof calcEstimado>): Col1Info {
  const orange = 'var(--orange,#ff8c42)'
  const blue = 'var(--blue,#4da6ff)'
  const muted = 'var(--text-muted)'
  if (c.tipo === 'reserva') return { label: 'Amort./h 🔒', color: blue, valueColor: blue, value: brl(c.chora), suffix: '/h', tooltip: '' }
  if (c.tipo === 'mes') return { label: '🔒 Fixo/mês', color: blue, valueColor: blue, value: brl(c.mesBrl), suffix: '/mês', tooltip: 'Custo mensal fixo baseado no billing histórico' }
  if (c.usaPico && (c.tipo === 'hora' || c.tipo === 'dia')) {
    const picoData = r.pico_data ? new Date(r.pico_data).toLocaleDateString('pt-BR') : '—'
    const picoDia = (r.pico_custo_dia || 0) * c.convR
    const picoH = r.pico_horas_dia || 0
    const label = c.dbValida ? '⚠ Pico Cluster/h' : '⚠ Pico/h'
    const tooltip = `Pico: ${picoData} — custo do dia: ${brl(picoDia)}` + (picoH > 0 ? ` em ${picoH.toFixed(1)}h ligado` : '') + ` → ${brl(c.picoBrl)}/h`
    return { label, color: orange, valueColor: orange, value: brl(c.picoBrl), suffix: '/h', tooltip }
  }
  if (c.usaPico && c.tipo === 'periodo') {
    const picoData = r.pico_data ? new Date(r.pico_data).toLocaleDateString('pt-BR') : '—'
    const picoDia = (r.pico_custo_dia || 0) * c.convR
    const tooltip = `Pico: ${picoData} — custo do dia: ${brl(picoDia)} × 30 dias = ${brl(c.picoBrl * 720)}/mês`
    return { label: '⚠ Pico/mês*', color: orange, valueColor: orange, value: brl(c.picoBrl * 720), suffix: '/mês', tooltip }
  }
  if (c.usaPicoCluster) {
    const pcData = r.pico_cluster_data ? new Date(r.pico_cluster_data).toLocaleDateString('pt-BR') : '—'
    const pcCusto = (r.pico_cluster_custo_rg || 0) * c.convR
    const pcHoras = r.pico_cluster_horas_dia || 0
    const tooltip = `Pico cluster: ${pcData} — custo total RG: ${brl(pcCusto)}` + (pcHoras > 0 ? ` em ${pcHoras.toFixed(1)}h (driver)` : '') + ` → ${brl(c.picoClusterBrl)}/h`
    return { label: '⚠ Pico Cluster/h', color: orange, valueColor: orange, value: brl(c.picoClusterBrl), suffix: '/h', tooltip }
  }
  if (c.dbValida) {
    const tooltip = `Custo proporcional: billing R$ ${c.bill.toFixed(2)} ÷ ${c.dbInfo!.hDriver}h (uptime cluster) = R$ ${c.taxaEf.toFixed(4)}/h | workspace: R$ ${c.dbInfo!.taxa.toFixed(4)}/h (${c.dbInfo!.recursos} VMs)`
    return { label: '⚡ Cluster/h', color: blue, valueColor: blue, value: brl(c.taxaEf), suffix: '/h', tooltip }
  }
  if (c.tipo === 'periodo' && (r.unidade || '').toLowerCase().includes('dbu')) {
    return { label: '⚡ DBU/mês*', color: blue, valueColor: blue, value: brl(c.mesBrl), suffix: '/mês', tooltip: `Custo mensal proporcional dos DBUs Databricks (software licensing). Taxa unitária: ${brl(c.custoUomBrl)}/DBU` }
  }
  if (c.tipo === 'periodo') return { label: 'Custo/mês*', color: muted, valueColor: 'var(--orange,#ff8c42)', value: brl(c.mesBrl), suffix: '/mês', tooltip: 'Estimativa proporcional ao billing histórico (Cost ÷ Qty)' }
  if (c.tipo === 'dia') return { label: 'Custo/h·dia', color: muted, valueColor: 'var(--accent)', value: brl(c.chora), suffix: '/h', tooltip: '' }
  if (r.usa_amortizado && c.tipo === 'hora' && c.chora > 0) return { label: '⚡ Amort./h', color: blue, valueColor: blue, value: brl(c.chora), suffix: '/h', tooltip: 'Custo amortizado: VM coberta por Reserva ou Savings Plan — effective_price × qty ÷ horas = taxa proporcional real' }
  return { label: 'Custo/h', color: muted, valueColor: 'var(--accent)', value: brl(c.chora), suffix: '/h', tooltip: '' }
}
