import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRecursos, listResourceGroups, listSubscriptions, sortRgsComFilhos } from '../api/calculadora'
import { computeDbTaxas } from '../lib/calcEstimado'
import { tipoRecurso } from '../lib/tipoRecurso'
import type { RecursoBilling, RecursosQuery, ResourceGroupOption, SubscriptionOption } from '../types/calculadora'

export function recursoKey(r: RecursoBilling): string {
  return (r.resource_id || '') + '||' + (r.categoria || '') + '||' + (r.meter_categories || '') + '||' + (r.unidade || '')
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Injetável — Portal Público Fase B reusa o mesmo hook com as funções de
// api/calculadoraPublica.ts (endpoints /api/public/calculadora/*, filtrados
// no servidor por portalCfg) em vez das privadas. Mesmo shape de retorno nos
// dois casos, então nenhuma lógica abaixo precisa saber qual API está ativa.
export interface CalculadoraApi {
  listSubscriptions: () => Promise<SubscriptionOption[]>
  listResourceGroups: (subscriptionIds: string[]) => Promise<ResourceGroupOption[]>
  getRecursos: (q: RecursosQuery) => Promise<RecursoBilling[]>
}

const defaultApi: CalculadoraApi = { listSubscriptions, listResourceGroups, getRecursos }

// `apiKey` distingue o cache do React Query entre a instância privada e a
// pública do hook (ambas usam as mesmas chaves 'calc-subs'/'calc-rgs' — sem
// isso, funções não são serializáveis numa queryKey e não dá pra usar `api`
// diretamente na chave). Na prática nunca coexistem no mesmo QueryClient
// (bundles/páginas separados), mas o parâmetro deixa isso explícito.
export function useCalculadora(api: CalculadoraApi = defaultApi, apiKey = 'privada') {
  // ── Subscription / RG selection ──
  const subsQuery = useQuery({ queryKey: ['calc-subs', apiKey], queryFn: api.listSubscriptions })
  const [subsSel, setSubsSel] = useState<string[]>([])
  const [rgsSel, setRgsSel] = useState<string[]>([])
  const [dataInicio, setDataInicio] = useState('')
  const [dataFim, setDataFim] = useState('')

  const rgQuery = useQuery({
    queryKey: ['calc-rgs', apiKey, subsSel],
    queryFn: () => api.listResourceGroups(subsSel),
    enabled: subsSel.length > 0,
  })
  const rgOptions = useMemo(() => sortRgsComFilhos(rgQuery.data || []), [rgQuery.data])

  // ── Busca de recursos (manual, botão Buscar) ──
  const [recursos, setRecursos] = useState<RecursoBilling[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [picoCarregado, setPicoCarregado] = useState(false)
  const [picoLoading, setPicoLoading] = useState(false)
  const [ultimaQuery, setUltimaQuery] = useState<RecursosQuery | null>(null)
  const [selecionados, setSelecionados] = useState<Record<string, number>>({})

  // Confirmar Assinatura (OK ✓ do dropdown) — reseta RGs/recursos e
  // pré-preenche o período com os últimos 30 dias disponíveis (fim mais
  // recente entre as subs selecionadas), igual a _confirmarSub().
  const commitSubs = useCallback((values: string[]) => {
    setSubsSel(values)
    setRgsSel([])
    setRecursos([])
    setSelecionados({})
    const fimDB = (subsQuery.data || [])
      .filter((s) => values.includes(s.subscription_id))
      .map((s) => (s.periodo_fim || '').slice(0, 10))
      .filter(Boolean)
      .sort()
      .pop()
    if (fimDB) {
      const fim30 = new Date(fimDB + 'T12:00:00')
      const ini30 = new Date(fim30)
      ini30.setDate(ini30.getDate() - 30)
      setDataFim(ymd(fim30))
      setDataInicio(ymd(ini30))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subsQuery.data])

  const buscarRecursos = useCallback(async () => {
    if (!subsSel.length || !rgsSel.length) return
    setLoading(true)
    setErro(null)
    setPicoCarregado(false)
    const q: RecursosQuery = { subscription_id: subsSel, resource_group: rgsSel, data_inicio: dataInicio, data_fim: dataFim }
    setUltimaQuery(q)
    try {
      const data = await api.getRecursos(q)
      setRecursos(data)
      setSelecionados({})
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [api, subsSel, rgsSel, dataInicio, dataFim])

  // Lazy pico — buscado uma vez ao abrir o overlay Configurar Estimativa,
  // mesclado por resource_id+unidade (não reexecuta _dbComputeTaxas).
  const carregarPico = useCallback(async () => {
    if (picoCarregado || !ultimaQuery || !recursos.length) { setPicoCarregado(true); return }
    setPicoLoading(true)
    try {
      const data = await api.getRecursos({ ...ultimaQuery, pico: true })
      const picoMap = new Map(data.map((r) => [r.resource_id + '|' + (r.unidade || ''), r]))
      setRecursos((prev) => prev.map((r) => {
        const p = picoMap.get(r.resource_id + '|' + (r.unidade || ''))
        if (!p) return r
        return {
          ...r,
          custo_hora_pico: p.custo_hora_pico,
          pico_custo_dia: p.pico_custo_dia,
          pico_horas_dia: p.pico_horas_dia,
          custo_hora_pico_cluster: p.custo_hora_pico_cluster,
        }
      }))
    } catch {
      // silencioso — igual ao legado, pico é um enriquecimento opcional
    }
    setPicoCarregado(true)
    setPicoLoading(false)
  }, [api, picoCarregado, ultimaQuery, recursos.length])

  // RN-DB-001 — computado uma vez por busca (não a cada merge de pico, já
  // que os campos usados por _dbComputeTaxas não mudam com o pico).
  const dbTaxaMap = useMemo(() => computeDbTaxas(recursos), [recursos])

  // ── Seleção / filtros ──
  const [chGlobal, setChGlobal] = useState(720)
  const [horasAplicadas, setHorasAplicadas] = useState(false)
  const [filtroTexto, setFiltroTexto] = useState('')
  const [filtroTipos, setFiltroTipos] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [visao, setVisao] = useState<'recursos' | 'detalhe' | 'servico'>('recursos')

  const recursosFiltrados = useMemo(() => {
    const texto = filtroTexto.toLowerCase()
    const textoOk = (r: RecursoBilling) =>
      (r.nome_recurso || '').toLowerCase().includes(texto)
      || (r.categoria || '').toLowerCase().includes(texto)
      || (r.produto || '').toLowerCase().includes(texto)
      || (r.consumed_service || '').toLowerCase().includes(texto)
      || (r.charge_type || '').toLowerCase().includes(texto)
      || (r.unidade || '').toLowerCase().includes(texto)
      || (r.pricing_model || '').toLowerCase().includes(texto)
      || (r.resource_group_name || '').toLowerCase().includes(texto)
      || (r.publisher_type || '').toLowerCase().includes(texto)
      || (r.publisher_name || '').toLowerCase().includes(texto)
    return recursos.filter((r) => (!texto || textoOk(r)) && (!filtroTipos.size || filtroTipos.has(tipoRecurso(r))))
  }, [recursos, filtroTexto, filtroTipos])

  const grupos = useMemo(() => {
    const map = new Map<string, RecursoBilling[]>()
    const ordem: string[] = []
    for (const r of recursosFiltrados) {
      const bid = r.resource_id || ''
      if (!map.has(bid)) { map.set(bid, []); ordem.push(bid) }
      map.get(bid)!.push(r)
    }
    return ordem.map((bid) => ({ baseId: bid, filhas: map.get(bid)! }))
  }, [recursosFiltrados])

  const toggleGrupo = useCallback((baseId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(baseId)) next.delete(baseId); else next.add(baseId)
      return next
    })
  }, [])

  const check = useCallback((rid: string, checked: boolean) => {
    setSelecionados((prev) => {
      const next = { ...prev }
      if (checked) next[rid] = chGlobal; else delete next[rid]
      return next
    })
  }, [chGlobal])

  const checkGrupo = useCallback((baseId: string, checked: boolean) => {
    const filhas = recursos.filter((r) => r.resource_id === baseId)
    setSelecionados((prev) => {
      const next = { ...prev }
      for (const r of filhas) {
        const rid = recursoKey(r) || r.resource_id
        if (checked) next[rid] = chGlobal; else delete next[rid]
      }
      return next
    })
  }, [recursos, chGlobal])

  const checkAll = useCallback((checked: boolean) => {
    if (!checked) { setSelecionados({}); return }
    const next: Record<string, number> = {}
    for (const r of recursos) next[recursoKey(r) || r.resource_id] = chGlobal
    setSelecionados(next)
  }, [recursos, chGlobal])

  const aplicarHorasGlobal = useCallback(() => {
    const h = Math.max(1, chGlobal || 720)
    setSelecionados((prev) => {
      const next: Record<string, number> = {}
      for (const rid of Object.keys(prev)) next[rid] = h
      return next
    })
    setHorasAplicadas(true)
  }, [chGlobal])

  const toggleTipo = useCallback((tipo: string) => {
    setFiltroTipos((prev) => {
      const next = new Set(prev)
      if (next.has(tipo)) { next.delete(tipo); if (!next.size) next.clear() } else next.add(tipo)
      return next
    })
  }, [])

  return {
    subsQuery, subsSel, commitSubs,
    rgQuery, rgOptions, rgsSel, setRgsSel,
    dataInicio, setDataInicio, dataFim, setDataFim,
    recursos, loading, erro, buscarRecursos,
    picoCarregado, picoLoading, carregarPico,
    dbTaxaMap,
    selecionados, setSelecionados, chGlobal, setChGlobal, horasAplicadas, setHorasAplicadas,
    filtroTexto, setFiltroTexto, filtroTipos, toggleTipo,
    expandedGroups, toggleGrupo,
    visao, setVisao,
    recursosFiltrados, grupos,
    check, checkGrupo, checkAll, aplicarHorasGlobal,
  }
}

export type UseCalculadoraReturn = ReturnType<typeof useCalculadora>
