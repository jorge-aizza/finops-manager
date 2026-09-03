import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { listSPs } from '../api/coleta'
import { listSubscriptions } from '../api/calculadora'
import {
  getAzureInventarioConfig, salvarAzureInventarioConfig, coletarAzureInventario, getAzureInventarioStatus,
  getAzureInventarioColetaHistorico, limparAzureInventarioColetaHistorico,
  getAzureRecursosInventario, getAzureAuditoriaEventos, getAzureInventarioComparativo,
  resolverAutoresInventario, getAzureResumoPorAssinatura, reconciliarAzureInventario,
  getAzureCrescimentoLiquido, baixarAzureInventarioExcel, getAzureAdvisor, getAzureRedeTopologia,
  getAzureSkuHistorico, getAzureRelatorioDiario,
} from '../api/azureInventario'
import type { AzureAuditoriaAcao, AzureComparativoPeriodo, AzureRedeVNet, AzureAdvisorCategoria } from '../types/azureInventario'
import CheckboxSearchList from '../components/CheckboxSearchList'
import AzureInventarioColetaMonitor from '../components/AzureInventarioColetaMonitor'
import RecursoDetalheModal from '../components/RecursoDetalheModal'

// Inventário + Auditoria de Recursos Azure (2026-08-30, pedido do usuário: "ontem tinha X
// recursos, hoje tenho X+1 — quem criou, quando, quanto custa"). Fonte: Azure Resource Graph
// Change Analysis (2026-09-03, "Inventário 2.0" — antes era Activity Log) — ver seção
// "INVENTÁRIO + AUDITORIA DE RECURSOS AZURE" em server.js. Duas tabelas com
// propósitos diferentes: Inventário (permanente, 1 linha por recurso) e Auditoria (log
// bruto de eventos, sujeito ao período de retenção configurável).

function fmtBRL(v: number): string {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtData(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function defaultPeriodo(diasAtras: number): { inicio: string; fim: string } {
  const fim = new Date()
  const ini = new Date(fim)
  ini.setDate(ini.getDate() - diasAtras)
  return { inicio: ini.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) }
}

const ACAO_BADGE: Record<AzureAuditoriaAcao, { color: string; bg: string; label: string }> = {
  CRIACAO: { color: 'var(--green,#22c55e)', bg: 'rgba(34,197,94,.10)', label: '✚ Criação' },
  ATUALIZACAO: { color: 'var(--blue,#4da6ff)', bg: 'rgba(77,166,255,.10)', label: '✎ Atualização' },
  EXCLUSAO: { color: 'var(--red,#ff4d6a)', bg: 'rgba(255,77,106,.10)', label: '✕ Exclusão' },
}

// Caixas "por Tipo de Recurso" na aba Auditoria (2026-08-31, pedido do usuário) — `resource_type`
// vem cru do Activity Log no formato ARM (`Microsoft.Compute/virtualMachines`); rótulos comuns
// traduzidos pra Português, qualquer outro cai num fallback que separa o último segmento
// (`virtualMachines` → `Virtual Machines`) em vez de mostrar a string ARM inteira.
const RESOURCE_TYPE_LABELS: Record<string, string> = {
  'microsoft.compute/virtualmachines': 'VM',
  'microsoft.compute/virtualmachinescalesets': 'VM Scale Set',
  'microsoft.compute/disks': 'Disco',
  'microsoft.compute/snapshots': 'Snapshot',
  'microsoft.compute/availabilitysets': 'Availability Set',
  'microsoft.network/networkinterfaces': 'Interface de Rede (NIC)',
  'microsoft.network/publicipaddresses': 'IP Público',
  'microsoft.network/virtualnetworks': 'Rede Virtual (VNet)',
  'microsoft.network/networksecuritygroups': 'Grupo de Segurança (NSG)',
  'microsoft.network/loadbalancers': 'Load Balancer',
  'microsoft.network/privateendpoints': 'Private Endpoint',
  'microsoft.network/bastionhosts': 'Bastion',
  'microsoft.storage/storageaccounts': 'Storage Account',
  'microsoft.databricks/workspaces': 'Databricks Workspace',
  'microsoft.sql/servers': 'SQL Server',
  'microsoft.sql/servers/databases': 'SQL Database',
  'microsoft.containerservice/managedclusters': 'AKS',
  'microsoft.web/sites': 'App Service',
  'microsoft.web/serverfarms': 'App Service Plan',
  'microsoft.keyvault/vaults': 'Key Vault',
  'microsoft.resources/deployments': 'Deployment (ARM)',
  'microsoft.insights/components': 'Application Insights',
  'microsoft.insights/actiongroups': 'Action Group',
  'microsoft.operationalinsights/workspaces': 'Log Analytics',
  'microsoft.operationsmanagement/solutions': 'Solução de Monitoramento',
  '(desconhecido)': 'Desconhecido',
}
// Sufixo `::databricks` (2026-09-01, pedido do usuário: "separar nos Card o que é VM, o que
// é Scale Set, o que é VM de Databricks") — marca uma VM/VM Scale Set que é nó de cluster
// Databricks (RG gerenciado, ver `_detectManagedRg` em server.js), nunca aparece num
// resource_type real do ARM (que só usa `/`). Tratado ANTES do lookup normal — o rótulo/ícone
// base continua vindo do mesmo mapa, só com o sufixo "(Databricks)"/ícone 🧱 acrescentado.
function resourceTypeLabel(raw: string): string {
  if (raw.endsWith('::databricks')) return resourceTypeLabel(raw.slice(0, -'::databricks'.length)) + ' (Databricks)'
  const conhecido = RESOURCE_TYPE_LABELS[raw.toLowerCase()]
  if (conhecido) return conhecido
  const ultimo = raw.split('/').pop() || raw
  return ultimo.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

// Ícone por tipo de recurso (2026-08-31, pedido do usuário: "ícones em destaque com o
// número") — usado nos badges da vista "Por Assinatura". Mesma normalização/fallback de
// `resourceTypeLabel` (chave em minúsculo); tipos fora do mapa caem no ícone genérico 📦.
const RESOURCE_TYPE_ICONS: Record<string, string> = {
  'microsoft.compute/virtualmachines': '🖥️',
  'microsoft.compute/virtualmachinescalesets': '🧩',
  'microsoft.compute/disks': '💾',
  'microsoft.compute/snapshots': '📸',
  'microsoft.network/networkinterfaces': '🔌',
  'microsoft.network/publicipaddresses': '🌐',
  'microsoft.network/virtualnetworks': '🕸️',
  'microsoft.network/networksecuritygroups': '🛡️',
  'microsoft.network/loadbalancers': '⚖️',
  'microsoft.network/privateendpoints': '🔒',
  'microsoft.network/bastionhosts': '🚪',
  'microsoft.storage/storageaccounts': '🗄️',
  'microsoft.databricks/workspaces': '🧱',
  'microsoft.sql/servers': '🛢️',
  'microsoft.sql/servers/databases': '🛢️',
  'microsoft.containerservice/managedclusters': '☸️',
  'microsoft.web/sites': '🌍',
  'microsoft.web/serverfarms': '🌍',
  'microsoft.keyvault/vaults': '🔑',
  'microsoft.resources/deployments': '📦',
  'microsoft.insights/components': '📈',
  'microsoft.insights/actiongroups': '📣',
  'microsoft.operationalinsights/workspaces': '📊',
  '(desconhecido)': '❔',
}
function resourceTypeIcon(raw: string): string {
  if (raw.endsWith('::databricks')) return '🧱'
  return RESOURCE_TYPE_ICONS[raw.toLowerCase()] || '📦'
}

// Gráfico de crescimento LÍQUIDO (2026-09-02, pedido do usuário: "a ideia é ver crescimento
// de recurso novos, que cresça e não morra") — linha (não barras) porque é um NÍVEL ao longo
// do tempo (quantos recursos ativos naquele dia), não magnitudes independentes por dia; eixo
// Y não começa em zero de propósito — o objetivo é mostrar a FORMA da tendência (sobe/desce/
// estável), não comparar magnitude absoluta. Dado já vem filtrado pelo backend (exclui
// Resource Groups gerenciados por Databricks/AKS — ver GET /crescimento-liquido).
function GrowthChart({ dias }: { dias: { dia: string; ativos: number }[] }) {
  if (dias.length === 0) return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 20px 16px' }}>Sem dados no período.</div>
  const W = 640, H = 160, PAD_TOP = 16, PAD_BOTTOM = 26, PAD_SIDE = 10
  const plotH = H - PAD_TOP - PAD_BOTTOM
  const valores = dias.map((d) => d.ativos)
  const max = Math.max(...valores)
  const min = Math.min(...valores)
  const folga = Math.max(1, Math.round((max - min) * 0.15))
  const yMax = max + folga
  const yMin = Math.max(0, min - folga)
  const yRange = Math.max(1, yMax - yMin)
  const slot = dias.length > 1 ? (W - PAD_SIDE * 2) / (dias.length - 1) : 0
  const baseY = H - PAD_BOTTOM
  const px = (i: number) => PAD_SIDE + i * slot
  const py = (v: number) => PAD_TOP + (1 - (v - yMin) / yRange) * plotH

  const pontos = dias.map((d, i) => `${px(i)},${py(d.ativos)}`).join(' ')
  const areaPontos = `${px(0)},${baseY} ${pontos} ${px(dias.length - 1)},${baseY}`
  const primeiro = dias[0].ativos
  const ultimo = dias[dias.length - 1].ativos
  const delta = ultimo - primeiro
  const corDelta = delta > 0 ? 'var(--green,#22c55e)' : delta < 0 ? 'var(--red,#ff4d6a)' : 'var(--text-muted)'

  return (
    <div style={{ padding: '0 20px 16px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 180 }}>
        <line x1={PAD_SIDE} y1={baseY} x2={W - PAD_SIDE} y2={baseY} stroke="var(--border)" strokeWidth={1} />
        <polygon points={areaPontos} fill="var(--accent)" opacity={0.12} />
        <polyline points={pontos} fill="none" stroke="var(--accent)" strokeWidth={2} />
        {dias.map((d, i) => (
          <circle key={d.dia} cx={px(i)} cy={py(d.ativos)} r={2.5} fill="var(--accent)">
            <title>{new Date(d.dia + 'T00:00:00').toLocaleDateString('pt-BR')}: {d.ativos.toLocaleString('pt-BR')} recurso(s) ativo(s)</title>
          </circle>
        ))}
      </svg>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {primeiro.toLocaleString('pt-BR')} → {ultimo.toLocaleString('pt-BR')} recursos no período (
        <strong style={{ color: corDelta }}>{delta > 0 ? '+' : ''}{delta.toLocaleString('pt-BR')}</strong>
        ). Exclui recursos de cluster efêmero (Databricks/AKS) — só o que nasce e permanece.
      </div>
    </div>
  )
}

// Azure Advisor — categorias e impacto (2026-09-02, inspirado no ARI, que integra com
// Advisor/Security Center). Valores confirmados na documentação oficial (learn.microsoft.com/
// rest/api/advisor/recommendations/list): category ∈ {Cost,Security,HighAvailability,
// Performance,OperationalExcellence}, impact ∈ {High,Medium,Low}.
const ADVISOR_CATEGORIA_INFO: Record<AzureAdvisorCategoria, { label: string; icon: string }> = {
  Cost: { label: 'Custo', icon: '💰' },
  Security: { label: 'Segurança', icon: '🔒' },
  HighAvailability: { label: 'Confiabilidade', icon: '🛡️' },
  Performance: { label: 'Performance', icon: '⚡' },
  OperationalExcellence: { label: 'Excelência Operacional', icon: '⚙️' },
}
const ADVISOR_IMPACTO_COR: Record<string, string> = {
  High: 'var(--red,#ff4d6a)', Medium: 'var(--orange,#ff8c42)', Low: 'var(--text-muted)',
}

// Diagrama de topologia de rede (2026-09-02, inspirado no ARI, que gera diagrama draw.io de
// VNets/peerings) — grid de cards em posição fixa calculada por índice (sem medir DOM via
// ref) + overlay SVG transparente desenhando as linhas de peering entre os centros dos cards,
// mesma técnica de "cards HTML + SVG por cima" já suficiente pros outros gráficos desta
// sessão, sem lib de diagrama nova.
function RedeTopologiaDiagrama({ vnets }: { vnets: AzureRedeVNet[] }) {
  if (vnets.length === 0) return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 20px 16px' }}>Nenhuma VNet encontrada nesta assinatura.</div>
  const CARD_W = 260, CARD_H = 190, GAP = 32
  const cols = Math.min(3, vnets.length)
  const rows = Math.ceil(vnets.length / cols)
  const totalW = cols * CARD_W + (cols - 1) * GAP
  const totalH = rows * CARD_H + (rows - 1) * GAP
  const pos = (i: number) => ({ x: (i % cols) * (CARD_W + GAP), y: Math.floor(i / cols) * (CARD_H + GAP) })
  const idToIndex = new Map(vnets.map((v, i) => [v.id.toUpperCase(), i]))

  // Linhas únicas (evita desenhar A→B e B→A duas vezes) — só entre VNets desta MESMA
  // assinatura; peerings pra outra assinatura (hub-spoke entre subscriptions, comum) não têm
  // um card pra apontar aqui, contados à parte na legenda.
  const linhas: { de: number; para: number; estado: string | null }[] = []
  const vistos = new Set<string>()
  let peeringsExternos = 0
  vnets.forEach((v, i) => {
    v.peerings.forEach((p) => {
      const j = idToIndex.get(p.vnet_remoto_id.toUpperCase())
      if (j == null) { peeringsExternos++; return }
      const chave = [i, j].sort().join('-')
      if (vistos.has(chave)) return
      vistos.add(chave)
      linhas.push({ de: i, para: j, estado: p.estado })
    })
  })

  return (
    <div style={{ padding: '0 20px 16px' }}>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ position: 'relative', width: totalW, height: totalH }}>
          <svg width={totalW} height={totalH} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {linhas.map((l, i) => {
              const a = pos(l.de), b = pos(l.para)
              const conectado = l.estado === 'Connected'
              return (
                <line
                  key={i} x1={a.x + CARD_W / 2} y1={a.y + CARD_H / 2} x2={b.x + CARD_W / 2} y2={b.y + CARD_H / 2}
                  stroke={conectado ? 'var(--accent)' : 'var(--red,#ff4d6a)'} strokeWidth={2}
                  strokeDasharray={conectado ? undefined : '5 4'} opacity={0.65}
                >
                  <title>{l.estado || 'Peering'}</title>
                </line>
              )
            })}
          </svg>
          {vnets.map((v, i) => {
            const p = pos(i)
            return (
              <div key={v.id} style={{
                position: 'absolute', left: p.x, top: p.y, width: CARD_W, height: CARD_H,
                border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg)',
                padding: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column',
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, wordBreak: 'break-word' }}>🕸️ {v.nome}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, wordBreak: 'break-word' }}>{v.resource_group}</div>
                <div style={{ fontSize: 10, color: 'var(--accent)', marginBottom: 6 }}>{v.address_space.join(', ') || '—'}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700 }}>Subnets ({v.subnets.length})</div>
                <div style={{ flex: 1, overflowY: 'auto', fontSize: 10 }}>
                  {v.subnets.map((s) => (
                    <div key={s.nome} style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.nome}>{s.nome}</span>
                      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{s.prefixo}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
        <span style={{ color: 'var(--accent)' }}>━</span> peering conectado &nbsp;&nbsp;
        <span style={{ color: 'var(--red,#ff4d6a)' }}>┄</span> peering não conectado
        {peeringsExternos > 0 && <> &nbsp;&nbsp;· {peeringsExternos} peering(s) pra fora desta assinatura (não desenhado)</>}
      </div>
    </div>
  )
}

// Uma linha do comparativo (ex: "Recursos ativos", "Custo total") — mostra os dois
// períodos lado a lado com um delta (▲/▼ colorido) entre eles.
function LinhaComparativo({ label, a, b, formato }: { label: string; a: number; b: number; formato: 'num' | 'brl' }) {
  const fmt = (v: number) => (formato === 'brl' ? fmtBRL(v) : v.toLocaleString('pt-BR'))
  const delta = b - a
  const deltaPct = a !== 0 ? (delta / a) * 100 : (b !== 0 ? 100 : 0)
  const cor = delta > 0 ? 'var(--green,#22c55e)' : delta < 0 ? 'var(--red,#ff4d6a)' : 'var(--text-muted)'
  const seta = delta > 0 ? '▲' : delta < 0 ? '▼' : '—'
  return (
    <tr>
      <td>{label}</td>
      <td style={{ textAlign: 'right' }}>{fmt(a)}</td>
      <td style={{ textAlign: 'right' }}>{fmt(b)}</td>
      <td style={{ textAlign: 'right', color: cor, fontWeight: 700 }}>
        {seta} {formato === 'brl' ? fmtBRL(Math.abs(delta)) : Math.abs(delta).toLocaleString('pt-BR')}
        {a !== 0 && <span style={{ fontWeight: 400, fontSize: 11 }}> ({deltaPct > 0 ? '+' : ''}{deltaPct.toFixed(1)}%)</span>}
      </td>
    </tr>
  )
}

export default function InventarioView() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'recursos' | 'porAssinatura' | 'auditoria' | 'comparativo' | 'advisor' | 'rede' | 'config'>('recursos')
  const [periodo, setPeriodo] = useState(defaultPeriodo(30))
  const [filtroAtivo, setFiltroAtivo] = useState<'todos' | 'ativos' | 'excluidos'>('ativos')
  const [filtroCriadoPor, setFiltroCriadoPor] = useState('')
  const [filtroAcao, setFiltroAcao] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [periodoA, setPeriodoA] = useState(defaultPeriodo(60))
  const [periodoB, setPeriodoB] = useState(defaultPeriodo(30))
  const [recursoDetalhe, setRecursoDetalhe] = useState<{ resourceId: string; subscriptionId: string } | null>(null)
  // Vista "Por Assinatura" (2026-08-31, pedido do usuário) — drill-down Assinatura → Resource
  // Group → Recurso. `paSub`/`paRg` null = ainda não desceu naquele nível.
  const [paSub, setPaSub] = useState<string | null>(null)
  const [paRg, setPaRg] = useState<string | null>(null)
  // Gráfico de Crescimento Líquido (2026-09-02) — período próprio, independente do usado
  // pela aba Auditoria (`periodo`).
  const [periodoCrescimento, setPeriodoCrescimento] = useState(defaultPeriodo(30))
  // Abas Advisor e Rede (2026-09-02, inspirado no ARI).
  const [advisorCategoria, setAdvisorCategoria] = useState<AzureAdvisorCategoria | ''>('')
  const [redeSub, setRedeSub] = useState<string | null>(null)

  const configQuery = useQuery({ queryKey: ['azure-inv-config'], queryFn: getAzureInventarioConfig })
  const crescimentoQuery = useQuery({
    queryKey: ['azure-inv-crescimento-liquido', periodoCrescimento.inicio, periodoCrescimento.fim],
    queryFn: () => getAzureCrescimentoLiquido(periodoCrescimento.inicio, periodoCrescimento.fim),
    placeholderData: keepPreviousData,
  })
  // Advisor pode levar bastante tempo na 1ª chamada (backend cacheia por 20min) — só busca
  // quando a aba está de fato aberta.
  const advisorQuery = useQuery({
    queryKey: ['azure-inv-advisor'],
    queryFn: () => getAzureAdvisor(),
    enabled: tab === 'advisor',
  })
  const redeQuery = useQuery({
    queryKey: ['azure-inv-rede-topologia', redeSub],
    queryFn: () => getAzureRedeTopologia(redeSub as string),
    enabled: tab === 'rede' && !!redeSub,
  })
  const statusQuery = useQuery({
    queryKey: ['azure-inv-status'],
    queryFn: getAzureInventarioStatus,
    refetchInterval: (q) => (q.state.data?.em_execucao ? 3000 : 20000),
  })
  const spsQuery = useQuery({ queryKey: ['coleta-sps'], queryFn: listSPs })
  // Mesma fonte já usada pelo seletor de Assinatura da Calculadora (azure_subs_cache) —
  // reaproveita nome + ID em vez de exigir que o admin decore/copie GUIDs de subscription.
  const subsQuery = useQuery({ queryKey: ['calc-subscriptions'], queryFn: listSubscriptions })
  const historicoQuery = useQuery({ queryKey: ['azure-inv-historico'], queryFn: getAzureInventarioColetaHistorico })
  const recursosQuery = useQuery({
    queryKey: ['azure-inv-recursos', filtroAtivo, filtroCriadoPor],
    queryFn: () => getAzureRecursosInventario({
      ativo: filtroAtivo === 'todos' ? undefined : filtroAtivo === 'ativos',
      criado_por: filtroCriadoPor || undefined,
    }),
    placeholderData: keepPreviousData,
    enabled: tab === 'recursos',
  })
  const auditoriaQuery = useQuery({
    queryKey: ['azure-inv-auditoria', periodo.inicio, periodo.fim, filtroAcao, filtroTipo],
    queryFn: () => getAzureAuditoriaEventos({ data_inicio: periodo.inicio, data_fim: periodo.fim, acao: filtroAcao || undefined, resource_type: filtroTipo || undefined }),
    placeholderData: keepPreviousData,
    enabled: tab === 'auditoria',
  })
  const skuHistoricoQuery = useQuery({
    queryKey: ['azure-inv-sku-historico', periodo.inicio, periodo.fim],
    queryFn: () => getAzureSkuHistorico({ data_inicio: periodo.inicio, data_fim: periodo.fim }),
    placeholderData: keepPreviousData,
    enabled: tab === 'auditoria',
  })
  const relatorioDiarioQuery = useQuery({
    queryKey: ['azure-inv-relatorio-diario'],
    queryFn: () => getAzureRelatorioDiario(),
    enabled: tab === 'auditoria',
  })
  const paNivel1Query = useQuery({
    queryKey: ['azure-inv-resumo-assinatura'],
    queryFn: () => getAzureResumoPorAssinatura(),
    enabled: tab === 'porAssinatura' && !paSub,
  })
  const paNivel2Query = useQuery({
    queryKey: ['azure-inv-resumo-rg', paSub],
    queryFn: () => getAzureResumoPorAssinatura(paSub || undefined),
    enabled: tab === 'porAssinatura' && !!paSub && !paRg,
  })
  const paRecursosQuery = useQuery({
    queryKey: ['azure-inv-pa-recursos', paSub, paRg],
    queryFn: () => getAzureRecursosInventario({ subscription_id: paSub || undefined, resource_group: paRg || undefined, ativo: true }),
    enabled: tab === 'porAssinatura' && !!paSub && !!paRg,
  })
  const comparativoQuery = useQuery({
    queryKey: ['azure-inv-comparativo', periodoA.inicio, periodoA.fim, periodoB.inicio, periodoB.fim],
    queryFn: () => getAzureInventarioComparativo({ a_inicio: periodoA.inicio, a_fim: periodoA.fim, b_inicio: periodoB.inicio, b_fim: periodoB.fim }),
    placeholderData: keepPreviousData,
    enabled: tab === 'comparativo',
  })
  const [ativo, setAtivo] = useState(false)
  const [retencaoDias, setRetencaoDias] = useState(180)
  const [spId, setSpId] = useState<number | null>(null)
  const [subsSelecionadas, setSubsSelecionadas] = useState<Set<string>>(new Set())
  const [formInicializado, setFormInicializado] = useState(false)
  if (configQuery.data && !formInicializado) {
    setAtivo(configQuery.data.ativo)
    setRetencaoDias(configQuery.data.retencao_dias)
    setSpId(configQuery.data.sp_id)
    setSubsSelecionadas(new Set((configQuery.data.subscription_ids || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)))
    setFormInicializado(true)
  }

  function toggleSub(id: string, checked: boolean) {
    setSubsSelecionadas((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }
  function toggleTodasSubs(checked: boolean) {
    setSubsSelecionadas(checked ? new Set((subsQuery.data || []).map((s) => s.subscription_id)) : new Set())
  }

  const salvarMutation = useMutation({
    mutationFn: () => salvarAzureInventarioConfig({
      ativo, retencao_dias: retencaoDias, sp_id: spId,
      subscription_ids: subsSelecionadas.size ? Array.from(subsSelecionadas).join(',') : null,
      tags_obrigatorias: configQuery.data?.tags_obrigatorias ?? null,
    }),
    onSuccess: () => {
      window.showToast?.('Configuração salva.', 'success')
      queryClient.invalidateQueries({ queryKey: ['azure-inv-config'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar: ' + e.message, 'error'),
  })

  const coletarMutation = useMutation({
    mutationFn: coletarAzureInventario,
    onSuccess: (r) => {
      window.showToast?.(r.message, 'success')
      queryClient.invalidateQueries({ queryKey: ['azure-inv-status'] })
    },
    onError: (e: Error) => window.showToast?.('Erro: ' + e.message, 'error'),
  })

  const limparHistoricoMutation = useMutation({
    mutationFn: limparAzureInventarioColetaHistorico,
    onSuccess: () => {
      window.showToast?.('Histórico limpo.', 'success')
      queryClient.invalidateQueries({ queryKey: ['azure-inv-historico'] })
    },
  })

  const resolverAutoresMutation = useMutation({
    mutationFn: resolverAutoresInventario,
    onSuccess: (r) => {
      window.showToast?.(r.resolvidos > 0 ? `${r.resolvidos} nome(s) resolvido(s).` : 'Nenhum nome novo pra resolver.', 'success')
      queryClient.invalidateQueries({ queryKey: ['azure-inv-recursos'] })
      queryClient.invalidateQueries({ queryKey: ['azure-inv-auditoria'] })
    },
    onError: (e: Error) => window.showToast?.('Erro ao resolver nomes: ' + e.message, 'error'),
  })

  const reconciliarMutation = useMutation({
    mutationFn: reconciliarAzureInventario,
    onSuccess: (r) => {
      window.showToast?.(r.message, 'success')
      queryClient.invalidateQueries({ queryKey: ['azure-inv-status'] })
    },
    onError: (e: Error) => window.showToast?.('Erro: ' + e.message, 'error'),
  })

  // Exportar Inventário pra Excel (2026-09-02, inspirado no ARI) — download direto, não
  // retorna dado pra cachear/exibir, só o efeito colateral do arquivo baixado.
  const exportarExcelMutation = useMutation({
    mutationFn: () => baixarAzureInventarioExcel({ ativo: filtroAtivo === 'todos' ? undefined : filtroAtivo === 'ativos' }),
    onSuccess: () => window.showToast?.('Inventário exportado.', 'success'),
    onError: (e: Error) => window.showToast?.('Erro ao exportar: ' + e.message, 'error'),
  })

  return (
    <div className="view active">
      <div className="view-hero">
        <div className="page-title">Inventário</div>
        <div className="view-hero-sub">Inventário e auditoria de recursos Azure — quem criou, quando, e quanto custa</div>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '16px 20px 0' }}>
        <button className={tab === 'recursos' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('recursos')}>Recursos</button>
        <button className={tab === 'porAssinatura' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('porAssinatura')}>Por Assinatura</button>
        <button className={tab === 'auditoria' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('auditoria')}>Auditoria</button>
        <button className={tab === 'comparativo' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('comparativo')}>Comparativo</button>
        <button className={tab === 'advisor' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('advisor')}>Advisor</button>
        <button className={tab === 'rede' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('rede')}>Rede</button>
        <button className={tab === 'config' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('config')}>Configuração</button>
      </div>

      <AzureInventarioColetaMonitor />

      <div className="card" style={{ margin: '16px 20px 0' }}>
        <div className="card-header"><span className="card-title">Crescimento Líquido de Recursos</span></div>
        <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
          Quantos recursos estavam ativos em cada dia — exclui recursos de cluster efêmero (Databricks/AKS), que nascem e morrem em horas e escondem o crescimento real.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: '0 20px 12px', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>De</label>
            <input type="date" value={periodoCrescimento.inicio} onChange={(e) => setPeriodoCrescimento((p) => ({ ...p, inicio: e.target.value }))} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Até</label>
            <input type="date" value={periodoCrescimento.fim} onChange={(e) => setPeriodoCrescimento((p) => ({ ...p, fim: e.target.value }))} />
          </div>
        </div>
        <GrowthChart dias={crescimentoQuery.data?.dias || []} />
      </div>

      {tab === 'recursos' && (
        <div className="card" style={{ margin: '16px 20px' }}>
          <div className="card-header">
            <span className="card-title">Recursos (Inventário)</span>
            {recursosQuery.data && <span className="badge">{recursosQuery.data.total}{recursosQuery.data.total >= 500 ? '+' : ''}</span>}
            <button
              className="btn-ghost" style={{ marginLeft: 'auto', fontSize: 11 }}
              disabled={exportarExcelMutation.isPending}
              onClick={() => exportarExcelMutation.mutate()}
              title="Exporta todos os recursos que batem com o filtro atual (Ativos/Excluídos/Todos) pra .xlsx"
            >
              {exportarExcelMutation.isPending ? 'Exportando...' : '📊 Exportar Excel'}
            </button>
          </div>
          <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
            Permanente — nunca é apagado pela retenção configurável (só o log de Auditoria é). Custo correlacionado com a Coleta Azure por resource_id — quando o recurso individual nunca teve billing próprio (comum pra VMs/discos/NICs efêmeros de cluster Databricks), mostra o custo <span style={{ color: 'var(--orange,#ff8c42)' }}>~aproximado do Resource Group inteiro</span> em vez de zero.
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '0 20px 12px', flexWrap: 'wrap' }}>
            <select value={filtroAtivo} onChange={(e) => setFiltroAtivo(e.target.value as typeof filtroAtivo)}>
              <option value="ativos">Ativos</option>
              <option value="excluidos">Excluídos</option>
              <option value="todos">Todos</option>
            </select>
            <input placeholder="Filtrar por quem criou" value={filtroCriadoPor} onChange={(e) => setFiltroCriadoPor(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          </div>
          {recursosQuery.data && recursosQuery.data.total === 0 && (
            <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
              Nenhum recurso encontrado. Configure e ative a coleta na aba <strong>Configuração</strong> — sem isso, o inventário nunca é populado.
            </div>
          )}
          {recursosQuery.data && recursosQuery.data.total > 0 && (
            <div className="table-wrapper">
              <table className="data-table">
                <thead><tr><th>Recurso</th><th>Tipo</th><th>RG</th><th>Criado por</th><th>Criado em</th><th>Status</th><th style={{ textAlign: 'right' }}>Custo</th></tr></thead>
                <tbody>
                  {recursosQuery.data.recursos.map((r) => {
                    const usaFallbackRg = r.custo_acumulado === 0 && r.custo_resource_group > 0
                    return (
                    <tr key={r.id} style={{ cursor: 'pointer' }} title="Clique para ver detalhes e a linha do tempo" onClick={() => setRecursoDetalhe({ resourceId: r.resource_id, subscriptionId: r.subscription_id })}>
                      <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--accent)' }} title={r.resource_id}>{r.nome || r.resource_id}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.resource_type || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.resource_group || '—'}</td>
                      <td style={{ fontSize: 12 }} title={r.criado_por || ''}>{r.criado_por_nome || r.criado_por || 'desconhecido'}</td>
                      <td style={{ fontSize: 12 }}>{fmtData(r.criado_em)}</td>
                      <td>
                        {r.ativo
                          ? <span style={{ color: 'var(--green,#22c55e)', fontSize: 11 }}>● Ativo</span>
                          : <span style={{ color: 'var(--text-muted)', fontSize: 11 }} title={r.excluido_por ? `Excluído por ${r.excluido_por_nome || r.excluido_por} em ${fmtData(r.excluido_em)}` : ''}>○ Excluído</span>}
                      </td>
                      <td
                        style={{ textAlign: 'right', fontWeight: 700, color: usaFallbackRg ? 'var(--orange,#ff8c42)' : undefined }}
                        title={usaFallbackRg ? `Custo direto deste recurso é zero (comum pra recursos efêmeros de cluster) — mostrando o custo total do Resource Group "${r.resource_group}" no lugar` : ''}
                      >
                        {usaFallbackRg ? '~' : ''}{fmtBRL(usaFallbackRg ? r.custo_resource_group : r.custo_acumulado)}
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'porAssinatura' && (
        <div className="card" style={{ margin: '16px 20px' }}>
          <div className="card-header"><span className="card-title">Por Assinatura</span></div>
          <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
            Navegue de Assinatura → Resource Group → Recurso. Só recursos ativos.
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '0 20px 14px', fontSize: 12, flexWrap: 'wrap' }}>
            <span
              onClick={() => { setPaSub(null); setPaRg(null) }}
              style={{ cursor: paSub ? 'pointer' : 'default', color: paSub ? 'var(--accent)' : 'var(--text)', fontWeight: paSub ? 400 : 700 }}
            >
              📁 Assinaturas
            </span>
            {paSub && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>›</span>
                <span
                  onClick={() => setPaRg(null)}
                  style={{ cursor: paRg ? 'pointer' : 'default', color: paRg ? 'var(--accent)' : 'var(--text)', fontWeight: paRg ? 400 : 700 }}
                >
                  {subsQuery.data?.find((s) => s.subscription_id === paSub)?.subscription_name || paSub}
                </span>
              </>
            )}
            {paRg && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>›</span>
                <span style={{ fontWeight: 700, wordBreak: 'break-word' }}>{paRg}</span>
              </>
            )}
          </div>

          {!paSub && (
            <>
              {paNivel1Query.isLoading && <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}
              {paNivel1Query.data && paNivel1Query.data.itens.length === 0 && (
                <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>Nenhum recurso ativo no inventário ainda.</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, padding: '0 20px 20px' }}>
                {paNivel1Query.data?.itens.map((it) => {
                  const nome = subsQuery.data?.find((s) => s.subscription_id === it.subscription_id)?.subscription_name || it.subscription_id
                  return (
                    <div
                      key={it.subscription_id}
                      onClick={() => setPaSub(it.subscription_id || null)}
                      style={{ cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: 4, wordBreak: 'break-word' }}>{nome}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>{it.total} recurso{it.total !== 1 ? 's' : ''} ativo{it.total !== 1 ? 's' : ''}</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {it.por_tipo.slice(0, 4).map((t) => (
                          <span key={t.tipo} title={resourceTypeLabel(t.tipo)} style={{ fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 8px' }}>
                            {resourceTypeIcon(t.tipo)} {t.total}
                          </span>
                        ))}
                        {it.por_tipo.length > 4 && <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>+{it.por_tipo.length - 4}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {paSub && !paRg && (
            <>
              {paNivel2Query.isLoading && <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}
              {paNivel2Query.data && paNivel2Query.data.itens.length === 0 && (
                <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>Nenhum recurso ativo nesta assinatura.</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, padding: '0 20px 20px' }}>
                {paNivel2Query.data?.itens.map((it) => (
                  <div
                    key={it.resource_group}
                    onClick={() => setPaRg(it.resource_group || null)}
                    style={{ cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4, wordBreak: 'break-word' }}>{it.resource_group}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>{it.total} recurso{it.total !== 1 ? 's' : ''}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {it.por_tipo.slice(0, 4).map((t) => (
                        <span key={t.tipo} title={resourceTypeLabel(t.tipo)} style={{ fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 8px' }}>
                          {resourceTypeIcon(t.tipo)} {t.total}
                        </span>
                      ))}
                      {it.por_tipo.length > 4 && <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>+{it.por_tipo.length - 4}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {paSub && paRg && (
            <>
              {paRecursosQuery.isLoading && <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}
              {paRecursosQuery.data && paRecursosQuery.data.total === 0 && (
                <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>Nenhum recurso ativo neste Resource Group.</div>
              )}
              {paRecursosQuery.data && paRecursosQuery.data.total > 0 && (
                <div className="table-wrapper">
                  <table className="data-table">
                    <thead><tr><th>Recurso</th><th>Tipo</th><th>Criado por</th><th>Criado em</th><th style={{ textAlign: 'right' }}>Custo</th></tr></thead>
                    <tbody>
                      {paRecursosQuery.data.recursos.map((r) => {
                        const usaFallbackRg = r.custo_acumulado === 0 && r.custo_resource_group > 0
                        return (
                          <tr key={r.id} style={{ cursor: 'pointer' }} title="Clique para ver detalhes e a linha do tempo" onClick={() => setRecursoDetalhe({ resourceId: r.resource_id, subscriptionId: r.subscription_id })}>
                            <td style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--accent)' }} title={r.resource_id}>{r.nome || r.resource_id}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{resourceTypeIcon(r.resource_type || '(desconhecido)')} {r.resource_type ? resourceTypeLabel(r.resource_type) : '—'}</td>
                            <td style={{ fontSize: 12 }} title={r.criado_por || ''}>{r.criado_por_nome || r.criado_por || 'desconhecido'}</td>
                            <td style={{ fontSize: 12 }}>{fmtData(r.criado_em)}</td>
                            <td
                              style={{ textAlign: 'right', fontWeight: 700, color: usaFallbackRg ? 'var(--orange,#ff8c42)' : undefined }}
                              title={usaFallbackRg ? `Custo direto deste recurso é zero — mostrando o custo total do Resource Group no lugar` : ''}
                            >
                              {usaFallbackRg ? '~' : ''}{fmtBRL(usaFallbackRg ? r.custo_resource_group : r.custo_acumulado)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'auditoria' && (
        <div className="card" style={{ margin: '16px 20px' }}>
          <div className="card-header"><span className="card-title">Comparativo Diário</span></div>
          <div style={{ padding: '0 20px 16px', fontSize: 11, color: 'var(--text-muted)' }}>
            Recalculado a cada abertura da tela (não depende de e-mail configurado) — mesmo cálculo do
            relatório diário enviado por e-mail quando o SMTP está ativo. Exclui Resource Groups
            gerenciados por Databricks/AKS (clusters efêmeros).
          </div>
          {relatorioDiarioQuery.isLoading && <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}
          {relatorioDiarioQuery.data && (
            <div style={{ padding: '0 20px 16px' }}>
              <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="stat-card">
                  <div className="stat-label">Novos ontem ({new Date(relatorioDiarioQuery.data.dia + 'T00:00:00Z').toLocaleDateString('pt-BR', { timeZone: 'UTC' })})</div>
                  <div className="stat-value" style={{ color: 'var(--green,#22c55e)' }}>{relatorioDiarioQuery.data.criados}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Atualizados</div>
                  <div className="stat-value" style={{ color: 'var(--blue,#4da6ff)' }}>{relatorioDiarioQuery.data.atualizados}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Excluídos</div>
                  <div className="stat-value" style={{ color: 'var(--red,#ff4d6a)' }}>{relatorioDiarioQuery.data.excluidos}</div>
                </div>
              </div>
              <div style={{ fontSize: 12, marginTop: 12 }}>
                Comparado ao dia anterior ({relatorioDiarioQuery.data.criados_dia_anterior} novo(s)):{' '}
                {relatorioDiarioQuery.data.delta === 0 ? (
                  <strong>igual</strong>
                ) : relatorioDiarioQuery.data.delta > 0 ? (
                  <strong style={{ color: 'var(--green,#22c55e)' }}>▲ {relatorioDiarioQuery.data.delta} a mais</strong>
                ) : (
                  <strong style={{ color: 'var(--red,#ff4d6a)' }}>▼ {Math.abs(relatorioDiarioQuery.data.delta)} a menos</strong>
                )}
              </div>
              {relatorioDiarioQuery.data.top_resource_groups.length > 0 && (
                <div style={{ fontSize: 12, marginTop: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Resource Groups com mais criações ontem:</div>
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {relatorioDiarioQuery.data.top_resource_groups.map((rg) => (
                      <li key={rg.resource_group}>{rg.resource_group} — {rg.criacoes} recurso(s)</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'auditoria' && (
        <div className="card" style={{ margin: '16px 20px' }}>
          <div className="card-header">
            <span className="card-title">Auditoria (Log de Eventos)</span>
            {auditoriaQuery.data && <span className="badge">{auditoriaQuery.data.total}{auditoriaQuery.data.total >= 300 ? '+' : ''}</span>}
          </div>
          <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
            Log bruto de toda criação/atualização/exclusão detectada — sujeito ao período de retenção configurado (padrão {configQuery.data?.retencao_dias ?? 180} dias).
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', padding: '0 20px 12px', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>De</label>
              <input type="date" value={periodo.inicio} onChange={(e) => setPeriodo((p) => ({ ...p, inicio: e.target.value }))} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Até</label>
              <input type="date" value={periodo.fim} onChange={(e) => setPeriodo((p) => ({ ...p, fim: e.target.value }))} />
            </div>
            <select value={filtroAcao} onChange={(e) => setFiltroAcao(e.target.value)}>
              <option value="">Todas as ações</option>
              <option value="CRIACAO">Criação</option>
              <option value="ATUALIZACAO">Atualização</option>
              <option value="EXCLUSAO">Exclusão</option>
            </select>
            {filtroTipo && (
              <span
                onClick={() => setFiltroTipo('')}
                title="Limpar filtro de tipo"
                style={{ cursor: 'pointer', alignSelf: 'center', fontSize: 12, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 20, padding: '4px 10px' }}
              >
                Tipo: {resourceTypeLabel(filtroTipo)} ✕
              </span>
            )}
          </div>
          {auditoriaQuery.data && auditoriaQuery.data.por_tipo.length > 0 && (
            <div style={{ display: 'flex', gap: 8, padding: '0 20px 16px', flexWrap: 'wrap' }}>
              {auditoriaQuery.data.por_tipo.map((t) => {
                const ativo = filtroTipo === t.tipo
                return (
                  <button
                    key={t.tipo}
                    onClick={() => setFiltroTipo(ativo ? '' : t.tipo)}
                    title={t.tipo}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 88,
                      padding: '8px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                      border: `1px solid ${ativo ? 'var(--accent)' : 'var(--border)'}`,
                      background: ativo ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
                    }}
                  >
                    <span style={{ fontSize: 18, fontWeight: 700, color: ativo ? 'var(--accent)' : 'var(--text)' }}>{t.total}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{resourceTypeLabel(t.tipo)}</span>
                  </button>
                )
              })}
            </div>
          )}
          {auditoriaQuery.data && auditoriaQuery.data.total === 0 && (
            <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>Nenhum evento no período selecionado.</div>
          )}
          {auditoriaQuery.data && auditoriaQuery.data.total > 0 && (
            <div className="table-wrapper">
              <table className="data-table">
                <thead><tr><th>Quando</th><th>Ação</th><th>Recurso</th><th>Tipo</th><th>Autor</th><th>Operação</th></tr></thead>
                <tbody>
                  {auditoriaQuery.data.eventos.map((ev) => {
                    const b = ACAO_BADGE[ev.acao]
                    return (
                      <tr key={ev.id} style={{ cursor: 'pointer' }} title="Clique para ver detalhes e a linha do tempo" onClick={() => setRecursoDetalhe({ resourceId: ev.resource_id, subscriptionId: ev.subscription_id })}>
                        <td style={{ fontSize: 12 }}>{fmtData(ev.quando)}</td>
                        <td><span style={{ background: b.bg, color: b.color, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600 }}>{b.label}</span></td>
                        <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--accent)' }} title={ev.resource_id}>{ev.nome || ev.resource_id.split('/').pop()}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ev.resource_type || '—'}</td>
                        <td style={{ fontSize: 12 }} title={ev.autor || ''}>{ev.autor_nome || ev.autor || 'desconhecido'}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{ev.operation_name || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'auditoria' && (
        <div className="card" style={{ margin: '16px 20px' }}>
          <div className="card-header">
            <span className="card-title">Mudanças de SKU de VM</span>
            {skuHistoricoQuery.data && <span className="badge">{skuHistoricoQuery.data.total}</span>}
          </div>
          <div style={{ padding: '0 20px 16px', fontSize: 11, color: 'var(--text-muted)' }}>
            Quando o tamanho (SKU) de uma VM muda — ex: resize de <code>Standard_D2s_v3</code> pra{' '}
            <code>Standard_D4s_v3</code>. Detectado comparando o valor atual (Resource Graph) contra a
            última leitura conhecida, a cada coleta — só pra VMs fora de Resource Groups gerenciados por
            Databricks/AKS (lá a máquina é recriada em horas, não "muda de tamanho"). Usa o mesmo período
            De/Até da Auditoria acima.
          </div>
          {skuHistoricoQuery.data && skuHistoricoQuery.data.total === 0 && (
            <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>Nenhuma mudança de SKU no período selecionado.</div>
          )}
          {skuHistoricoQuery.data && skuHistoricoQuery.data.total > 0 && (
            <div className="table-wrapper">
              <table className="data-table">
                <thead><tr><th>Detectado em</th><th>VM</th><th>RG</th><th>SKU anterior</th><th></th><th>SKU novo</th><th>Autor da mudança</th></tr></thead>
                <tbody>
                  {skuHistoricoQuery.data.mudancas.map((m) => (
                    <tr key={m.id} style={{ cursor: 'pointer' }} title="Clique para ver detalhes e a linha do tempo" onClick={() => setRecursoDetalhe({ resourceId: m.resource_id, subscriptionId: m.subscription_id })}>
                      <td style={{ fontSize: 12 }}>{fmtData(m.detectado_em)}</td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--accent)' }} title={m.resource_id}>{m.nome || m.resource_id.split('/').pop()}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.resource_group || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--red,#ff4d6a)' }}>{m.sku_anterior || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>→</td>
                      <td style={{ fontSize: 12, color: 'var(--green,#22c55e)', fontWeight: 600 }}>{m.sku_novo || '—'}</td>
                      <td style={{ fontSize: 12 }} title={m.evento_autor || ''}>{m.evento_autor_nome || m.evento_autor || 'desconhecido'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'comparativo' && (
        <div className="card" style={{ margin: '16px 20px' }}>
          <div className="card-header"><span className="card-title">Comparativo entre Períodos</span></div>
          <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
            "Recursos ativos" é uma fotografia de quantos recursos existiam no FIM de cada período (não uma soma) — os demais números são eventos que aconteceram DENTRO de cada período.
          </div>
          <div style={{ display: 'flex', gap: 24, padding: '0 20px 16px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Período A — de</label>
                <input type="date" value={periodoA.inicio} onChange={(e) => setPeriodoA((p) => ({ ...p, inicio: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>até</label>
                <input type="date" value={periodoA.fim} onChange={(e) => setPeriodoA((p) => ({ ...p, fim: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Período B — de</label>
                <input type="date" value={periodoB.inicio} onChange={(e) => setPeriodoB((p) => ({ ...p, inicio: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>até</label>
                <input type="date" value={periodoB.fim} onChange={(e) => setPeriodoB((p) => ({ ...p, fim: e.target.value }))} />
              </div>
            </div>
          </div>

          {comparativoQuery.isLoading && <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}

          {comparativoQuery.data && (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th></th>
                    <th style={{ textAlign: 'right' }}>Período A ({periodoA.inicio} → {periodoA.fim})</th>
                    <th style={{ textAlign: 'right' }}>Período B ({periodoB.inicio} → {periodoB.fim})</th>
                    <th style={{ textAlign: 'right' }}>Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  <LinhaComparativo label="Recursos ativos (no fim do período)" a={(comparativoQuery.data.periodo_a as AzureComparativoPeriodo).total_recursos} b={(comparativoQuery.data.periodo_b as AzureComparativoPeriodo).total_recursos} formato="num" />
                  <LinhaComparativo label="Custo total" a={comparativoQuery.data.periodo_a.custo_total} b={comparativoQuery.data.periodo_b.custo_total} formato="brl" />
                  <LinhaComparativo label="Recursos criados" a={comparativoQuery.data.periodo_a.criados} b={comparativoQuery.data.periodo_b.criados} formato="num" />
                  <LinhaComparativo label="Recursos atualizados" a={comparativoQuery.data.periodo_a.atualizados} b={comparativoQuery.data.periodo_b.atualizados} formato="num" />
                  <LinhaComparativo label="Recursos excluídos" a={comparativoQuery.data.periodo_a.excluidos} b={comparativoQuery.data.periodo_b.excluidos} formato="num" />
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'advisor' && (
        <div className="card" style={{ margin: '16px 20px' }}>
          <div className="card-header">
            <span className="card-title">Azure Advisor — Recomendações</span>
            {advisorQuery.data && <span className="badge">{advisorQuery.data.total}</span>}
          </div>
          <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
            Recomendações de custo, segurança, confiabilidade, performance e excelência operacional — direto da Azure (mesma credencial Reader já usada pela coleta). Cacheado 20 min no servidor.
          </div>
          {advisorQuery.isLoading && (
            <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>Buscando recomendações na Azure (pode levar até 1 minuto na primeira vez)...</div>
          )}
          {advisorQuery.data && advisorQuery.data.erros.length > 0 && (
            <div style={{ padding: '0 20px 12px', fontSize: 11, color: 'var(--red,#ff4d6a)' }}>
              {advisorQuery.data.erros.map((e) => <div key={e.subscription_id}>⚠ {e.subscription_id}: {e.erro}</div>)}
            </div>
          )}
          {advisorQuery.data && (
            <>
              <div style={{ display: 'flex', gap: 8, padding: '0 20px 16px', flexWrap: 'wrap' }}>
                {(Object.keys(ADVISOR_CATEGORIA_INFO) as AzureAdvisorCategoria[]).map((cat) => {
                  const info = ADVISOR_CATEGORIA_INFO[cat]
                  const total = advisorQuery.data!.por_categoria[cat] || 0
                  const ativo = advisorCategoria === cat
                  return (
                    <button
                      key={cat}
                      onClick={() => setAdvisorCategoria(ativo ? '' : cat)}
                      style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, minWidth: 120,
                        padding: '8px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                        border: `1px solid ${ativo ? 'var(--accent)' : 'var(--border)'}`,
                        background: ativo ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
                      }}
                    >
                      <span style={{ fontSize: 18, fontWeight: 700, color: ativo ? 'var(--accent)' : 'var(--text)' }}>{total}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{info.icon} {info.label}</span>
                    </button>
                  )
                })}
              </div>
              {(() => {
                const filtrados = advisorCategoria ? advisorQuery.data!.itens.filter((i) => i.categoria === advisorCategoria) : advisorQuery.data!.itens
                const visiveis = filtrados.slice(0, 300)
                return (
                  <>
                    {filtrados.length === 0 && (
                      <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>Nenhuma recomendação{advisorCategoria ? ' nesta categoria' : ''}.</div>
                    )}
                    {filtrados.length > 0 && (
                      <div className="table-wrapper">
                        <table className="data-table">
                          <thead><tr><th>Impacto</th><th>Categoria</th><th>Recurso</th><th>Problema</th><th>Benefício</th></tr></thead>
                          <tbody>
                            {visiveis.map((item) => (
                              <tr
                                key={item.id}
                                style={{ cursor: item.resource_id ? 'pointer' : 'default' }}
                                title={item.resource_id ? 'Clique pra ver detalhes do recurso no Inventário' : ''}
                                onClick={() => item.resource_id && setRecursoDetalhe({ resourceId: item.resource_id, subscriptionId: item.subscription_id })}
                              >
                                <td><span style={{ color: ADVISOR_IMPACTO_COR[item.impacto || ''] || 'var(--text-muted)', fontWeight: 700, fontSize: 11 }}>{item.impacto || '—'}</span></td>
                                <td style={{ fontSize: 12 }}>{item.categoria ? `${ADVISOR_CATEGORIA_INFO[item.categoria].icon} ${ADVISOR_CATEGORIA_INFO[item.categoria].label}` : '—'}</td>
                                <td style={{ fontSize: 12, color: 'var(--accent)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.recurso || ''}>{item.recurso || '—'}</td>
                                <td style={{ fontSize: 12 }}>{item.problema || '—'}</td>
                                <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.beneficio_potencial || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {filtrados.length > 300 && (
                          <div style={{ padding: '10px 20px', fontSize: 11, color: 'var(--text-muted)' }}>Mostrando as primeiras 300 de {filtrados.length.toLocaleString('pt-BR')}.</div>
                        )}
                      </div>
                    )}
                  </>
                )
              })()}
            </>
          )}
        </div>
      )}

      {tab === 'rede' && (
        <div className="card" style={{ margin: '16px 20px' }}>
          <div className="card-header"><span className="card-title">Topologia de Rede</span></div>
          <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
            VNets, subnets e peerings ao vivo via Resource Graph — mesma credencial Reader já usada pela coleta.
          </div>
          <div style={{ padding: '0 20px 16px' }}>
            <select value={redeSub || ''} onChange={(e) => setRedeSub(e.target.value || null)}>
              <option value="">Selecione uma assinatura...</option>
              {subsQuery.data?.map((s) => <option key={s.subscription_id} value={s.subscription_id}>{s.subscription_name}</option>)}
            </select>
          </div>
          {!redeSub && <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>Selecione uma assinatura pra ver o diagrama.</div>}
          {redeSub && redeQuery.isLoading && <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>}
          {redeSub && redeQuery.isError && <div style={{ padding: '0 20px 20px', fontSize: 12, color: 'var(--red,#ff4d6a)' }}>Erro ao buscar a topologia.</div>}
          {redeSub && redeQuery.data && <RedeTopologiaDiagrama vnets={redeQuery.data.vnets} />}
        </div>
      )}

      {tab === 'config' && (
        <>
          <div className="card" style={{ margin: '16px 20px' }}>
            <div className="card-header">
              <span className="card-title">Configuração</span>
              <button className="btn-ghost" style={{ marginLeft: 'auto', fontSize: 11 }} disabled={resolverAutoresMutation.isPending} onClick={() => resolverAutoresMutation.mutate()} title="Resolve GUID de Criado por/Autor pro nome real via Microsoft Graph — exige Directory.Read.All concedida no Entra ID">
                {resolverAutoresMutation.isPending ? 'Resolvendo...' : '🪪 Resolver Nomes'}
              </button>
              <button className="btn-ghost" style={{ fontSize: 11 }} disabled={reconciliarMutation.isPending || statusQuery.data?.em_execucao} onClick={() => reconciliarMutation.mutate()} title="Lista TODOS os recursos que existem agora via Azure Resource Graph e completa o Inventário com os que o Activity Log nunca capturou (recursos antigos, criados antes da ativação do Inventário, que nunca mais foram tocados)">
                {reconciliarMutation.isPending ? 'Reconciliando...' : '🔎 Reconciliar (Resource Graph)'}
              </button>
              <button className="btn-primary" disabled={coletarMutation.isPending || statusQuery.data?.em_execucao} onClick={() => coletarMutation.mutate()}>
                {statusQuery.data?.em_execucao ? 'Coletando...' : '▶ Coletar Agora'}
              </button>
            </div>
            <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
              Fonte: Azure Resource Graph Change Analysis — usa a mesma credencial (Service Principal com role Reader) já configurada em Coleta Azure. Nenhuma permissão nova precisa ser concedida.
              "Criado por"/"Autor" já vem como e-mail na maioria dos casos; quando vem como ID (GUID — comum pra Service Principals), clique em <strong>🪪 Resolver Nomes</strong> (roda automaticamente após cada coleta também), o que exige a permissão de aplicativo <strong>Directory.Read.All</strong> concedida a esta Service Principal no Entra ID (App registration → API permissions → Microsoft Graph).
              A Change Analysis só aprende sobre um recurso quando há uma mudança depois da ativação do Inventário — recursos antigos nunca tocados desde então ficam de fora, mesmo ativos. Clique em <strong>🔎 Reconciliar</strong> pra completar com tudo que existe agora (sem "criado por/em", já que o Resource Graph não tem esse histórico).
            </div>
            <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 560 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} style={{ width: 'auto', flexShrink: 0 }} />
                Ativar coleta automática de Inventário/Auditoria
              </label>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Service Principal</label>
                <select value={spId ?? ''} onChange={(e) => setSpId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Selecione...</option>
                  {(spsQuery.data || []).map((sp) => <option key={sp.id} value={sp.id}>{sp.nome}</option>)}
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Subscriptions (vazio = usa as mesmas do Service Principal)</label>
                <CheckboxSearchList
                  items={(subsQuery.data || []).map((s) => ({ id: s.subscription_id, label: s.subscription_name || s.subscription_id, sublabel: s.subscription_name ? s.subscription_id : undefined }))}
                  selected={subsSelecionadas}
                  onToggle={toggleSub}
                  onSelectAll={toggleTodasSubs}
                  loading={subsQuery.isLoading}
                  emptyText="Nenhuma assinatura encontrada — importe/colete custos Azure primeiro."
                  searchPlaceholder="Buscar assinatura..."
                />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label>Retenção do log de Auditoria (dias)</label>
                <input type="number" min={1} value={retencaoDias} onChange={(e) => setRetencaoDias(Number(e.target.value) || 180)} style={{ maxWidth: 120 }} />
              </div>
              <button className="btn-primary" style={{ alignSelf: 'flex-start' }} disabled={salvarMutation.isPending} onClick={() => salvarMutation.mutate()}>
                {salvarMutation.isPending ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>

          <div className="card" style={{ margin: '16px 20px' }}>
            <div className="card-header">
              <span className="card-title">Histórico de Execuções</span>
              <button className="btn-ghost" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={() => { if (confirm('Limpar todo o histórico de execuções?')) limparHistoricoMutation.mutate() }}>Limpar</button>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead><tr><th>Início</th><th>Origem</th><th>Status</th><th style={{ textAlign: 'right' }}>Eventos</th><th style={{ textAlign: 'right' }}>Novos</th><th style={{ textAlign: 'right' }}>Atualizados</th><th style={{ textAlign: 'right' }}>Excluídos</th><th>Mensagem</th></tr></thead>
                <tbody>
                  {(historicoQuery.data || []).length === 0 && <tr><td colSpan={8} className="empty-state">Nenhuma execução ainda</td></tr>}
                  {(historicoQuery.data || []).map((h) => (
                    <tr key={h.id}>
                      <td style={{ fontSize: 12 }}>{fmtData(h.iniciado_em)}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {h.origem?.startsWith('reconciliacao') ? '🔎 Reconciliação' : h.origem === 'agendado' ? '⏰ Agendada' : '👤 Manual'}
                      </td>
                      <td>
                        <span style={{ color: h.status === 'concluido' ? 'var(--green,#22c55e)' : h.status === 'erro' ? 'var(--red,#ff4d6a)' : 'var(--orange,#ff8c42)', fontSize: 11, fontWeight: 600 }}>
                          {h.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{h.eventos_processados}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{h.recursos_novos}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{h.recursos_atualizados}</td>
                      <td style={{ textAlign: 'right', fontSize: 12 }}>{h.recursos_excluidos}</td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={h.mensagem || ''}>{h.mensagem || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {recursoDetalhe && (
        <RecursoDetalheModal
          resourceId={recursoDetalhe.resourceId}
          subscriptionId={recursoDetalhe.subscriptionId}
          onClose={() => setRecursoDetalhe(null)}
        />
      )}

    </div>
  )
}
