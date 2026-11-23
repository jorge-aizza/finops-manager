import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteDatabricksBudget, getDatabricksAnomalias, getDatabricksCotas, getDatabricksResumo, listDatabricksBudgets, updateDatabricksBudget, type DatabricksResumoFiltros } from '../api/databricksColeta'
import { deleteGenieBudget, listGenieBudgets, listGenieWorkspaces, resolveGenieUserPrincipals, updateGenieBudgetPrincipalOverride } from '../api/genieBudgets'
import type { DatabricksBudget, DatabricksResumoMes } from '../types/databricksResumo'
import type { GenieBudget } from '../types/genieBudgets'
import DatabricksBudgetModal from '../components/DatabricksBudgetModal'
import DatabricksCotasPanel from '../components/DatabricksCotasPanel'
import DatabricksJobRunsCard from '../components/DatabricksJobRunsCard'
import DatabricksClusterUtilizacaoCard from '../components/DatabricksClusterUtilizacaoCard'
import DatabricksQueryHistoryCard from '../components/DatabricksQueryHistoryCard'
import DatabricksAiGatewayCard from '../components/DatabricksAiGatewayCard'
import DatabricksStorageOtimizacaoCard from '../components/DatabricksStorageOtimizacaoCard'
import GenieBudgetModal from '../components/GenieBudgetModal'
import GenieBudgetUsersModal, { calcularUsuariosQuotaGenie } from '../components/GenieBudgetUsersModal'
import { forecastLinear } from '../lib/forecastLinear'
import { setDatabricksTabListener } from '../bridge'

type DbxTab = 'dashboard' | 'orcamentos' | 'cotas' | 'quotas'
// Rotulo da aba != titulo do hero: na fileira o texto precisa ser curto, no
// hero ele pode ser descritivo ("Dashboard Databricks", "Quotas Genie").
const DBX_TAB_LABEL: Record<DbxTab, string> = {
  dashboard: 'Consumo',
  orcamentos: 'Orçamentos e Anomalias',
  cotas: 'Cotas',
  quotas: 'Genie (nativo)',
}

const DBX_TAB_INFO: Record<DbxTab, { titulo: string; sub: string }> = {
  dashboard: { titulo: 'Consumo Databricks', sub: 'Análise detalhada por período, workspace/SKU/usuário/job/cluster/warehouse e free-tier vs. pago' },
  orcamentos: { titulo: 'Orçamentos e Anomalias', sub: 'Orçamentos internos com alerta por e-mail e detecção automática de anomalias de consumo' },
  cotas: { titulo: 'Cotas', sub: 'Consumo do mês contra o teto configurado, por workspace e por usuário — semáforo derivado de databricks_consumo' },
  quotas: { titulo: 'Quotas Genie', sub: 'Limites nativos do Databricks (Unity AI Gateway) para o uso do Genie — por workspace, usuário ou grupo' },
}

function escopoLabel(b: DatabricksBudget, workspaceNames: Map<string, string>): string {
  if (b.escopo_tipo === 'workspace' || b.escopo_tipo === 'workspace_por_usuario')
    return b.workspace_id ? workspaceNames.get(b.workspace_id) || 'Nome indisponível' : '—'
  if (b.escopo_tipo === 'tag') return `${b.tag_key} = ${b.tag_valor}`
  if (b.escopo_tipo === 'usuario') return b.usuario || '—'
  return 'Todos os workspaces'
}

function fmtUSD(v: number): string {
  return 'US$ ' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// DBU = Databricks Unit — unidade nativa de consumo (usage_quantity), não moeda.
// databricks_consumo só guarda linhas de billing Databricks (nunca infra Azure), então
// somar usage_quantity sem filtrar por usage_unit é seguro aqui.
function fmtDBU(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' DBU'
}

// Cor sequencial fixa por card de ranking (magnitude dentro de UMA categoria —
// não é uma paleta categórica comparando entidades entre si, então um hue só
// por card, não um por barra, segue a regra do skill dataviz: "cor segue a
// entidade" — aqui a entidade é "o card", as barras dentro dele são só
// magnitude). Reaproveita tokens já validados no resto do app (--accent/
// --blue/--green), não uma paleta nova — sem necessidade de rodar o
// validador do skill.
// items já vem com {label, value} separados (não deriva o valor de filtro do texto
// exibido) — necessário pro drill-down: "Não identificado" (usuário) é um rótulo de
// exibição, o valor real pra filtrar é o sentinel '__vazio__' (ver DatabricksResumoFiltros).
// Clicar num item chama onToggle — mesmo item selecionado de novo remove o filtro
// (toggle), consistente com o padrão de chips removíveis abaixo do período.
// `atencao` (opcional por item) cruza com o motor de Anomaly Detection (ver
// _computeAnomaliasDatabricks, server.js) — item marcado quando aparece em
// custo_diario (escopo workspace) ou usuarios da resposta de /anomalias. Ícone
// clicável (com stopPropagation pra não disparar o onToggle do drill-down do item)
// leva direto pra aba "Orçamentos e Anomalias" via onVerAnomalia — o detalhe completo
// (Z-score, % de crescimento) já mora lá, não duplicado aqui.
function RankingCard({ title, color, items, hint, activeValue, onToggle, onVerAnomalia }: {
  title: string
  color: string
  items: { custo: number; label: string; value: string; atencao?: boolean }[]
  hint?: string
  activeValue?: string | null
  onToggle?: (value: string) => void
  onVerAnomalia?: () => void
}) {
  const max = Math.max(1, ...items.map((i) => i.custo))
  return (
    <div className="card" style={{ flex: 1, minWidth: 260 }}>
      <div className="card-header">
        <span className="card-title">{title}</span>
      </div>
      {hint && <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>{hint}</div>}
      <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sem dados no período.</div>}
        {items.map((item, i) => {
          const pct = Math.round((item.custo / max) * 100)
          const ativo = activeValue === item.value
          return (
            <div
              key={i}
              onClick={onToggle ? () => onToggle(item.value) : undefined}
              title={onToggle ? (ativo ? 'Clique para remover o filtro' : `Filtrar por: ${item.label}`) : item.label}
              style={{
                cursor: onToggle ? 'pointer' : undefined,
                borderRadius: 6,
                padding: '3px 6px',
                margin: '0 -6px',
                background: ativo ? `color-mix(in srgb, ${color} 15%, transparent)` : 'transparent',
                border: `1px solid ${ativo ? color : 'transparent'}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {item.atencao && (
                    <span
                      title="Anomalia de consumo detectada — clique para ver detalhes em Orçamentos e Anomalias"
                      onClick={(e) => { e.stopPropagation(); onVerAnomalia?.() }}
                      style={{ flexShrink: 0, cursor: onVerAnomalia ? 'pointer' : undefined }}
                    >
                      ⚠️
                    </span>
                  )}
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                </span>
                <span style={{ fontWeight: 700, color, flexShrink: 0, marginLeft: 6 }}>{fmtUSD(item.custo)}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--bg)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 3 }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function mesLabel(mes: string): string {
  const [ano, m] = mes.split('-').map(Number)
  return `${MESES_ABREV[m - 1]}/${String(ano).slice(2)}`
}

// Barras (não linha) a pedido do usuário, com forecast de 3 meses (regressão linear —
// ver frontend/src/lib/forecastLinear.ts) anexado como barras extras. Barras reais
// empilhadas em Pago (roxo) + Free (verde) — pedido do usuário pra mostrar de onde vem
// o consumo por mês, não só o total (o forecast não separa pago/free — não há como
// prever essa proporção com confiança a partir de 2 números por mês, então a barra de
// previsão continua um bloco único hachurado representando o total projetado). Textura
// hachurada + borda tracejada pro previsto (não só uma cor mais clara) — distinção
// categórica "real vs. previsto", segue a regra do skill dataviz de reservar textura pro
// caso CVD/impressão: quem não distingue as cores ainda vê a hachura. Versão "executiva"
// (pedido do usuário): rótulo de valor total em toda barra, não só nas seletivas, e
// legenda sempre visível — todo número visível de cara, sem precisar de hover; o
// breakdown Pago/Free de cada mês real continua disponível no tooltip nativo (<title>).
//
// Clicável (pedido do usuário) — cada barra de mês REAL vira mais um filtro de
// drill-down, igual aos já existentes de Workspace/SKU/Usuário/Job/Cluster/Warehouse:
// clicar detalha o KPI de total e os 6 rankings abaixo pra aquele mês; clicar de novo no
// mesmo mês (ou no chip "Detalhando por") remove o filtro e volta a mostrar o total do
// período. Barras de previsão não são clicáveis — não há consumo real ainda pra detalhar.
// O mês selecionado ganha um contorno de destaque; os demais (reais e previsão) ficam com
// opacidade reduzida — foco visual na barra ativa sem esconder o resto da série.
function MonthlyBarChart({ data, mesSelecionado, onSelectMes }: {
  data: DatabricksResumoMes[]
  mesSelecionado?: string | null
  onSelectMes?: (mes: string) => void
}) {
  if (data.length === 0) return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 20px 16px' }}>Sem dados no período.</div>

  const serie = forecastLinear(data, 3)
  const temPrevisao = serie.some((d) => d.previsto)
  const temFree = data.some((d) => d.free > 0)
  const splitPorMes = new Map(data.map((d) => [d.mes, { free: d.free, pago: d.pago }]))

  const W = 640, H = 200, PAD_TOP = 30, PAD_BOTTOM = 30, PAD_SIDE = 10
  const plotH = H - PAD_TOP - PAD_BOTTOM
  const max = Math.max(1, ...serie.map((d) => d.custo))
  const slot = (W - PAD_SIDE * 2) / serie.length
  const barW = Math.max(6, slot * 0.55)
  const baseY = H - PAD_BOTTOM

  return (
    <div style={{ padding: '0 20px 16px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 220 }}>
        <defs>
          <pattern id="dbxForecastHatch" width={6} height={6} patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width={6} height={6} fill="var(--accent)" fillOpacity={0.10} />
            <line x1={0} y1={0} x2={0} y2={6} stroke="var(--accent)" strokeWidth={2} strokeOpacity={0.4} />
          </pattern>
        </defs>
        <line x1={PAD_SIDE} y1={baseY} x2={W - PAD_SIDE} y2={baseY} stroke="var(--border)" strokeWidth={1} />
        {serie.map((d, i) => {
          const x = PAD_SIDE + i * slot + (slot - barW) / 2
          const split = d.previsto ? null : splitPorMes.get(d.mes)
          const pago = split ? split.pago : d.custo
          const free = split ? split.free : 0
          const gap = free > 0 && pago > 0 ? 2 : 0
          const pagoH = (pago / max) * plotH
          const freeH = free > 0 ? (free / max) * plotH : 0
          const totalH = pagoH + gap + freeH
          const topY = baseY - totalH
          const breakdown = free > 0 ? ` — Pago: ${fmtUSD(pago)} · Free: ${fmtUSD(free)}` : ''
          const selecionavel = !d.previsto && !!onSelectMes
          const selecionado = mesSelecionado === d.mes
          const opacidade = mesSelecionado && !selecionado ? 0.35 : 1
          const titulo = `${mesLabel(d.mes)}: ${fmtUSD(d.custo)}${d.previsto ? ' (previsão — tendência linear)' : breakdown}${selecionavel ? (selecionado ? ' — clique para remover o filtro' : ' — clique para detalhar este mês') : ''}`
          return (
            <g
              key={d.mes}
              style={{ opacity: opacidade, cursor: selecionavel ? 'pointer' : 'default', transition: 'opacity .15s' }}
              onClick={selecionavel ? () => onSelectMes!(d.mes) : undefined}
            >
              {selecionado && (
                <rect
                  x={x - 3} y={topY - 3} width={barW + 6} height={Math.max(1, totalH) + 6} rx={4}
                  fill="none" stroke="var(--text)" strokeWidth={1.5}
                />
              )}
              {(pago > 0 || d.previsto) && (
                <rect
                  x={x} y={baseY - pagoH} width={barW} height={Math.max(1, pagoH)} rx={2}
                  fill={d.previsto ? 'url(#dbxForecastHatch)' : 'var(--accent)'}
                  stroke={d.previsto ? 'var(--accent)' : 'none'}
                  strokeWidth={d.previsto ? 1.5 : 0}
                  strokeDasharray={d.previsto ? '3,2' : undefined}
                >
                  <title>{titulo}</title>
                </rect>
              )}
              {free > 0 && (
                <rect x={x} y={baseY - pagoH - gap - freeH} width={barW} height={Math.max(1, freeH)} rx={2} fill="var(--green)">
                  <title>{titulo}</title>
                </rect>
              )}
              {d.custo > 0.005 && (
                <text x={x + barW / 2} y={Math.max(10, topY - 6)} fontSize={9.5} fontWeight={700} fill="var(--text)" textAnchor="middle">
                  {fmtUSD(d.custo)}
                </text>
              )}
              <text x={x + barW / 2} y={H - PAD_BOTTOM + 14} fontSize={10} fontWeight={selecionado ? 700 : 400} fill={selecionado ? 'var(--text)' : 'var(--text-muted)'} textAnchor="middle">
                {mesLabel(d.mes)}
              </text>
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 11, color: 'var(--text-muted)' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--accent)', borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />Pago</span>
        {temFree && (
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--green)', borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />Free</span>
        )}
        {temPrevisao && (
          <span><span style={{ display: 'inline-block', width: 10, height: 10, border: '1.5px dashed var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />Previsão (tendência linear, 3 meses)</span>
        )}
      </div>
    </div>
  )
}

// Últimos 6 meses — mesmo default usado no servidor (GET /resumo sem
// data_inicio/data_fim) — calculado aqui também pra inicializar os
// efeito esperando a resposta pra "descobrir" o período.
function defaultPeriodo(): { inicio: string; fim: string } {
  const fim = new Date()
  const ini = new Date(fim)
  ini.setMonth(ini.getMonth() - 6)
  return { inicio: ini.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) }
}

const FILTRO_LABELS: Record<keyof DatabricksResumoFiltros, string> = {
  workspace_id: 'Workspace',
  sku_name: 'SKU',
  usuario: 'Usuário',
  job_id: 'Job',
  cluster_id: 'Cluster',
  warehouse_id: 'Warehouse',
  mes: 'Mês',
}
function labelFiltroValor(campo: keyof DatabricksResumoFiltros, valor: string, workspaceNames: Map<string, string>): string {
  if (campo === 'workspace_id') return workspaceNames.get(valor) || 'Nome indisponível'
  if (campo === 'usuario' && valor === '__vazio__') return 'Não identificado'
  if (campo === 'mes') return mesLabel(valor)
  return valor
}

export default function DatabricksDashboardView() {
  const queryClient = useQueryClient()
  // 3 sub-abas (Dashboard/Orçamentos e Anomalias/Quotas) trocadas pelo sub-nav da sidebar
  // sem remontar esta view — mesmo padrão já usado por DashboardView.tsx (Ações/
  // Estimativas), canal próprio da ponte (setDatabricksTabListener), separado do de
  // Dashboard.
  const [dbxTab, setDbxTab] = useState<DbxTab>('dashboard')
  useEffect(() => setDatabricksTabListener((t) => setDbxTab(t === 'orcamentos' || t === 'quotas' || t === 'cotas' ? t : 'dashboard')), [])
  const [periodo, setPeriodo] = useState(defaultPeriodo)
  const [inicioInput, setInicioInput] = useState(periodo.inicio)
  const [fimInput, setFimInput] = useState(periodo.fim)
  const [filtros, setFiltros] = useState<DatabricksResumoFiltros>({})

  const resumoQuery = useQuery({
    queryKey: ['databricks-resumo', periodo.inicio, periodo.fim, filtros.workspace_id, filtros.sku_name, filtros.usuario, filtros.job_id, filtros.cluster_id, filtros.warehouse_id, filtros.mes],
    queryFn: () => getDatabricksResumo(periodo.inicio, periodo.fim, filtros),
    // Bug real reportado pelo usuário — clicar num filtro de drill-down (mês, workspace,
    // sku...) fazia a página "voltar pro topo": cada combinação de filtros é uma entrada
    // NOVA no cache do React Query (queryKey muda), então sem placeholderData o `data`
    // vira `undefined` enquanto a nova busca corre — o bloco inteiro de KPIs/gráfico/
    // rankings (todo `resumo && resumo.tem_dados && (...)`) sumia da tela por um instante,
    // o documento encolhia, e o browser era forçado a recuar o scroll pra caber na página
    // mais curta (efeito idêntico a "ir pro topo"). `keepPreviousData` mantém os dados
    // antigos visíveis (só `isFetching` fica true) até a resposta nova chegar — sem
    // colapso de altura, sem pulo de scroll.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

  // Lista de workspaces pro dropdown de orçamento — query PRÓPRIA, com range bem largo
  // e sem os filtros de drill-down (mesmo padrão já usado por DatabricksExpurgoModal.tsx).
  // Se reaproveitasse resumoQuery.data.por_workspace, um drill-down ativo por workspace
  // reduziria essa lista a 1 item só, quebrando "Novo Orçamento" enquanto o usuário
  // estivesse com um filtro aplicado.
  const workspacesQuery = useQuery({
    queryKey: ['databricks-resumo-workspaces'],
    queryFn: () => getDatabricksResumo('2015-01-01', new Date().toISOString().slice(0, 10)),
    staleTime: 5 * 60 * 1000,
  })
  const workspaceIds = [...new Set([
    ...(workspacesQuery.data?.por_workspace || []).map((w) => w.workspace_id),
    ...(resumoQuery.data?.por_workspace || []).map((w) => w.workspace_id),
  ])].sort()
  const workspaceNamesQuery = useQuery({
    queryKey: ['genie-workspaces', workspaceIds.join(',')],
    queryFn: () => listGenieWorkspaces(workspaceIds),
    enabled: workspaceIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })
  const workspaceNameById = new Map((workspaceNamesQuery.data || []).map((ws) => [ws.workspace_id, ws.nome]))
  const workspaces = workspaceIds.map((workspace_id) => ({
    workspace_id,
    nome: workspaceNameById.get(workspace_id) || 'Nome indisponível',
  }))

  function toggleFiltro(campo: keyof DatabricksResumoFiltros, valor: string) {
    setFiltros((f) => (f[campo] === valor ? { ...f, [campo]: undefined } : { ...f, [campo]: valor }))
  }

  // Cruza os rankings "Por Workspace"/"Por Usuário" com o motor de Anomaly Detection —
  // mesma queryKey já usada por AnomaliasCard (aba Orçamentos e Anomalias), então React
  // Query compartilha o cache entre as duas abas sem refazer a chamada. Anomalia de
  // escopo 'global' não marca nenhum workspace específico (não é sobre um workspace só).
  const anomaliasQuery = useQuery({ queryKey: ['databricks-anomalias'], queryFn: getDatabricksAnomalias })
  const workspacesComAnomalia = new Set(
    (anomaliasQuery.data?.custo_diario || []).filter((a) => a.escopo_tipo === 'workspace').map((a) => a.escopo_valor),
  )
  const usuariosComAnomalia = new Set((anomaliasQuery.data?.usuarios || []).map((u) => u.usuario))
  function verAnomalias() { setDbxTab('orcamentos') }

  const budgetsQuery = useQuery({ queryKey: ['databricks-budgets'], queryFn: listDatabricksBudgets })
  const [budgetModalOpen, setBudgetModalOpen] = useState(false)
  const [editingBudget, setEditingBudget] = useState<DatabricksBudget | null>(null)

  // Reenvia TODOS os campos do orçamento (não só {nome, workspace_id, valor_mensal,
  // ativo}) — um PUT parcial faria _validarBudgetInput (server.js) derivar escopo_tipo
  // de volta a partir só de workspace_id, convertendo silenciosamente um orçamento por
  // tag pra "global" a cada toggle de ativo/inativo.
  const toggleAtivoMutation = useMutation({
    mutationFn: (b: DatabricksBudget) => updateDatabricksBudget(b.id, {
      nome: b.nome, escopo_tipo: b.escopo_tipo, workspace_id: b.workspace_id,
      tag_key: b.tag_key, tag_valor: b.tag_valor, usuario: b.usuario, valor_mensal: b.valor_mensal,
      threshold_atencao: b.threshold_atencao, threshold_critico: b.threshold_critico,
      ativo: !b.ativo,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['databricks-budgets'] })
      queryClient.invalidateQueries({ queryKey: ['databricks-alertas'] })
    },
  })
  const deleteBudgetMutation = useMutation({
    mutationFn: (id: number) => deleteDatabricksBudget(id),
    onSuccess: () => {
      window.showToast?.('Orçamento excluído.', 'success')
      queryClient.invalidateQueries({ queryKey: ['databricks-budgets'] })
      queryClient.invalidateQueries({ queryKey: ['databricks-alertas'] })
    },
  })

  function handleDeleteBudget(b: DatabricksBudget) {
    if (!confirm(`Excluir o orçamento "${b.nome}"?`)) return
    deleteBudgetMutation.mutate(b.id)
  }

  const resumo = resumoQuery.data
  const totalFree = resumo?.free_vs_pago.free ?? 0
  const totalPago = resumo?.free_vs_pago.pago ?? 0
  const totalFreePago = totalFree + totalPago
  const pctFree = totalFreePago > 0 ? Math.round((totalFree / totalFreePago) * 100) : 0

  const dbuFree = resumo?.dbus_free_vs_pago.free ?? 0
  const dbuPago = resumo?.dbus_free_vs_pago.pago ?? 0
  const dbuTotal = dbuFree + dbuPago
  const pctDbuFree = dbuTotal > 0 ? Math.round((dbuFree / dbuTotal) * 100) : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="view-hero">
        <h1 className="page-title">{DBX_TAB_INFO[dbxTab].titulo}</h1>
        <p className="view-hero-sub">{DBX_TAB_INFO[dbxTab].sub}</p>
      </div>

      {/* Barra de abas na pagina, no idioma da .nav do cockpit. Antes as abas
          do Databricks so existiam no menu lateral -- com a sidebar recolhida
          nao havia como trocar de aba pela pagina.
          Chama window.showDbxTab (nao setDbxTab direto) para que o realce do
          submenu lateral acompanhe: aquela funcao atualiza os dois. */}
      <div className="view-tabs" role="tablist" aria-label="Seções do Databricks">
        {(Object.keys(DBX_TAB_INFO) as DbxTab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-current={dbxTab === t ? 'page' : undefined}
            onClick={() => window.showDbxTab?.(t)}
          >
            {DBX_TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {dbxTab === 'dashboard' && (
        <>
          <div className="stat-card" style={{ padding: '14px 20px', display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="dbxd-ini">De</label>
              <input id="dbxd-ini" type="date" value={inicioInput} onChange={(e) => setInicioInput(e.target.value)} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="dbxd-fim">Até</label>
              <input id="dbxd-fim" type="date" value={fimInput} onChange={(e) => setFimInput(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={!inicioInput || !fimInput} onClick={() => setPeriodo({ inicio: inicioInput, fim: fimInput })}>
              Buscar
            </button>
            {resumoQuery.isFetching && <span role="status" style={{ fontSize: 12, color: 'var(--text-muted)' }}>Atualizando dados...</span>}
          </div>

          {(Object.entries(filtros) as [keyof DatabricksResumoFiltros, string | undefined][]).some(([, v]) => v) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Detalhando por:</span>
              {(Object.entries(filtros) as [keyof DatabricksResumoFiltros, string | undefined][])
                .filter((entry): entry is [keyof DatabricksResumoFiltros, string] => !!entry[1])
                .map(([campo, valor]) => (
                  <span
                    key={campo}
                    className="badge"
                    style={{ cursor: 'pointer' }}
                    title="Clique para remover este filtro"
                    onClick={() => setFiltros((f) => ({ ...f, [campo]: undefined }))}
                  >
                    {FILTRO_LABELS[campo]}: {labelFiltroValor(campo, valor, workspaceNameById)} ✕
                  </span>
                ))}
              <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 10px' }} onClick={() => setFiltros({})}>
                Limpar filtros
              </button>
            </div>
          )}

          {resumo && !resumo.tem_dados && (
            <div className="stat-card" style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
              Nenhum dado de consumo Databricks no período selecionado. Configure uma conexão e rode uma coleta em
              <strong> Coleta Automática → Coleta Databricks</strong> — os gráficos aparecem aqui assim que houver dados.
            </div>
          )}

          {resumo && resumo.tem_dados && (
            <>
              <div className="stats-grid">
                <div className="stat-card accent">
                  <div className="stat-label">Custo Total no Período</div>
                  <div className="stat-value">{fmtUSD(resumo.total_custo)}</div>
                  <div className="stat-sub">{resumo.periodo.inicio} → {resumo.periodo.fim}</div>
                </div>
                <div className="stat-card green-card">
                  <div className="stat-label">Free-tier</div>
                  <div className="stat-value green">{fmtUSD(totalFree)}</div>
                  <div className="stat-sub">{pctFree}% do consumo</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Pago</div>
                  <div className="stat-value">{fmtUSD(totalPago)}</div>
                  <div className="stat-sub">{100 - pctFree}% do consumo</div>
                </div>
              </div>

              {totalFreePago > 0 && (
                <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  <div style={{ width: pctFree + '%', background: 'var(--green,#22c55e)' }} title={`Free-tier: ${fmtUSD(totalFree)}`} />
                  <div style={{ width: (100 - pctFree) + '%', background: 'var(--accent)' }} title={`Pago: ${fmtUSD(totalPago)}`} />
                </div>
              )}

              <div className="card">
                <div className="card-header"><span className="card-title">DBUs Consumidos</span></div>
                <div style={{ padding: '0 20px 8px', fontSize: 12, color: 'var(--text-muted)' }}>
                  Unidade nativa do Databricks (DBU) — quanto foi consumido, independente do valor cobrado.
                </div>
                <div className="stats-grid" style={{ padding: '0 20px 16px' }}>
                  <div className="stat-card">
                    <div className="stat-label">Total de DBUs</div>
                    <div className="stat-value">{fmtDBU(dbuTotal)}</div>
                  </div>
                  <div className="stat-card green-card">
                    <div className="stat-label">DBUs Free-tier</div>
                    <div className="stat-value green">{fmtDBU(dbuFree)}</div>
                    <div className="stat-sub">{pctDbuFree}% do consumo</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">DBUs Pagos</div>
                    <div className="stat-value">{fmtDBU(dbuPago)}</div>
                    <div className="stat-sub">{100 - pctDbuFree}% do consumo</div>
                  </div>
                </div>
                {dbuTotal > 0 && (
                  <div style={{ margin: '0 20px 16px', display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', border: '1px solid var(--border)' }}>
                    <div style={{ width: pctDbuFree + '%', background: 'var(--green,#22c55e)' }} title={`Free-tier: ${fmtDBU(dbuFree)}`} />
                    <div style={{ width: (100 - pctDbuFree) + '%', background: 'var(--accent)' }} title={`Pago: ${fmtDBU(dbuPago)}`} />
                  </div>
                )}
              </div>

              <div className="card">
                <div className="card-header"><span className="card-title">Tendência Mensal</span></div>
                <MonthlyBarChart
                  data={resumo.por_mes}
                  mesSelecionado={filtros.mes ?? null}
                  onSelectMes={(mes) => toggleFiltro('mes', mes)}
                />
              </div>

              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                🔍 Clique numa barra de mês na Tendência Mensal, ou num item de Workspace, SKU, Usuário, Job, Cluster ou Warehouse, para detalhar os demais números por esse filtro — clique de novo pra remover.
                {' '}⚠️ marca itens com anomalia de consumo detectada — clique no ícone pra ver o detalhe.
              </div>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                <RankingCard
                  title="Por Workspace"
                  color="var(--accent)"
                  items={resumo.por_workspace.map((w) => ({
                    custo: w.custo,
                    label: workspaceNameById.get(w.workspace_id) || 'Nome indisponível',
                    value: w.workspace_id,
                    atencao: workspacesComAnomalia.has(w.workspace_id),
                  }))}
                  activeValue={filtros.workspace_id ?? null}
                  onToggle={(v) => toggleFiltro('workspace_id', v)}
                  onVerAnomalia={verAnomalias}
                />
                <RankingCard
                  title="Por SKU"
                  color="var(--blue,#4da6ff)"
                  items={resumo.por_sku.map((s) => ({ custo: s.custo, label: s.sku_name, value: s.sku_name }))}
                  activeValue={filtros.sku_name ?? null}
                  onToggle={(v) => toggleFiltro('sku_name', v)}
                />
                <RankingCard
                  title="Por Usuário"
                  color="var(--green,#22c55e)"
                  items={resumo.por_usuario.map((u) => ({
                    custo: u.custo, label: u.usuario, value: u.usuario === 'Não identificado' ? '__vazio__' : u.usuario,
                    atencao: usuariosComAnomalia.has(u.usuario),
                  }))}
                  hint="Usuário vem de identity_metadata.run_as (System Tables)"
                  activeValue={filtros.usuario ?? null}
                  onToggle={(v) => toggleFiltro('usuario', v)}
                  onVerAnomalia={verAnomalias}
                />
                <RankingCard
                  title="Por Job"
                  color="var(--orange,#ff8c42)"
                  items={resumo.por_job.map((j) => ({ custo: j.custo, label: j.job_name || j.job_id, value: j.job_id }))}
                  hint="Job/nome vêm de usage_metadata (System Tables) — só aparece quando a linha de billing veio de job compute"
                  activeValue={filtros.job_id ?? null}
                  onToggle={(v) => toggleFiltro('job_id', v)}
                />
                <RankingCard
                  title="Por Cluster"
                  color="var(--accent)"
                  items={resumo.por_cluster.map((c) => ({ custo: c.custo, label: c.cluster_id, value: c.cluster_id }))}
                  hint="Sem nome amigável — inventário de clusters (dono, tags) ainda não é coletado, só o ID"
                  activeValue={filtros.cluster_id ?? null}
                  onToggle={(v) => toggleFiltro('cluster_id', v)}
                />
                <RankingCard
                  title="Por Warehouse"
                  color="var(--blue,#4da6ff)"
                  items={resumo.por_warehouse.map((w) => ({ custo: w.custo, label: w.warehouse_id, value: w.warehouse_id }))}
                  hint="Só SQL Warehouse — Databricks não tem system table de inventário pra warehouses"
                  activeValue={filtros.warehouse_id ?? null}
                  onToggle={(v) => toggleFiltro('warehouse_id', v)}
                />
                <RankingCard
                  title="Por Model Serving"
                  color="var(--orange,#ff8c42)"
                  items={resumo.por_model_serving.map((m) => ({ custo: m.custo, label: m.endpoint, value: m.endpoint }))}
                  hint="Custo já vem de system.billing.usage (mesma coleta de sempre) — sem drill-down, endpoint não é um filtro do dashboard ainda"
                />
              </div>

              <DatabricksClusterUtilizacaoCard periodo={periodo} />
              <DatabricksQueryHistoryCard periodo={periodo} />
              <DatabricksAiGatewayCard periodo={periodo} />
              <DatabricksStorageOtimizacaoCard periodo={periodo} />

              <DatabricksJobRunsCard periodo={periodo} jobId={filtros.job_id} />
            </>
          )}
        </>
      )}

      {dbxTab === 'orcamentos' && (
        <>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Orçamentos</span>
              <span className="badge" style={{ marginLeft: 8, fontSize: 10 }}>{budgetsQuery.data?.length ?? 0}</span>
              <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={() => { setEditingBudget(null); setBudgetModalOpen(true) }}>
                Novo Orçamento
              </button>
            </div>
            <div style={{ padding: '0 20px 8px', fontSize: 12, color: 'var(--text-muted)' }}>
              Alerta é disparado ao entrar no sistema quando o consumo do mês corrente passa do threshold "Alertar" de cada orçamento (100% é sempre estourado). Escopo pode ser global, um workspace específico, ou uma tag (projeto/time/centro de custo).
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead><tr><th>Nome</th><th>Escopo</th><th>Valor Mensal</th><th>Alertar / Crítico</th><th>Ativo</th><th>Ações</th></tr></thead>
                <tbody>
                  {(budgetsQuery.data || []).map((b) => (
                    <tr key={b.id}>
                      <td>{b.nome}</td>
                      <td>{b.workspace_id && ['workspace', 'workspace_por_usuario'].includes(b.escopo_tipo)
                        ? <strong>{workspaceNameById.get(b.workspace_id) || 'Nome indisponível'}</strong>
                        : escopoLabel(b, workspaceNameById)}</td>
                      <td>{fmtUSD(b.valor_mensal)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.threshold_atencao}% / {b.threshold_critico}%</td>
                      <td><input type="checkbox" checked={b.ativo} onChange={() => toggleAtivoMutation.mutate(b)} /></td>
                      <td>
                        <div className="table-actions">
                          <button className="btn-icon" title="Editar" onClick={() => { setEditingBudget(b); setBudgetModalOpen(true) }}>
                            <svg viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3V10l8-8z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" /></svg>
                          </button>
                          <button className="btn-icon delete" title="Excluir" onClick={() => handleDeleteBudget(b)}>
                            <svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(budgetsQuery.data || []).length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum orçamento cadastrado.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <AnomaliasCard workspaceNameById={workspaceNameById} />
        </>
      )}

      {dbxTab === 'cotas' && <DatabricksCotasPanel />}
      {dbxTab === 'quotas' && <GenieBudgetsCard />}

      {budgetModalOpen && (
        <DatabricksBudgetModal budget={editingBudget} workspaces={workspaces} onClose={() => setBudgetModalOpen(false)} />
      )}
    </div>
  )
}

// Anomaly Detection (2026-08-28) — card próprio, consulta independente da janela de
// período do dashboard (o motor sempre olha os últimos 35 dias pra Z-score de custo e
// 7 dias recentes vs. 4 semanas anteriores pra usuário — ver _computeAnomaliasDatabricks,
// server.js — filtrar pelo period-picker do topo não faria sentido pra esse tipo de
// análise). Sem drill-down aqui — anomalias já são, por definição, uma lista curta de
// exceções, não um agregado pra detalhar mais.
function AnomaliasCard({ workspaceNameById }: { workspaceNameById: Map<string, string> }) {
  const anomaliasQuery = useQuery({ queryKey: ['databricks-anomalias'], queryFn: getDatabricksAnomalias })
  const anomalias = anomaliasQuery.data
  const total = (anomalias?.custo_diario.length ?? 0) + (anomalias?.usuarios.length ?? 0)

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">⚠ Anomalias Detectadas</span>
        <span className="badge" style={{ marginLeft: 8, fontSize: 10 }}>{total}</span>
      </div>
      <div style={{ padding: '0 20px 8px', fontSize: 12, color: 'var(--text-muted)' }}>
        Custo diário fora do padrão histórico (Z-score ≥ 2,5) e usuários com crescimento de consumo ≥ 100% vs. a média das últimas 4 semanas.
      </div>
      {anomaliasQuery.isLoading && <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>Calculando...</div>}
      {anomalias && total === 0 && (
        <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>Nenhuma anomalia detectada.</div>
      )}
      {anomalias && total > 0 && (
        <div className="table-wrapper">
          <table className="data-table">
            <thead><tr><th>Tipo</th><th>Escopo</th><th>Detalhe</th><th>Desvio</th></tr></thead>
            <tbody>
              {anomalias.custo_diario.map((a, i) => (
                <tr key={'cd' + i}>
                  <td>📈 Custo diário</td>
                  <td>{a.escopo_tipo === 'workspace' && a.escopo_valor
                    ? <strong>{workspaceNameById.get(a.escopo_valor) || 'Nome indisponível'}</strong>
                    : 'Global'}</td>
                  <td>
                    {new Date(a.usage_date + 'T00:00:00').toLocaleDateString('pt-BR')} — {fmtUSD(a.custo)}
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> (média {fmtUSD(a.media)})</span>
                  </td>
                  <td style={{ color: 'var(--orange,#ff8c42)', fontWeight: 700 }}>Z {a.zscore >= 0 ? '+' : ''}{a.zscore.toFixed(2)}</td>
                </tr>
              ))}
              {anomalias.usuarios.map((u, i) => (
                <tr key={'us' + i}>
                  <td>👤 Usuário</td>
                  <td>{u.usuario}</td>
                  <td>
                    Últimos 7 dias: {fmtUSD(u.custo_recente)}
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> (histórico: {fmtUSD(u.media_diaria_historica)}/dia)</span>
                  </td>
                  <td style={{ color: 'var(--orange,#ff8c42)', fontWeight: 700 }}>
                    {u.crescimento_pct == null ? 'Novo' : `+${(u.crescimento_pct * 100).toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Quotas Genie via Databricks Account Budgets API (2026-08-28) — diferente do card
// "Orçamentos" acima (calculado por nós sobre databricks_consumo, só alerta): isto lista/
// cria/exclui budgets NATIVOS do Databricks (resource_type=UNITY_AI_GATEWAY), aplicados
// pelo próprio Databricks — inclusive podendo bloquear acesso real ao Genie (ver
// GenieBudgetModal.tsx). Exige conexão padrão em modo OAuth M2M com Account Admin — sem
// isso, o servidor recusa com uma mensagem explicando o motivo (ver
// _getDbxAccountCredentials, server.js), exibida aqui em vez de escondida.
function GenieBudgetsCard() {
  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingBudget, setEditingBudget] = useState<GenieBudget | null>(null)
  const [usuariosBudget, setUsuariosBudget] = useState<GenieBudget | null>(null)
  const [usuariosBudgetEscopo, setUsuariosBudgetEscopo] = useState<'padrao' | 'overrides'>('padrao')
  const hoje = new Date()
  const ymd = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const inicioMes = ymd(new Date(hoje.getFullYear(), hoje.getMonth(), 1))
  const fimMes = ymd(hoje)
  const mesAtual = inicioMes.slice(0, 7)
  const budgetsQuery = useQuery({ queryKey: ['genie-budgets'], queryFn: listGenieBudgets })
  const genieBudgets = budgetsQuery.data?.budgets ?? []
  const consumoQuery = useQuery({
    queryKey: ['genie-workspace-consumo', mesAtual],
    queryFn: () => getDatabricksCotas({ data_inicio: inicioMes, data_fim: fimMes }, true),
  })
  const porUsuario = consumoQuery.data?.por_usuario ?? []
  const budgetsPorUsuario = genieBudgets.filter((budget) =>
    budget.alert_configurations?.some((alerta) =>
      alerta.scope_type === 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER' || (alerta.principal_overrides?.length ?? 0) > 0,
    ))
  const workspacesPorUsuario = [...new Set(budgetsPorUsuario.flatMap((budget) =>
    budget.filter?.workspace_id?.values?.map(String) ?? [],
  ))]
  const usuariosAtivos = [...new Set(porUsuario
    .filter((row) => !workspacesPorUsuario.length || workspacesPorUsuario.includes(String(row.workspace_id)))
    .map((row) => row.usuario.trim()).filter(Boolean))]
  const temQuotaPorUsuario = budgetsPorUsuario.length > 0
  const principalsQuery = useQuery({
    queryKey: ['genie-active-user-principals', usuariosAtivos.join(',')],
    queryFn: () => resolveGenieUserPrincipals(usuariosAtivos),
    enabled: budgetsQuery.isSuccess && consumoQuery.isSuccess && temQuotaPorUsuario && usuariosAtivos.length > 0,
    retry: false,
  })
  const tagsBudgetSelecionado = usuariosBudget?.filter?.tags ?? []
  const consumoTagsQuery = useQuery({
    queryKey: ['genie-budget-tagged-spend', usuariosBudget?.budget_configuration_id ?? '', inicioMes, fimMes, JSON.stringify(tagsBudgetSelecionado)],
    queryFn: () => getDatabricksCotas(
      { data_inicio: inicioMes, data_fim: fimMes }, true, false, tagsBudgetSelecionado,
    ),
    enabled: !!usuariosBudget && tagsBudgetSelecionado.length > 0,
    retry: false,
  })
  const consumoUsuariosModal = tagsBudgetSelecionado.length
    ? consumoTagsQuery.data?.por_usuario ?? []
    : porUsuario
  const consumoFiltradoPorTags = tagsBudgetSelecionado.length > 0
    && consumoTagsQuery.isSuccess && consumoTagsQuery.data?.tag_filters_applied === true
  const erroConsumoTags = tagsBudgetSelecionado.length > 0 && consumoTagsQuery.isSuccess
    && !consumoFiltradoPorTags
    ? 'O backend ainda não confirmou a aplicação das tags; atualize o serviço para habilitar o progresso.'
    : tagsBudgetSelecionado.length > 0 && consumoTagsQuery.isError
      ? (consumoTagsQuery.error as Error).message : null
  const resultadoUsuariosModal = usuariosBudget
    ? calcularUsuariosQuotaGenie(
      usuariosBudget, consumoUsuariosModal, principalsQuery.data ?? [],
      consumoFiltradoPorTags,
    )
    : null
  const idsParaResolver = [...new Set([
    ...genieBudgets.flatMap((budget) => budget.filter?.workspace_id?.values?.map(String) ?? []),
  ])]
  const nomesQuery = useQuery({
    queryKey: ['genie-workspaces', idsParaResolver.join(',')],
    queryFn: () => listGenieWorkspaces(idsParaResolver),
  })
  const nomePorWorkspace = new Map((nomesQuery.data ?? []).map((ws) => [ws.workspace_id, ws.nome]))
  const workspaces = (consumoQuery.data?.por_workspace ?? []).map((ws) => ({
    ...ws,
    nome: nomePorWorkspace.get(String(ws.workspace_id)) || 'Nome indisponível',
  }))
  const workspaceOptionsMap = new Map((nomesQuery.data ?? []).map((ws) => [ws.workspace_id, {
    workspace_id: ws.workspace_id,
    nome: ws.nome,
    custo: null as number | null,
  }]))
  for (const ws of workspaces) {
    const workspace_id = String(ws.workspace_id)
    workspaceOptionsMap.set(workspace_id, {
      workspace_id,
      nome: nomePorWorkspace.get(workspace_id) || 'Nome indisponível',
      custo: ws.custo,
    })
  }
  for (const id of genieBudgets.flatMap((budget) => budget.filter?.workspace_id?.values?.map(String) ?? [])) {
    if (!workspaceOptionsMap.has(id)) workspaceOptionsMap.set(id, { workspace_id: id, nome: 'Nome indisponível', custo: null })
  }
  const workspaceOptions = [...workspaceOptionsMap.values()].sort((a, b) => a.nome.localeCompare(b.nome))
  const consumoPorWorkspace = new Map(workspaces.map((ws) => [String(ws.workspace_id), ws.custo]))
  const dbusPorWorkspace = new Map(workspaces.map((ws) => [String(ws.workspace_id), ws.dbus]))
  const idsSemNome = [...new Set(genieBudgets
    .flatMap((budget) => budget.filter?.workspace_id?.values?.map(String) ?? [])
    .filter((id) => !nomePorWorkspace.has(id)))]

  function handleEdit(b: GenieBudget) {
    setEditingBudget(b)
    setModalOpen(true)
  }

  function handleClose() {
    setModalOpen(false)
    setEditingBudget(null)
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteGenieBudget(id),
    onSuccess: () => {
      window.showToast?.('Quota Genie excluída no Databricks.', 'success')
      queryClient.invalidateQueries({ queryKey: ['genie-budgets'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao excluir quota Genie: ' + e.message, 'error'),
  })

  const updatePrincipalOverrideMutation = useMutation({
    mutationFn: ({ budgetId, principalId, monthlyLimit, confirmarBloqueio }: {
      budgetId: string; principalId: number; monthlyLimit: number; confirmarBloqueio: boolean
    }) => updateGenieBudgetPrincipalOverride(budgetId, principalId, {
      monthly_limit_usd: monthlyLimit,
      confirmar_bloqueio: confirmarBloqueio,
    }),
    onSuccess: () => {
      window.showToast?.('Limite individual atualizado no Databricks.', 'success')
      queryClient.invalidateQueries({ queryKey: ['genie-budgets'] })
      setUsuariosBudget(null)
    },
    onError: (e: Error) => window.showToast?.('Erro ao atualizar limite individual: ' + e.message, 'error'),
  })

  function handleDelete(b: GenieBudget) {
    if (!confirm(`Excluir a quota Genie "${b.display_name}" no Databricks? Isso remove o limite/bloqueio configurado lá, não só localmente.`)) return
    deleteMutation.mutate(b.budget_configuration_id)
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">🧞 Quotas Genie (Databricks nativo)</span>
        <span className="badge" style={{ marginLeft: 8, fontSize: 10 }}>{genieBudgets.length} Genie</span>
        {budgetsQuery.data && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>de {budgetsQuery.data.account_total} budgets na conta</span>}
        <button className="btn-primary" style={{ marginLeft: 'auto' }} onClick={() => { setEditingBudget(null); setModalOpen(true) }}>
          Nova Quota Genie
        </button>
      </div>
      <div style={{ padding: '0 20px 8px', fontSize: 12, color: 'var(--text-muted)' }}>
        Limites nativos do Databricks (Unity AI Gateway) pro uso do Genie — aplicados pelo próprio Databricks,
        não pelo FinOps Manager. Exige a conexão padrão (Coleta Databricks) em modo OAuth M2M com Account Admin.
      </div>
      {budgetsQuery.data && budgetsQuery.data.account_total > budgetsQuery.data.genie_total && (
        <div style={{ padding: '0 20px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
          {budgetsQuery.data.account_total - budgetsQuery.data.genie_total} budget(s) da conta são de outros tipos (por exemplo, All resources) e não aparecem nesta lista Genie.
        </div>
      )}
      {nomesQuery.isError && (
        <div role="status" style={{ margin: '0 20px 12px', padding: '8px 12px', fontSize: 12, color: 'var(--orange,#ff8c42)', background: 'color-mix(in srgb, var(--orange,#ff8c42) 10%, transparent)' }}>
          Não foi possível consultar os nomes dos workspaces: {(nomesQuery.error as Error).message}.
        </div>
      )}
      {nomesQuery.isSuccess && idsSemNome.length > 0 && (
        <div role="status" style={{ margin: '0 20px 12px', padding: '8px 12px', fontSize: 12, color: 'var(--orange,#ff8c42)', background: 'color-mix(in srgb, var(--orange,#ff8c42) 10%, transparent)' }}>
          Nome não encontrado pela Account API para alguns workspaces. Os itens aparecem como “Nome indisponível”.
        </div>
      )}
      {genieBudgets.some((b) => b._demo) && (
        <div style={{
          margin: '0 20px 12px', padding: '8px 12px', fontSize: 12, borderRadius: 6,
          color: 'var(--orange,#ff8c42)',
          border: '1px solid color-mix(in srgb, var(--orange,#ff8c42) 40%, transparent)',
          background: 'color-mix(in srgb, var(--orange,#ff8c42) 10%, transparent)',
        }}>
          🧪 <strong>Modo demonstração</strong> — nenhuma conexão Databricks real (OAuth M2M) configurada.
          Estas são quotas fictícias, guardadas só no nosso banco, pra você testar criar/editar/excluir livremente.
          Assim que configurar uma conexão OAuth M2M em Coleta Databricks, esta tela passa a mostrar as quotas reais da conta.
        </div>
      )}
      {budgetsQuery.isError && (
        <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--red,#ff4d6a)' }}>
          {(budgetsQuery.error as Error).message}
        </div>
      )}
      {budgetsQuery.isSuccess && (
        <div className="table-wrapper">
          <table className="data-table">
            <thead><tr><th>Quota</th><th>Workspace</th><th>Consumo Genie no mês</th><th>Limite mensal</th><th>Níveis</th><th>Status de usuários</th><th>Ações</th></tr></thead>
            <tbody>
              {genieBudgets.map((b) => {
                const alertas = b.alert_configurations ?? []
                const niveisOrdenados = [...alertas].sort((a, b) => Number(a.quantity_threshold) - Number(b.quantity_threshold))
                const tetosPorEscopo = new Map<string, number>()
                for (const alerta of alertas) {
                  tetosPorEscopo.set(
                    alerta.scope_type,
                    Math.max(tetosPorEscopo.get(alerta.scope_type) ?? 0, Number(alerta.quantity_threshold) || 0),
                  )
                }
                const wsIds = b.filter?.workspace_id?.values?.map(String) ?? []
                const consumo = wsIds.length
                  ? wsIds.reduce((total, id) => total + (consumoPorWorkspace.get(id) ?? 0), 0)
                  : workspaces.reduce((total, ws) => total + ws.custo, 0)
                const dbus = wsIds.length
                  ? wsIds.reduce((total, id) => total + (dbusPorWorkspace.get(id) ?? 0), 0)
                  : workspaces.reduce((total, ws) => total + ws.dbus, 0)
                const bloqueioConfigurado = alertas.find((alerta) => alerta.action_configurations?.some((action) => action.action_type === 'BLOCK_USAGE'))
                const estadosGasto = b._spend_status?.alert_spend_statuses ?? []
                const estadoGasto = estadosGasto.find((estado) => !bloqueioConfigurado || estado.scope_type === bloqueioConfigurado.scope_type)
                  ?? estadosGasto[0]
                const escopoBarra = estadoGasto?.scope_type ?? bloqueioConfigurado?.scope_type ?? niveisOrdenados[0]?.scope_type
                const niveisEscopoBarra = niveisOrdenados.filter((alerta) => alerta.scope_type === escopoBarra)
                const pctDatabricks = estadoGasto?.percent_consumed == null ? null : Number(estadoGasto.percent_consumed)
                const pctNativoValido = pctDatabricks != null && Number.isFinite(pctDatabricks)
                const tetoNativo = Number(estadoGasto?.threshold) || 0
                const teto = tetoNativo || (escopoBarra ? tetosPorEscopo.get(escopoBarra) ?? 0 : 0)
                const temTetoConfigurado = estadoGasto?.threshold != null || alertas.some((alerta) => Number.isFinite(Number(alerta.quantity_threshold)))
                const percentualLocal = teto > 0 ? consumo / teto * 100 : 0
                const percentualConsumo = pctNativoValido ? pctDatabricks : percentualLocal
                const gastoNativo = estadoGasto?.spend == null ? null : Number(estadoGasto.spend)
                const gastoEstimado = pctNativoValido && gastoNativo == null && teto > 0
                  ? teto * percentualConsumo / 100 : null
                const consumoExibido = gastoNativo ?? gastoEstimado ?? consumo
                const gastoEstimadoNativo = gastoNativo == null && gastoEstimado != null
                const nivelAtingido = niveisEscopoBarra.filter((alerta) => {
                  const limiteNivel = Number(alerta.quantity_threshold)
                  return limiteNivel > 0 && percentualConsumo >= (teto > 0 ? limiteNivel / teto * 100 : 100)
                }).at(-1)
                const bloqueioZeroAtingido = niveisEscopoBarra.some((alerta) =>
                  Number(alerta.quantity_threshold) === 0
                  && alerta.action_configurations?.some((action) => action.action_type === 'BLOCK_USAGE'),
                ) && pctNativoValido && percentualConsumo >= 100
                const barraCor = bloqueioZeroAtingido || nivelAtingido?.action_configurations?.some((action) => action.action_type === 'BLOCK_USAGE')
                  ? 'var(--red,#ff4d6a)'
                  : nivelAtingido
                    ? 'var(--orange,#ff8c42)'
                    : 'var(--green,#22c55e)'
                const progressoPct = Math.min(percentualConsumo, 100)
                const temStatusUsuarios = alertas.some((alerta) => alerta.scope_type === 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER')
                  || alertas.some((alerta) => (alerta.principal_overrides?.length ?? 0) > 0)
                const usuariosQuota = calcularUsuariosQuotaGenie(b, porUsuario, principalsQuery.data ?? [])
                const defaultUsers = usuariosQuota.linhas.filter((user) => user.origem === 'padrao')
                const overrideUsers = usuariosQuota.linhas.filter((user) => user.origem === 'override')
                const defaultAtLimit = defaultUsers.filter((user) => user.status === 'Limite atingido').length
                const overrideAtLimit = overrideUsers.filter((user) => user.status === 'Limite atingido').length
                const alertasPorUsuario = alertas.filter((alerta) => alerta.scope_type === 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER')
                const limitePadraoUsuario = Math.max(0, ...alertasPorUsuario.map((alerta) => Number(alerta.quantity_threshold) || 0))
                const overrideIds = new Set(alertasPorUsuario.flatMap((alerta) =>
                  (alerta.principal_overrides || []).map((override) => String(override.principal_id)),
                ))
                const formatLimite = (limite: number) => limite.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                const statusUsuariosResumo = usuariosQuota.filtroPorTag
                  ? 'consumo não atribuível por tags'
                  : principalsQuery.isLoading
                    ? 'consultando…'
                    : principalsQuery.isError
                      ? 'indisponível'
                      : usuariosQuota.linhas.length === 0
                        ? 'sem billing local'
                        : `${usuariosQuota.naoResolvidos} override(s) não resolvido(s)`
                const statusUsuariosIndisponivel = usuariosQuota.filtroPorTag || usuariosQuota.linhas.length === 0
                  || principalsQuery.isLoading || principalsQuery.isError
                const resumoPadrao = usuariosQuota.filtroPorTag
                  ? `Padrão · limite-base US$ ${formatLimite(limitePadraoUsuario)}`
                  : `Padrão · ${statusUsuariosIndisponivel ? statusUsuariosResumo : `${defaultAtLimit} no limite (billing) / ${defaultUsers.length}`}`
                const resumoOverrides = usuariosQuota.filtroPorTag
                  ? `Overrides · ${overrideIds.size} limites individuais`
                  : `Overrides · ${statusUsuariosIndisponivel ? statusUsuariosResumo : `${overrideAtLimit} no limite (billing) / ${overrideUsers.length}`}`
                return (
                  <tr key={b.budget_configuration_id}>
                    <td>{b.display_name}</td>
                    <td>{wsIds.length ? wsIds.map((id) => <div key={id}>{nomePorWorkspace.get(id) || 'Nome indisponível'}</div>) : 'Toda a conta'}</td>
                    <td style={{ minWidth: 220 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
                        <strong style={{ color: barraCor, fontSize: 13 }}>
                          {pctNativoValido && gastoEstimadoNativo ? '~' : ''}US$ {consumoExibido.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          {teto > 0 || pctNativoValido ? ` · ${Math.round(percentualConsumo)}%` : ''}
                        </strong>
                        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{temTetoConfigurado ? `de US$ ${teto.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'sem limite'}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                        {pctNativoValido && percentualConsumo > 0 && dbus === 0
                          ? 'DBU não apurado na coleta local'
                          : `${dbus.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} DBU utilizados`}
                        {!pctNativoValido && consumo === 0 && dbus > 0 ? ' · uso sem custo registrado; barra financeira fica em 0%' : ''}
                        {pctNativoValido ? ` · ${Math.round(percentualConsumo)}% reportados pelo Databricks` : ''}
                      </div>
                      {pctNativoValido && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>Consumo informado pela Budgets API do Databricks.</div>
                      )}
                      {b._spend_status_error && <div style={{ fontSize: 10, color: 'var(--orange,#ff8c42)', marginBottom: 6 }}>{b._spend_status_error}; usando dados locais.</div>}
                      {!pctNativoValido && consumo === 0 && dbus === 0 && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>Sem consumo Genie registrado neste workspace no mês.</div>
                      )}
                      <div
                        role="progressbar"
                        aria-label={`Consumo de ${b.display_name}`}
                        aria-valuemin={0}
                        aria-valuemax={teto || 100}
                        aria-valuenow={pctNativoValido ? percentualConsumo : consumo}
                        aria-valuetext={`${Math.round(percentualConsumo)}% da quota consumida${teto > 0 ? `, limite US$ ${teto.toFixed(2)}` : ''}`}
                        style={{ height: 24, position: 'relative', borderRadius: 5, background: 'var(--border)', overflow: 'visible' }}
                      >
                        <div style={{ width: `${progressoPct}%`, height: '100%', borderRadius: 5, background: barraCor, transition: 'width .25s ease, background .25s ease' }} />
                        {teto > 0 && niveisEscopoBarra.map((alerta, index) => {
                          const posicao = Math.min(Number(alerta.quantity_threshold) / teto * 100, 100)
                          const bloqueia = alerta.action_configurations?.some((action) => action.action_type === 'BLOCK_USAGE')
                          const cor = bloqueia ? 'var(--red,#ff4d6a)' : 'var(--orange,#ff8c42)'
                          return <span key={`${alerta.quantity_threshold}-${index}`} title={`${Math.round(posicao)}%: US$ ${Number(alerta.quantity_threshold).toFixed(2)}${bloqueia ? ' · bloqueio' : ' · alerta'}`} style={{ position: 'absolute', left: `${posicao}%`, top: -4, width: 3, height: 32, borderRadius: 2, background: cor, boxShadow: '0 0 0 1px var(--bg-card)', transform: 'translateX(-1px)' }} />
                        })}
                      </div>
                      {consumo > teto && teto > 0 && <span style={{ display: 'block', color: 'var(--red,#ff4d6a)', fontSize: 10, marginTop: 4 }}>Limite excedido</span>}
                      {bloqueioZeroAtingido && <span style={{ display: 'block', color: 'var(--red,#ff4d6a)', fontSize: 10, marginTop: 4 }}>Bloqueio configurado em US$ 0</span>}
                    </td>
                    <td>
                      {alertas.length === 0 ? '—' : niveisOrdenados.map((alerta, index) => {
                        const tetoDoEscopo = tetosPorEscopo.get(alerta.scope_type) ?? 0
                        const percent = tetoDoEscopo > 0 ? Math.round(Number(alerta.quantity_threshold) / tetoDoEscopo * 100) : 0
                        const temBloqueio = alerta.action_configurations?.some((a) => a.action_type === 'BLOCK_USAGE')
                        return (
                          <div key={`${alerta.scope_type}-${alerta.quantity_threshold}-${index}`} style={{ display: 'grid', gridTemplateColumns: '160px 126px 92px', alignItems: 'center', gap: 8, marginBottom: 5, width: 'max-content' }}>
                            <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{percent}% · US$ {Number(alerta.quantity_threshold).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                            <span className="badge" style={{ width: '100%', boxSizing: 'border-box', justifyContent: 'center', fontSize: 9, whiteSpace: 'nowrap' }}>{alerta.scope_type === 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER' ? 'Padrão por usuário' : 'Compartilhado'}</span>
                            {temBloqueio
                              ? <span className="badge" style={{ width: '100%', boxSizing: 'border-box', justifyContent: 'center', background: 'var(--red,#ff4d6a)', color: '#fff', whiteSpace: 'nowrap' }}>🚫 Bloqueia</span>
                              : <span className="badge" style={{ width: '100%', boxSizing: 'border-box', justifyContent: 'center', background: 'var(--orange,#ff8c42)', color: '#fff', whiteSpace: 'nowrap' }}>✉ Alerta</span>}
                          </div>
                        )
                      })}
                    </td>
                    <td>
                      {temStatusUsuarios ? (
                        <div style={{ display: 'grid', gap: 5, minWidth: 170 }}>
                          <button className="btn-ghost" style={{ padding: '4px 7px', textAlign: 'left', fontSize: 10 }} onClick={() => { setUsuariosBudgetEscopo('padrao'); setUsuariosBudget(b) }}>
                            {resumoPadrao}
                          </button>
                          <button className="btn-ghost" style={{ padding: '4px 7px', textAlign: 'left', fontSize: 10 }} onClick={() => { setUsuariosBudgetEscopo('overrides'); setUsuariosBudget(b) }}>
                            {resumoOverrides}
                          </button>
                          {usuariosQuota.naoResolvidos > 0 && <span style={{ fontSize: 9, color: 'var(--orange,#ff8c42)' }}>{statusUsuariosResumo}</span>}
                        </div>
                      ) : '—'}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button className="btn-icon" title="Editar" onClick={() => handleEdit(b)}>
                          <svg viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3-8 8H3V10l8-8z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" /></svg>
                        </button>
                        <button className="btn-icon delete" title="Excluir" onClick={() => handleDelete(b)}>
                          <svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1-9" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {genieBudgets.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Nenhuma quota Genie cadastrada.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {modalOpen && <GenieBudgetModal
        budget={editingBudget}
        workspaces={workspaceOptions}
        workspacesLoading={nomesQuery.isPending || nomesQuery.isFetching}
        workspacesError={nomesQuery.isError ? (nomesQuery.error as Error).message : null}
        consumoLoading={consumoQuery.isPending || consumoQuery.isFetching}
        consumoError={consumoQuery.isError ? (consumoQuery.error as Error).message : null}
        onRetryWorkspaces={() => { void nomesQuery.refetch() }}
        onClose={handleClose}
      />}
      {usuariosBudget && resultadoUsuariosModal && <GenieBudgetUsersModal
        budget={usuariosBudget}
        escopo={usuariosBudgetEscopo}
        linhas={resultadoUsuariosModal.linhas}
        naoResolvidos={resultadoUsuariosModal.naoResolvidos}
        filtroPorTag={resultadoUsuariosModal.filtroPorTag}
        tagsAplicadas={resultadoUsuariosModal.tagsAplicadas}
        semBillingLocal={!resultadoUsuariosModal.linhas.length
          && !(tagsBudgetSelecionado.length > 0 && consumoTagsQuery.isPending)}
        carregandoPrincipals={principalsQuery.isLoading}
        erroPrincipals={principalsQuery.isError ? (principalsQuery.error as Error).message : null}
        carregandoConsumoTags={tagsBudgetSelecionado.length > 0 && consumoTagsQuery.isPending}
        erroConsumoTags={erroConsumoTags}
        salvandoOverride={updatePrincipalOverrideMutation.isPending}
        onUpdateOverride={(principalId, monthlyLimit, confirmarBloqueio) => updatePrincipalOverrideMutation.mutate({
          budgetId: usuariosBudget.budget_configuration_id,
          principalId,
          monthlyLimit,
          confirmarBloqueio,
        })}
        onClose={() => setUsuariosBudget(null)}
      />}
    </div>
  )
}
