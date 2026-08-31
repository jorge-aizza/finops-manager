import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { listSPs } from '../api/coleta'
import {
  getAzureInventarioConfig, salvarAzureInventarioConfig, coletarAzureInventario, getAzureInventarioStatus,
  getAzureInventarioColetaHistorico, limparAzureInventarioColetaHistorico,
  getAzureRecursosInventario, getAzureAuditoriaEventos, getAzureCrescimento,
} from '../api/azureInventario'
import type { AzureAuditoriaAcao } from '../types/azureInventario'

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

export default function InventarioView() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'recursos' | 'auditoria' | 'config'>('recursos')
  const [periodo, setPeriodo] = useState(defaultPeriodo(30))
  const [filtroAtivo, setFiltroAtivo] = useState<'todos' | 'ativos' | 'excluidos'>('ativos')
  const [filtroCriadoPor, setFiltroCriadoPor] = useState('')
  const [filtroAcao, setFiltroAcao] = useState('')

  const configQuery = useQuery({ queryKey: ['azure-inv-config'], queryFn: getAzureInventarioConfig })
  const statusQuery = useQuery({
    queryKey: ['azure-inv-status'],
    queryFn: getAzureInventarioStatus,
    refetchInterval: (q) => (q.state.data?.em_execucao ? 3000 : 20000),
  })
  const spsQuery = useQuery({ queryKey: ['coleta-sps'], queryFn: listSPs })
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

  const [ativo, setAtivo] = useState(false)
  const [retencaoDias, setRetencaoDias] = useState(180)
  const [spId, setSpId] = useState<number | null>(null)
  const [subscriptionIds, setSubscriptionIds] = useState('')
  const [formInicializado, setFormInicializado] = useState(false)
  if (configQuery.data && !formInicializado) {
    setAtivo(configQuery.data.ativo)
    setRetencaoDias(configQuery.data.retencao_dias)
    setSpId(configQuery.data.sp_id)
    setSubscriptionIds(configQuery.data.subscription_ids || '')
    setFormInicializado(true)
  }

  const salvarMutation = useMutation({
    mutationFn: () => salvarAzureInventarioConfig({ ativo, retencao_dias: retencaoDias, sp_id: spId, subscription_ids: subscriptionIds || null }),
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

  const progresso = statusQuery.data?.progresso

  return (
    <div className="view active">
      <div className="view-hero">
        <div className="page-title">Inventário</div>
        <div className="view-hero-sub">Inventário e auditoria de recursos Azure — quem criou, quando, e quanto custa</div>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '16px 20px 0' }}>
        <button className={tab === 'recursos' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('recursos')}>Recursos</button>
        <button className={tab === 'auditoria' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('auditoria')}>Auditoria</button>
        <button className={tab === 'config' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('config')}>Configuração</button>
      </div>

      {statusQuery.data?.em_execucao && progresso && (
        <div className="card" style={{ margin: '16px 20px 0', borderColor: 'var(--accent)' }}>
          <div style={{ padding: '12px 20px', fontSize: 12, color: 'var(--text-muted)' }}>
            🔄 Coletando... {progresso.fase} — {progresso.eventos} evento(s) processado(s) ({progresso.novos} novo(s), {progresso.atualizados} atualizado(s), {progresso.excluidos} excluído(s))
          </div>
        </div>
      )}

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
                    <tr key={r.id}>
                      <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.resource_id}>{r.nome || r.resource_id}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.resource_type || '—'}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.resource_group || '—'}</td>
                      <td style={{ fontSize: 12 }} title={r.criado_por || ''}>{r.criado_por || 'desconhecido'}</td>
                      <td style={{ fontSize: 12 }}>{fmtData(r.criado_em)}</td>
                      <td>
                        {r.ativo
                          ? <span style={{ color: 'var(--green,#22c55e)', fontSize: 11 }}>● Ativo</span>
                          : <span style={{ color: 'var(--text-muted)', fontSize: 11 }} title={r.excluido_por ? `Excluído por ${r.excluido_por} em ${fmtData(r.excluido_em)}` : ''}>○ Excluído</span>}
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
                <thead><tr><th>Quando</th><th>Ação</th><th>Recurso</th><th>Autor</th><th>Operação</th></tr></thead>
                <tbody>
                  {auditoriaQuery.data.eventos.map((ev) => {
                    const b = ACAO_BADGE[ev.acao]
                    return (
                      <tr key={ev.id}>
                        <td style={{ fontSize: 12 }}>{fmtData(ev.quando)}</td>
                        <td><span style={{ background: b.bg, color: b.color, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600 }}>{b.label}</span></td>
                        <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }} title={ev.resource_id}>{ev.resource_id.split('/').pop()}</td>
                        <td style={{ fontSize: 12 }} title={ev.autor || ''}>{ev.autor || 'desconhecido'}</td>
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

      {tab === 'config' && (
        <>
          <div className="card" style={{ margin: '16px 20px' }}>
            <div className="card-header">
              <span className="card-title">Configuração</span>
              <button className="btn-primary" style={{ marginLeft: 'auto' }} disabled={coletarMutation.isPending || statusQuery.data?.em_execucao} onClick={() => coletarMutation.mutate()}>
                {statusQuery.data?.em_execucao ? 'Coletando...' : '▶ Coletar Agora'}
              </button>
            </div>
            <div style={{ padding: '0 20px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
              Fonte: Azure Activity Log — usa a mesma credencial (Service Principal com role Reader) já configurada em Coleta Azure. Nenhuma permissão nova precisa ser concedida.
            </div>
            <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}>
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
                <textarea rows={2} value={subscriptionIds} onChange={(e) => setSubscriptionIds(e.target.value)} placeholder="uma por linha ou separadas por vírgula" />
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
    </div>
  )
}
