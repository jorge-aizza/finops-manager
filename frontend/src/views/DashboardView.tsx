import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listAcoes } from '../api/acoes'
import { listEstimativas } from '../api/estimativas'
import { setDashboardTabListener } from '../bridge'
import { cloudIconOrFallback } from '../config/cloudIcons'
import type { Acao } from '../types/acao'
import type { EstimativaResumo } from '../types/estimativa'
import AcaoModal from './AcaoModal'

function formatCurrency(v: number | null | undefined): string {
  if (v === null || v === undefined || isNaN(v)) return '—'
  if (v === 0) return 'R$ 0'
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function formatDate(d: string | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('pt-BR')
}

// Ação atrasada: em andamento/planejada, com prazo definido e já vencido.
// Concluídas/canceladas nunca "atrasam" — elas só somem da lista, não migram
// pra atrasadas.
function isAtrasada(a: Acao): boolean {
  if (a.status !== 'Em Andamento' && a.status !== 'Planejado') return false
  if (!a.data_conclusao) return false
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  return new Date(a.data_conclusao) < hoje
}

const STATUS_CLASS: Record<string, string> = {
  Planejado: 'status-planejado', 'Em Andamento': 'status-andamento', Concluído: 'status-concluido', Cancelado: 'status-cancelado',
}

export default function DashboardView() {
  const [tab, setTab] = useState<'acoes' | 'estimativas'>('acoes')
  useEffect(() => setDashboardTabListener((t) => setTab(t === 'estimativas' ? 'estimativas' : 'acoes')), [])

  const acoesQuery = useQuery({ queryKey: ['acoes'], queryFn: () => listAcoes() })
  const estimativasQuery = useQuery({ queryKey: ['estimativas'], queryFn: listEstimativas })

  // Filtro de cloud é estado local do componente — ao contrário do legado
  // (_activeCloud era um global de módulo que nunca resetava, permanecendo
  // "preso" entre navegações e fazendo ações sumirem silenciosamente do
  // dashboard), aqui ele reseta sozinho sempre que a view é desmontada.
  const [activeCloud, setActiveCloud] = useState<string | null>(null)
  const [cloudClickAt, setCloudClickAt] = useState(0)
  const [detalheAcao, setDetalheAcao] = useState<Acao | null>(null)

  function handleCloudClick(cloud: string | null) {
    const now = Date.now()
    if (cloud && activeCloud === cloud && now - cloudClickAt < 400) {
      setActiveCloud(null)
    } else {
      setActiveCloud(cloud)
    }
    setCloudClickAt(now)
  }

  const acoes = acoesQuery.data || []
  const estimativas = estimativasQuery.data || []

  const acoesCloud = useMemo(
    () => (activeCloud ? acoes.filter((a) => (a.cloud || 'Sem Cloud') === activeCloud) : acoes),
    [acoes, activeCloud],
  )

  const hoje = useMemo(() => { const h = new Date(); h.setHours(0, 0, 0, 0); return h }, [])

  const atrasadas = useMemo(
    () => acoesCloud
      .filter((a) => a.data_conclusao && a.status !== 'Concluído' && a.status !== 'Cancelado' && new Date(a.data_conclusao) < hoje)
      .sort((a, b) => new Date(a.data_conclusao!).getTime() - new Date(b.data_conclusao!).getTime()),
    [acoesCloud, hoje],
  )

  const acoesRecentes = useMemo(
    () => acoesCloud.filter((a) => ['Em Andamento', 'Planejado', 'Concluído'].includes(a.status) && !isAtrasada(a)),
    [acoesCloud],
  )

  const stats = useMemo(() => ({
    total: acoesCloud.length,
    andamento: acoesCloud.filter((a) => a.status === 'Em Andamento').length,
    concluidas: acoesCloud.filter((a) => a.status === 'Concluído').length,
    atrasadas: atrasadas.length,
    retornoConcluido: acoesCloud.filter((a) => a.status === 'Concluído').reduce((s, a) => s + (a.retorno_ano_atual || 0), 0),
    retornoAndamento: acoesCloud.filter((a) => a.status === 'Em Andamento').reduce((s, a) => s + (a.retorno_ano_atual || 0), 0),
    retornoPlanejado: acoesCloud.filter((a) => a.status === 'Planejado').reduce((s, a) => s + (a.retorno_ano_atual || 0), 0),
    retornoProx: acoesCloud.reduce((s, a) => s + (a.retorno_proximo_ano || 0), 0),
  }), [acoesCloud, atrasadas])

  const cloudBreakdown = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of acoes) {
      const cloud = a.cloud || 'Sem Cloud'
      counts.set(cloud, (counts.get(cloud) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [acoes])

  function groupByProjeto(lista: EstimativaResumo[]): [string, number][] {
    const m = new Map<string, number>()
    for (const e of lista) {
      const k = e.projeto_nome || 'Sem Projeto'
      m.set(k, (m.get(k) || 0) + (e.total_final || 0))
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }

  const estAprov = estimativas.filter((e) => e.status === 'Aprovado')
  const estNaoAprov = estimativas.filter((e) => e.status === 'Nao Aprovado')
  const estPend = estimativas.filter((e) => e.status === 'Pendente')
  const somaAprov = estAprov.reduce((s, e) => s + (e.total_final || 0), 0)
  const somaNaoAprov = estNaoAprov.reduce((s, e) => s + (e.total_final || 0), 0)
  const somaPend = estPend.reduce((s, e) => s + (e.total_final || 0), 0)

  function renderAcaoRow(a: Acao, atrasadaRow: boolean) {
    const dias = atrasadaRow && a.data_conclusao ? Math.floor((hoje.getTime() - new Date(a.data_conclusao).getTime()) / 86400000) : 0
    return (
      <tr key={a.id} data-cloud={a.cloud || ''}>
        <td><span className="finops-id">{a.id_finops}</span></td>
        <td><strong>{a.acao}</strong></td>
        <td>{a.responsavel || '—'}</td>
        <td>{a.projeto_nome || '—'}</td>
        <td><span className="cloud-tag">{a.cloud || '—'}</span></td>
        {atrasadaRow ? (
          <>
            <td>
              <span className={'status-badge ' + (STATUS_CLASS[a.status] || '')}>{a.status}</span>
              {isAtrasada(a) && <span className="status-badge status-atrasado">⚠ Atrasado</span>}
            </td>
            <td style={{ color: 'var(--danger,#f38ba8)' }}>{formatDate(a.data_conclusao)}</td>
            <td><span className="atrasado-days">+{dias} dia{dias !== 1 ? 's' : ''} em aberto</span></td>
          </>
        ) : (
          <>
            <td><span className={'status-badge ' + (STATUS_CLASS[a.status] || '')}>{a.status}</span></td>
            <td style={{ color: 'var(--text-muted)' }}>{a.data_conclusao ? formatDate(a.data_conclusao) : '—'}</td>
          </>
        )}
        <td>
          <button className="btn-icon" title="Ver detalhes" onClick={() => setDetalheAcao(a)}>
            <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth={1.5} /><path d="M8 7v4M8 5.5v.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
          </button>
        </td>
      </tr>
    )
  }

  return (
    <div>
      {tab === 'acoes' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button className="btn-export" onClick={() => window.exportarExcel?.()}>
              <svg viewBox="0 0 16 16" fill="none" width={14} height={14}><path d="M2 12v2h12v-2M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></svg>
              Exportar Excel
            </button>
          </div>

          <div className="stats-grid">
            <div className="stat-card accent">
              <div className="stat-label">Total de Ações</div>
              <div className="stat-value">{acoesQuery.isLoading ? '—' : stats.total}</div>
              <div className="stat-sub">cadastradas</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Em Andamento</div>
              <div className="stat-value">{acoesQuery.isLoading ? '—' : stats.andamento}</div>
              <div className="stat-sub">ações ativas</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Concluídas</div>
              <div className="stat-value">{acoesQuery.isLoading ? '—' : stats.concluidas}</div>
              <div className="stat-sub">este ano</div>
            </div>
            <div className="stat-card danger">
              <div className="stat-label">⚠ Atrasadas</div>
              <div className="stat-value">{acoesQuery.isLoading ? '—' : stats.atrasadas}</div>
              <div className="stat-sub">prazo vencido</div>
            </div>
            <div className="stat-card green-card">
              <div className="stat-label">Retorno Concluído</div>
              <div className="stat-value green">{acoesQuery.isLoading ? '—' : formatCurrency(stats.retornoConcluido)}</div>
              <div className="stat-sub">ano atual · concluídas</div>
            </div>
            <div className="stat-card yellow-card">
              <div className="stat-label">Retorno Em Andamento</div>
              <div className="stat-value yellow">{acoesQuery.isLoading ? '—' : formatCurrency(stats.retornoAndamento)}</div>
              <div className="stat-sub">ano atual · em andamento</div>
            </div>
            <div className="stat-card blue-card">
              <div className="stat-label">Retorno Planejado</div>
              <div className="stat-value blue">{acoesQuery.isLoading ? '—' : formatCurrency(stats.retornoPlanejado)}</div>
              <div className="stat-sub">ano atual · planejadas</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Retorno Próximo Ano</div>
              <div className="stat-value green">{acoesQuery.isLoading ? '—' : formatCurrency(stats.retornoProx)}</div>
              <div className="stat-sub">total projetado</div>
            </div>
          </div>

          <div className="cloud-stats-strip">
            {cloudBreakdown.length > 0 && (
              <>
                <div
                  className={'cloud-stat-card all-card' + (!activeCloud ? ' active' : '')}
                  onClick={() => handleCloudClick(null)}
                  title="Mostrar todas as ações"
                >
                  <div style={{ fontSize: 20 }}>🌐</div>
                  <div className="cloud-stat-info">
                    <div className="cloud-stat-name">Todos</div>
                    <div className="cloud-stat-count">{acoes.length}</div>
                  </div>
                </div>
                {cloudBreakdown.map(([cloud, count]) => {
                  const pct = Math.round((count / (acoes.length || 1)) * 100)
                  return (
                    <div
                      key={cloud}
                      className={'cloud-stat-card' + (activeCloud === cloud ? ' active' : '')}
                      onClick={() => handleCloudClick(cloud)}
                      title="1 clique: filtrar ações | 2 cliques: limpar filtro"
                      data-cloud={cloud}
                    >
                      <div className="cloud-stat-icon" dangerouslySetInnerHTML={{ __html: cloudIconOrFallback(cloud) }} />
                      <div className="cloud-stat-info">
                        <div className="cloud-stat-name">{cloud}</div>
                        <div className="cloud-stat-count">{count} <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-muted,#6c7086)' }}>ações</span></div>
                        <div className="cloud-stat-bar"><div className="cloud-stat-bar-fill" style={{ width: pct + '%' }} /></div>
                        <div className="cloud-stat-pct">{pct}%</div>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>

          <div className="dashboard-grid">
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <div className="card-header">
                <span className="card-title">
                  <svg viewBox="0 0 20 20" fill="none" width={16} height={16} style={{ verticalAlign: -3, marginRight: 4 }}><path d="M9 5H7a2 2 0 00-2 2v8a2 2 0 002 2h6a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h0a2 2 0 002-2M9 5a2 2 0 012-2h0a2 2 0 012 2" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
                  Ações Recentes
                </span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="legend-chip legend-andamento">Em Andamento</span>
                  <span className="legend-chip legend-planejado">Planejado</span>
                  <span className="legend-chip legend-concluido">Concluído</span>
                  <span className="badge">{acoesRecentes.length}</span>
                </div>
              </div>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr><th>ID FinOps</th><th>Ação</th><th>Responsável</th><th>Projeto</th><th>Cloud</th><th>Status</th><th>Data Conclusão</th><th></th></tr>
                  </thead>
                  <tbody>
                    {acoesQuery.isLoading && <tr><td colSpan={8} className="empty-state">Carregando...</td></tr>}
                    {!acoesQuery.isLoading && acoesRecentes.length === 0 && (
                      <tr><td colSpan={8} className="empty-state">Nenhuma ação em andamento, planejada ou concluída</td></tr>
                    )}
                    {acoesRecentes.map((a) => renderAcaoRow(a, false))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card card-atrasadas">
            <div className="card-header">
              <span className="card-title" style={{ color: 'var(--danger,#f38ba8)' }}>
                <svg viewBox="0 0 20 20" fill="none" width={16} height={16} style={{ verticalAlign: -3, marginRight: 4 }}><circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth={1.5} /><path d="M10 6v4.5l2.5 2.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></svg>
                Ações com Prazo Vencido
              </span>
              <span className="badge badge-danger">{atrasadas.length}</span>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr><th>ID FinOps</th><th>Ação</th><th>Responsável</th><th>Projeto</th><th>Cloud</th><th>Status</th><th>Data Conclusão</th><th>Dias em Aberto</th><th></th></tr>
                </thead>
                <tbody>
                  {acoesQuery.isLoading && <tr><td colSpan={9} className="empty-state">Carregando...</td></tr>}
                  {!acoesQuery.isLoading && atrasadas.length === 0 && (
                    <tr><td colSpan={9} className="empty-state">✅ Nenhuma ação com prazo vencido</td></tr>
                  )}
                  {atrasadas.map((a) => renderAcaoRow(a, true))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'estimativas' && (
        <>
          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)', marginBottom: 16 }}>
            <div className="stat-card green-card">
              <div className="stat-label">
                <svg viewBox="0 0 14 14" fill="none" width={12} height={12} style={{ verticalAlign: -1, marginRight: 4 }}><path d="M2 7l3 3 7-6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></svg>
                Aprovadas
              </div>
              <div className="stat-value green">{estimativasQuery.isLoading ? '—' : formatCurrency(somaAprov)}</div>
              <div className="stat-sub">{estAprov.length} estimativa{estAprov.length !== 1 ? 's' : ''}</div>
            </div>
            <div className="stat-card danger">
              <div className="stat-label">
                <svg viewBox="0 0 14 14" fill="none" width={12} height={12} style={{ verticalAlign: -1, marginRight: 4 }}><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" /></svg>
                Não Aprovadas
              </div>
              <div className="stat-value" style={{ color: 'var(--red)' }}>{estimativasQuery.isLoading ? '—' : formatCurrency(somaNaoAprov)}</div>
              <div className="stat-sub">{estNaoAprov.length} estimativa{estNaoAprov.length !== 1 ? 's' : ''}</div>
            </div>
            <div className="stat-card yellow-card">
              <div className="stat-label">
                <svg viewBox="0 0 14 14" fill="none" width={12} height={12} style={{ verticalAlign: -1, marginRight: 4 }}><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth={1.5} /><path d="M7 4.5V7l1.5 1.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
                Pendentes
              </div>
              <div className="stat-value yellow">{estimativasQuery.isLoading ? '—' : formatCurrency(somaPend)}</div>
              <div className="stat-sub">{estPend.length} estimativa{estPend.length !== 1 ? 's' : ''}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">
                <svg viewBox="0 0 16 16" fill="none" width={14} height={14} style={{ verticalAlign: -2, marginRight: 4 }}><path d="M1 3h14M1 8h10M1 13h12" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" /></svg>
                Detalhamento por Projeto
              </span>
              <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 12px' }} onClick={() => window.showView?.('estimativas')}>Ver todas →</button>
            </div>
            <div className="est-dash-grid">
              <div className="est-dash-panel est-dash-aprov">
                <div className="est-dash-panel-title">
                  <svg viewBox="0 0 16 16" fill="none" width={13} height={13}><path d="M3 8l3.5 3.5L13 4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Aprovadas — por Projeto
                </div>
                <div className="est-dash-projetos">
                  {groupByProjeto(estAprov).length === 0
                    ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Nenhuma estimativa</span>
                    : groupByProjeto(estAprov).map(([nome, val]) => (
                      <div className="est-dash-proj-row" key={nome}>
                        <span className="est-dash-proj-nome">{nome}</span>
                        <span className="est-dash-proj-val">{formatCurrency(val)}</span>
                      </div>
                    ))}
                </div>
              </div>
              <div className="est-dash-panel est-dash-nao-aprov">
                <div className="est-dash-panel-title">
                  <svg viewBox="0 0 16 16" fill="none" width={13} height={13}><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth={2} strokeLinecap="round" /></svg>
                  Não Aprovadas — por Projeto
                </div>
                <div className="est-dash-projetos">
                  {groupByProjeto(estNaoAprov).length === 0
                    ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Nenhuma estimativa</span>
                    : groupByProjeto(estNaoAprov).map(([nome, val]) => (
                      <div className="est-dash-proj-row" key={nome}>
                        <span className="est-dash-proj-nome">{nome}</span>
                        <span className="est-dash-proj-val">{formatCurrency(val)}</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {detalheAcao && <AcaoModal acao={detalheAcao} onClose={() => setDetalheAcao(null)} />}
    </div>
  )
}
