import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { listSPs } from '../api/coleta'
import { listSubscriptions } from '../api/calculadora'
import {
  getAzureInventarioConfig, salvarAzureInventarioConfig, coletarAzureInventario, getAzureInventarioStatus,
  getAzureInventarioColetaHistorico, limparAzureInventarioColetaHistorico,
  getAzureRecursosInventario, getAzureAuditoriaEventos, getAzureCrescimento, getAzureInventarioComparativo,
  resolverAutoresInventario,
} from '../api/azureInventario'
import type { AzureAuditoriaAcao, AzureComparativoPeriodo } from '../types/azureInventario'
import CheckboxSearchList from '../components/CheckboxSearchList'
import AzureInventarioColetaMonitor from '../components/AzureInventarioColetaMonitor'
import RecursoDetalheModal from '../components/RecursoDetalheModal'

// Inventário + Auditoria de Recursos Azure (2026-08-30, pedido do usuário: "ontem tinha X
// recursos, hoje tenho X+1 — quem criou, quando, quanto custa"). Fonte: Azure Activity Log
// — ver seção "INVENTÁRIO + AUDITORIA DE RECURSOS AZURE" em server.js. Duas tabelas com
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

// Gráfico de crescimento — contagem diária de recursos distintos, mesmo padrão de barras
// SVG simples já usado em outras telas (sem lib de gráfico nova).
function GrowthChart({ dias }: { dias: { cost_date: string; recursos: number }[] }) {
  if (dias.length === 0) return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 20px 16px' }}>Sem dados no período.</div>
  const W = 640, H = 160, PAD_TOP = 24, PAD_BOTTOM = 26, PAD_SIDE = 10
  const plotH = H - PAD_TOP - PAD_BOTTOM
  const max = Math.max(1, ...dias.map((d) => d.recursos))
  const min = Math.min(...dias.map((d) => d.recursos))
  const slot = (W - PAD_SIDE * 2) / dias.length
  const barW = Math.max(3, slot * 0.6)
  const baseY = H - PAD_BOTTOM

  return (
    <div style={{ padding: '0 20px 16px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 180 }}>
        <line x1={PAD_SIDE} y1={baseY} x2={W - PAD_SIDE} y2={baseY} stroke="var(--border)" strokeWidth={1} />
        {dias.map((d, i) => {
          const x = PAD_SIDE + i * slot + (slot - barW) / 2
          const h = ((d.recursos - 0) / max) * plotH
          const y = baseY - h
          const cresceu = i > 0 && d.recursos > dias[i - 1].recursos
          return (
            <g key={d.cost_date}>
              <rect x={x} y={y} width={barW} height={Math.max(1, h)} rx={2} fill={cresceu ? 'var(--orange,#ff8c42)' : 'var(--accent)'}>
                <title>{new Date(d.cost_date).toLocaleDateString('pt-BR')}: {d.recursos} recurso(s){cresceu ? ' (cresceu vs. dia anterior)' : ''}</title>
              </rect>
            </g>
          )
        })}
      </svg>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        Mín: {min} · Máx: {max} recurso(s) no período. <span style={{ color: 'var(--orange,#ff8c42)' }}>Laranja</span> = cresceu em relação ao dia anterior.
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
  const [tab, setTab] = useState<'recursos' | 'auditoria' | 'comparativo' | 'config'>('recursos')
  const [periodo, setPeriodo] = useState(defaultPeriodo(30))
  const [filtroAtivo, setFiltroAtivo] = useState<'todos' | 'ativos' | 'excluidos'>('ativos')
  const [filtroCriadoPor, setFiltroCriadoPor] = useState('')
  const [filtroAcao, setFiltroAcao] = useState('')
  const [periodoA, setPeriodoA] = useState(defaultPeriodo(60))
  const [periodoB, setPeriodoB] = useState(defaultPeriodo(30))
  const [recursoDetalhe, setRecursoDetalhe] = useState<{ resourceId: string; subscriptionId: string } | null>(null)

  const configQuery = useQuery({ queryKey: ['azure-inv-config'], queryFn: getAzureInventarioConfig })
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
  const crescimentoQuery = useQuery({
    queryKey: ['azure-inv-crescimento', periodo.inicio, periodo.fim],
    queryFn: () => getAzureCrescimento(periodo.inicio, periodo.fim),
    placeholderData: keepPreviousData,
  })
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
    queryKey: ['azure-inv-auditoria', periodo.inicio, periodo.fim, filtroAcao],
    queryFn: () => getAzureAuditoriaEventos({ data_inicio: periodo.inicio, data_fim: periodo.fim, acao: filtroAcao || undefined }),
    placeholderData: keepPreviousData,
    enabled: tab === 'auditoria',
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

  return (
    <div className="view active">
      <div className="view-hero">
        <div className="page-title">Inventário</div>
        <div className="view-hero-sub">Inventário e auditoria de recursos Azure — quem criou, quando, e quanto custa</div>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '16px 20px 0' }}>
        <button className={tab === 'recursos' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('recursos')}>Recursos</button>
        <button className={tab === 'auditoria' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('auditoria')}>Auditoria</button>
        <button className={tab === 'comparativo' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('comparativo')}>Comparativo</button>
        <button className={tab === 'config' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('config')}>Configuração</button>
      </div>

      <AzureInventarioColetaMonitor />

      <div className="card" style={{ margin: '16px 20px 0' }}>
        <div className="card-header"><span className="card-title">Crescimento de Recursos</span></div>
        <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
          Contagem diária de recursos distintos com custo — vem direto da Coleta Azure já existente, funciona independente da Auditoria estar configurada.
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
        </div>
        <GrowthChart dias={crescimentoQuery.data?.dias || []} />
      </div>

      {tab === 'recursos' && (
        <div className="card" style={{ margin: '16px 20px' }}>
          <div className="card-header">
            <span className="card-title">Recursos (Inventário)</span>
            {recursosQuery.data && <span className="badge">{recursosQuery.data.total}{recursosQuery.data.total >= 500 ? '+' : ''}</span>}
          </div>
          <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
            Permanente — nunca é apagado pela retenção configurável (só o log de Auditoria é). Custo acumulado correlacionado com a Coleta Azure por resource_id.
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
                <thead><tr><th>Recurso</th><th>Tipo</th><th>RG</th><th>Criado por</th><th>Criado em</th><th>Status</th><th style={{ textAlign: 'right' }}>Custo acumulado</th></tr></thead>
                <tbody>
                  {recursosQuery.data.recursos.map((r) => (
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
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtBRL(r.custo_acumulado)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
          <div style={{ display: 'flex', gap: 8, padding: '0 20px 12px', flexWrap: 'wrap' }}>
            <select value={filtroAcao} onChange={(e) => setFiltroAcao(e.target.value)}>
              <option value="">Todas as ações</option>
              <option value="CRIACAO">Criação</option>
              <option value="ATUALIZACAO">Atualização</option>
              <option value="EXCLUSAO">Exclusão</option>
            </select>
          </div>
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

      {tab === 'config' && (
        <>
          <div className="card" style={{ margin: '16px 20px' }}>
            <div className="card-header">
              <span className="card-title">Configuração</span>
              <button className="btn-ghost" style={{ marginLeft: 'auto', fontSize: 11 }} disabled={resolverAutoresMutation.isPending} onClick={() => resolverAutoresMutation.mutate()} title="Resolve GUID de Criado por/Autor pro nome real via Microsoft Graph — exige Directory.Read.All concedida no Entra ID">
                {resolverAutoresMutation.isPending ? 'Resolvendo...' : '🪪 Resolver Nomes'}
              </button>
              <button className="btn-primary" disabled={coletarMutation.isPending || statusQuery.data?.em_execucao} onClick={() => coletarMutation.mutate()}>
                {statusQuery.data?.em_execucao ? 'Coletando...' : '▶ Coletar Agora'}
              </button>
            </div>
            <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
              Fonte: Azure Activity Log — usa a mesma credencial (Service Principal com role Reader) já configurada em Coleta Azure. Nenhuma permissão nova precisa ser concedida.
              "Criado por"/"Autor" traz um ID (GUID) do Activity Log — pra resolver pro nome real, clique em <strong>🪪 Resolver Nomes</strong> (roda automaticamente após cada coleta também), o que exige a permissão de aplicativo <strong>Directory.Read.All</strong> concedida a esta Service Principal no Entra ID (App registration → API permissions → Microsoft Graph).
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
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{h.origem === 'agendado' ? '⏰ Agendada' : '👤 Manual'}</td>
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
