import { Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getLogAnalyticsWorkspaces, getLogAnalyticsRecomendacoes, getLogAnalyticsTabelas, getLogAnalyticsFontes,
  getLogAnalyticsDiagnosticSettings, getLogAnalyticsResumo, getLogAnalyticsAppInsights,
  forcarColetaLogAnalytics, forcarColetaDiagnosticSettings, detalharRecursoTabela,
  baixarLogAnalyticsExcel, baixarLogAnalyticsDashboardHtml, habilitarAuditoriaConsultas,
  type LogAnalyticsSeveridade, type LogAnalyticsWorkspace, type LogAnalyticsRecursoDetalhado,
  type LogAnalyticsRankingItem,
} from '../api/logAnalytics'

// v1 (2026-09-29): descoberta de workspaces + ingestão diária por tabela + as 5 regras do
// motor de FinOps + export Excel. v1.1 (mesmo dia): retenção por tabela (ARM Tables - List) +
// custo real por workspace (JOIN com azure_costs, já coletado pela Coleta Azure) + rateio
// estimado de custo por tabela + 2 novas regras (candidata a Basic, retenção customizada).
// v1.2: Diagnostic Settings (API oficial por recurso, cadência própria/semanal — Resource
// Graph não indexa esse recurso de forma confiável) + DCR (coleta diária, barato) + "Fontes de
// Log" consolidado + detalhamento por recurso sob demanda (KQL pontual, janela de 3 dias).
// Sem score 0-100, sem os 3 dashboards (Executivo/Operacional/Engenharia) — isso é v2.

function fmtGB(v: number | null | undefined): string {
  const n = Number(v) || 0
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' GB'
}

function fmtBRL(v: number | null | undefined): string {
  return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const SEVERIDADE_COR: Record<LogAnalyticsSeveridade, string> = {
  atencao: '#ff8c42',
  critico: '#ff4d6a',
}
const SEVERIDADE_LABEL: Record<LogAnalyticsSeveridade, string> = {
  atencao: 'Atenção',
  critico: 'Crítico',
}

function SeveridadeBadge({ severidade }: { severidade: LogAnalyticsSeveridade }) {
  const c = SEVERIDADE_COR[severidade] || '#7b6a9e'
  return (
    <span style={{
      background: c + '22', color: c, border: '1px solid ' + c + '55',
      padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {SEVERIDADE_LABEL[severidade] || severidade}
    </span>
  )
}

// Mesmo padrão do RankingCard em DatabricksDashboardView.tsx — barra de proporção em CSS puro,
// sem lib de gráfico (política já seguida em todo o app, ver CkBarChart.tsx). Usado nos 4
// rankings do "Painel" abaixo.
function RankingList({ title, items, color, fmt }: { title: string; items: LogAnalyticsRankingItem[]; color: string; fmt?: (v: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.valor))
  const format = fmt || ((v: number) => v.toLocaleString('pt-BR'))
  return (
    <div className="card" style={{ flex: 1, minWidth: 260 }}>
      <div className="card-header"><span className="card-title">{title}</span></div>
      <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sem dados.</div>}
        {items.map((item, i) => {
          const pct = Math.max(2, Math.round((item.valor / max) * 100))
          return (
            <div key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, marginBottom: 3 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.label}>{item.label}</span>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{format(item.valor)}</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: pct + '%', background: color, borderRadius: 3 }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function LogAnalyticsView() {
  const queryClient = useQueryClient()
  const [filtroSeveridade, setFiltroSeveridade] = useState<LogAnalyticsSeveridade | undefined>(undefined)
  const [exportando, setExportando] = useState(false)
  const [gerandoDashboard, setGerandoDashboard] = useState(false)
  const [workspaceSelecionado, setWorkspaceSelecionado] = useState<LogAnalyticsWorkspace | null>(null)

  const [detalheRecurso, setDetalheRecurso] = useState<{ tabela: string; recursos: LogAnalyticsRecursoDetalhado[]; janelaDias: number } | null>(null)
  const [somenteWorkspacesComCusto, setSomenteWorkspacesComCusto] = useState(false)
  const [somenteTabelasComCusto, setSomenteTabelasComCusto] = useState(false)
  const [appInsightsMostrarTodos, setAppInsightsMostrarTodos] = useState(false)
  const [recomendacoesMostrarTodas, setRecomendacoesMostrarTodas] = useState(false)

  const workspacesQuery = useQuery({ queryKey: ['log-analytics-workspaces'], queryFn: getLogAnalyticsWorkspaces })
  const appInsightsQuery = useQuery({ queryKey: ['log-analytics-app-insights'], queryFn: getLogAnalyticsAppInsights })
  const resumoQuery = useQuery({ queryKey: ['log-analytics-resumo'], queryFn: getLogAnalyticsResumo })
  const tabelasQuery = useQuery({
    queryKey: ['log-analytics-tabelas', workspaceSelecionado?.workspace_guid],
    queryFn: () => getLogAnalyticsTabelas(workspaceSelecionado!.workspace_guid),
    enabled: !!workspaceSelecionado,
  })
  const fontesQuery = useQuery({
    queryKey: ['log-analytics-fontes', workspaceSelecionado?.workspace_guid],
    queryFn: () => getLogAnalyticsFontes(workspaceSelecionado!.workspace_guid),
    enabled: !!workspaceSelecionado,
  })
  const diagSettingsQuery = useQuery({
    queryKey: ['log-analytics-diagnostic-settings', workspaceSelecionado?.workspace_guid],
    queryFn: () => getLogAnalyticsDiagnosticSettings(workspaceSelecionado!.workspace_guid),
    enabled: !!workspaceSelecionado,
  })
  const recomendacoesQuery = useQuery({
    queryKey: ['log-analytics-recomendacoes', filtroSeveridade],
    queryFn: () => getLogAnalyticsRecomendacoes(filtroSeveridade),
  })

  const coletaMutation = useMutation({
    mutationFn: forcarColetaLogAnalytics,
    onSuccess: (r) => {
      window.showToast?.(r.message, 'success')
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['log-analytics-workspaces'] })
        queryClient.invalidateQueries({ queryKey: ['log-analytics-recomendacoes'] })
        queryClient.invalidateQueries({ queryKey: ['log-analytics-fontes'] })
        queryClient.invalidateQueries({ queryKey: ['log-analytics-resumo'] })
        queryClient.invalidateQueries({ queryKey: ['log-analytics-app-insights'] })
      }, 5000)
    },
    onError: (e: Error) => window.showToast?.(e.message, 'error'),
  })

  const coletaDiagMutation = useMutation({
    mutationFn: forcarColetaDiagnosticSettings,
    onSuccess: (r) => {
      window.showToast?.(r.message, 'success')
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['log-analytics-fontes'] })
        queryClient.invalidateQueries({ queryKey: ['log-analytics-diagnostic-settings'] })
        queryClient.invalidateQueries({ queryKey: ['log-analytics-resumo'] })
      }, 60_000)
    },
    onError: (e: Error) => window.showToast?.(e.message, 'error'),
  })

  const detalharMutation = useMutation({
    mutationFn: (tabela: string) => detalharRecursoTabela(workspaceSelecionado!.workspace_guid, tabela),
    onSuccess: (r, tabela) => setDetalheRecurso({ tabela, recursos: r.recursos, janelaDias: r.janela_dias }),
    onError: (e: Error) => window.showToast?.(e.message, 'error'),
  })

  // Habilita a auditoria de consultas (LAQueryLogs) no workspace selecionado — único PUT de
  // todo o projeto (resto é só leitura), por isso o botão é explícito e não automático.
  const habilitarAuditoriaMutation = useMutation({
    mutationFn: () => habilitarAuditoriaConsultas(workspaceSelecionado!.workspace_guid),
    onSuccess: (r) => {
      window.showToast?.(r.message, 'success')
      queryClient.invalidateQueries({ queryKey: ['log-analytics-tabelas', workspaceSelecionado?.workspace_guid] })
    },
    onError: (e: Error) => window.showToast?.(e.message, 'error'),
  })

  async function exportar() {
    setExportando(true)
    try {
      await baixarLogAnalyticsExcel()
    } catch (e) {
      window.showToast?.(e instanceof Error ? e.message : 'Erro ao exportar', 'error')
    } finally {
      setExportando(false)
    }
  }

  async function gerarDashboard() {
    setGerandoDashboard(true)
    try {
      await baixarLogAnalyticsDashboardHtml()
    } catch (e) {
      window.showToast?.(e instanceof Error ? e.message : 'Erro ao gerar dashboard', 'error')
    } finally {
      setGerandoDashboard(false)
    }
  }

  const workspaces = workspacesQuery.data || []
  const recomendacoes = recomendacoesQuery.data || []
  const tabelas = tabelasQuery.data?.tabelas || []
  const auditoriaConsultasHabilitada = tabelasQuery.data?.auditoria_consultas_habilitada ?? false
  const workspacesExibidos = somenteWorkspacesComCusto ? workspaces.filter((w) => (Number(w.custo_mes_total) || 0) > 0) : workspaces
  const tabelasExibidas = somenteTabelasComCusto
    ? tabelas.filter((t) => (Number(t.custo_ingestao_estimado) || 0) + (Number(t.custo_retencao_estimado) || 0) > 0)
    : tabelas
  const fontes = fontesQuery.data?.fontes || []
  const diagSettings = diagSettingsQuery.data || []
  const appInsights = appInsightsQuery.data || []

  function selecionarWorkspace(w: LogAnalyticsWorkspace | null) {
    setWorkspaceSelecionado(w)
    setDetalheRecurso(null)
    setAppInsightsMostrarTodos(false) // trocar/selecionar workspace volta a filtrar por ele
    setRecomendacoesMostrarTodas(false)
  }

  const appInsightsExibidos = (workspaceSelecionado && !appInsightsMostrarTodos)
    ? appInsights.filter((ai) => ai.workspace_resource_id?.toUpperCase() === workspaceSelecionado.resource_id.toUpperCase())
    : appInsights

  const recomendacoesExibidas = (workspaceSelecionado && !recomendacoesMostrarTodas)
    ? recomendacoes.filter((r) => r.workspace_guid === workspaceSelecionado.workspace_guid)
    : recomendacoes

  const custoTotal = workspacesExibidos.reduce((a, w) => a + (Number(w.custo_mes_total) || 0), 0)
  const custoIngestao = workspacesExibidos.reduce((a, w) => a + (Number(w.custo_mes_ingestao) || 0), 0)
  const custoRetencao = workspacesExibidos.reduce((a, w) => a + (Number(w.custo_mes_retencao) || 0), 0)
  const tabelasCustomizadas = workspacesExibidos.reduce((a, w) => a + (Number(w.tabelas_retencao_customizada) || 0), 0)

  return (
    <div>
      <div className="view-hero">
        <div className="page-title">Log Analytics FinOps</div>
        <div className="view-hero-sub">Ingestão, retenção e oportunidades de economia nos workspaces de Log Analytics.</div>
      </div>

      <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn-ghost" style={{ padding: '7px 14px', fontSize: 12 }}
          disabled={coletaMutation.isPending} onClick={() => coletaMutation.mutate()}>
          {coletaMutation.isPending ? 'Coletando...' : '↻ Atualizar agora'}
        </button>
        <button className="btn-ghost" style={{ padding: '7px 14px', fontSize: 12 }}
          disabled={coletaDiagMutation.isPending} onClick={() => coletaDiagMutation.mutate()}
          title="Etapa separada e mais cara (1 chamada por recurso monitorável do tenant) — pode levar vários minutos em tenants grandes">
          {coletaDiagMutation.isPending ? 'Coletando...' : '🔎 Atualizar Diagnostic Settings'}
        </button>
        <button className="btn-export" disabled={exportando} onClick={exportar}>
          <svg viewBox="0 0 16 16" fill="none" width={14} height={14}><path d="M2 12v2h12v-2M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" /></svg>
          {exportando ? 'Exportando...' : 'Exportar Excel'}
        </button>
        <button className="btn-ghost" style={{ padding: '7px 14px', fontSize: 12 }}
          disabled={gerandoDashboard} onClick={gerarDashboard}
          title="HTML autocontido (gráficos embutidos) — abre sem login, pode ser enviado por e-mail">
          {gerandoDashboard ? 'Gerando...' : '📊 Gerar Dashboard'}
        </button>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
        <div className="stat-card accent">
          <div className="stat-label">Custo (últimos 30 dias, real)</div>
          <div className="stat-value">{fmtBRL(custoTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Custo ingestão (30d)</div>
          <div className="stat-value">{fmtBRL(custoIngestao)}</div>
        </div>
        <div className="stat-card yellow-card">
          <div className="stat-label">Custo retenção (30d)</div>
          <div className="stat-value" style={{ color: 'var(--orange,#ff8c42)' }}>{fmtBRL(custoRetencao)}</div>
        </div>
        <div className="stat-card danger">
          <div className="stat-label">Tabelas c/ retenção customizada</div>
          <div className="stat-value">{tabelasCustomizadas}</div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -10 }}>
        Custo real correlacionado com `azure_costs` (Cost Management) pelo resource_id do workspace, janela móvel de 30 dias (não "mês corrente") — a importação de custos do Azure tem atraso de publicação, e uma janela fixa de calendário ficaria zerada sempre que esse atraso passar do início do mês. Clique em um workspace na tabela abaixo para ver o inventário por tabela.
        {somenteWorkspacesComCusto && (
          <> <strong style={{ color: 'var(--text)' }}>Filtro "só com custo" ativo</strong> — os KPIs acima somam só os workspaces visíveis na tabela, não o total geral (o Painel logo abaixo continua mostrando o total de todos).</>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {resumoQuery.isLoading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Carregando painel...</div>
        ) : (
          <>
            <RankingList title="Custo por Workspace — Top 10 (30d)" color="#7B2FBE" items={resumoQuery.data?.custoPorWorkspace || []} fmt={fmtBRL} />
            <RankingList title="Top Tabelas por Volume" color="#2f9bbe" items={resumoQuery.data?.topTabelas || []} fmt={fmtGB} />
            <RankingList title="Fontes de Log" color="#70AD47" items={resumoQuery.data?.fontes || []} />
            <RankingList title="Distribuição de Retenção" color="#ff8c42" items={resumoQuery.data?.distribuicaoRetencao || []} />
          </>
        )}
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Workspaces
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={somenteWorkspacesComCusto} onChange={(e) => setSomenteWorkspacesComCusto(e.target.checked)} />
            Mostrar só com custo
          </label>
        </div>
        {workspacesQuery.isLoading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Carregando...</div>
        ) : workspaces.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Nenhum workspace descoberto ainda — clique em "Atualizar agora" para rodar a primeira coleta.
          </div>
        ) : workspacesExibidos.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Nenhum workspace com custo (30d) maior que zero — desmarque o filtro pra ver todos.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  <th style={{ padding: '6px 8px' }}>Nome</th>
                  <th style={{ padding: '6px 8px' }}>Resource Group</th>
                  <th style={{ padding: '6px 8px' }}>Retenção (workspace)</th>
                  <th style={{ padding: '6px 8px' }}>SKU</th>
                  <th style={{ padding: '6px 8px' }}>Daily Cap</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Ingestão do mês</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Custo (30d)</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Tabelas c/ retenção custom.</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Recomendações</th>
                </tr>
              </thead>
              <tbody>
                {workspacesExibidos.map((w) => {
                  const selecionado = workspaceSelecionado?.resource_id === w.resource_id
                  return (
                  <tr key={w.resource_id} onClick={() => selecionarWorkspace(w)}
                    style={{
                      borderTop: '1px solid var(--border)', cursor: 'pointer',
                      background: selecionado ? '#7B2FBE1f' : undefined,
                      boxShadow: selecionado ? 'inset 3px 0 0 #7B2FBE' : undefined,
                    }}>
                    <td style={{ padding: '6px 8px' }}>{w.nome || '—'}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{w.resource_group || '—'}</td>
                    <td style={{ padding: '6px 8px' }}>{w.retencao_dias != null ? w.retencao_dias + ' dias' : '—'}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{w.sku || '—'}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {w.daily_cap_gb != null ? (
                        <span style={{
                          fontSize: 10.5, padding: '1px 7px', borderRadius: 8, fontWeight: 600,
                          background: '#ff8c4222', color: '#ff8c42', border: '1px solid #ff8c4255',
                        }} title="Teto diário de ingestão configurado — ao atingir, a coleta de novos dados é interrompida até o próximo reset">
                          {w.daily_cap_gb.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB/dia
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>Sem limite</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>{fmtGB(w.ingestao_mes_gb)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>{fmtBRL(w.custo_mes_total)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      {w.tabelas_retencao_customizada > 0 ? (
                        <span style={{ color: '#ff8c42', fontWeight: 600 }}>{w.tabelas_retencao_customizada}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>0</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      {w.recomendacoes_abertas > 0 ? (
                        <span style={{ color: '#ff8c42', fontWeight: 600 }}>{w.recomendacoes_abertas}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>0</span>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Application Insights
          </div>
          {workspaceSelecionado && !appInsightsMostrarTodos && (
            <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setAppInsightsMostrarTodos(true)}>
              Ver todos ({appInsights.length})
            </button>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
          {workspaceSelecionado && !appInsightsMostrarTodos ? (
            <>Mostrando só componentes vinculados ao workspace <strong style={{ color: 'var(--text)' }}>{workspaceSelecionado.nome}</strong> — componentes clássicos (sem workspace) ficam ocultos nesse filtro.</>
          ) : (
            <>Alavancas de custo próprias do App Insights — Sampling (reduz telemetria na origem), Daily Cap e retenção. "Workspace-based" fatura através do workspace de Log Analytics vinculado (clique pra abrir o inventário dele).</>
          )}
        </div>
        {appInsightsQuery.isLoading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Carregando...</div>
        ) : appInsights.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Nenhum componente de Application Insights descoberto ainda — clique em "Atualizar agora" para rodar a coleta.
          </div>
        ) : appInsightsExibidos.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Nenhum componente de Application Insights vinculado a este workspace.{' '}
            <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setAppInsightsMostrarTodos(true)}>Ver todos</button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  <th style={{ padding: '6px 8px' }}>Nome</th>
                  <th style={{ padding: '6px 8px' }}>Resource Group</th>
                  <th style={{ padding: '6px 8px' }}>Tipo</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Sampling</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>Retenção</th>
                  <th style={{ padding: '6px 8px' }}>Daily Cap</th>
                  <th style={{ padding: '6px 8px' }}>Workspace vinculado</th>
                </tr>
              </thead>
              <tbody>
                {appInsightsExibidos.map((ai) => {
                  const wsVinculado = ai.workspace_resource_id
                    ? workspaces.find((w) => w.resource_id.toUpperCase() === ai.workspace_resource_id!.toUpperCase())
                    : undefined
                  return (
                    <tr key={ai.resource_id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px' }}>{ai.nome || '—'}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{ai.resource_group || '—'}</td>
                      <td style={{ padding: '6px 8px' }}>
                        {ai.workspace_resource_id ? (
                          <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 8, fontWeight: 600, background: '#2f9bbe22', color: '#2f7a9b' }}>Workspace-based</span>
                        ) : (
                          <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 8, fontWeight: 600, background: 'var(--bg)', color: 'var(--text-muted)' }}>Clássico</span>
                        )}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                        {ai.sampling_percentage == null ? '—' : (
                          <span style={{ fontWeight: 600, color: ai.sampling_percentage < 100 ? '#70AD47' : 'var(--text)' }}>
                            {ai.sampling_percentage.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{ai.retencao_dias != null ? ai.retencao_dias + ' dias' : '—'}</td>
                      <td style={{ padding: '6px 8px' }}>
                        {ai.daily_cap_gb != null ? (
                          <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 8, fontWeight: 600, background: '#ff8c4222', color: '#ff8c42', border: '1px solid #ff8c4255' }}>
                            {ai.daily_cap_gb.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB/dia
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>Sem limite</span>
                        )}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        {wsVinculado ? (
                          <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => selecionarWorkspace(wsVinculado)}>
                            {ai.workspace_nome || wsVinculado.nome} →
                          </button>
                        ) : ai.workspace_nome ? ai.workspace_nome : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {workspaceSelecionado && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Tabelas — {workspaceSelecionado.nome}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {!auditoriaConsultasHabilitada && (
                <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }}
                  disabled={habilitarAuditoriaMutation.isPending} onClick={() => habilitarAuditoriaMutation.mutate()}
                  title="Liga a contagem de queries por tabela (LAQueryLogs) — grava uma configuração na Azure e só conta consultas feitas a partir de agora, não retroativo">
                  {habilitarAuditoriaMutation.isPending ? 'Habilitando...' : '🔍 Habilitar auditoria de consultas'}
                </button>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={somenteTabelasComCusto} onChange={(e) => setSomenteTabelasComCusto(e.target.checked)} />
                Mostrar só com custo
              </label>
              <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => selecionarWorkspace(null)}>Fechar</button>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
            Custo por tabela é uma estimativa por rateio (GB e dias de retenção) — o Cost Management do Azure não fatura por tabela, só por workspace.
            {' '}{auditoriaConsultasHabilitada
              ? 'Auditoria de consultas habilitada — coluna "Consultas (30d)" abaixo mostra quantas queries KQL rodaram em cada tabela (só conta consultas de usuário via Portal/API, não alertas agendados).'
              : 'Quantidade de consultas por tabela exige habilitar a auditoria (botão acima) — sem ela, não dá pra saber quais tabelas Analytics realmente ninguém consulta.'}
          </div>
          {tabelasQuery.isLoading ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Carregando...</div>
          ) : tabelas.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Nenhuma tabela coletada ainda para este workspace — clique em "Atualizar agora" para rodar a coleta.
            </div>
          ) : tabelasExibidas.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Nenhuma tabela com custo estimado maior que zero — desmarque o filtro pra ver todas.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    <th style={{ padding: '6px 8px' }}>Tabela</th>
                    <th style={{ padding: '6px 8px' }}>Plano</th>
                    <th style={{ padding: '6px 8px' }}>Retenção interativa</th>
                    <th style={{ padding: '6px 8px' }}>Retenção total</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Ingestão do mês</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Custo ingestão (estim.)</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Custo retenção (estim.)</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Consultas (30d)</th>
                    <th style={{ padding: '6px 8px' }} />
                  </tr>
                </thead>
                <tbody>
                  {tabelasExibidas.map((t) => {
                    const detalhando = detalharMutation.isPending && detalharMutation.variables === t.tabela
                    return (
                    <Fragment key={t.tabela}>
                      <tr style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 8px' }}>{t.tabela}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{t.plano || '—'}</td>
                        <td style={{ padding: '6px 8px' }}>{t.retencao_dias != null ? t.retencao_dias + ' dias' : '—'}</td>
                        <td style={{ padding: '6px 8px' }}>
                          {t.retencao_total_dias != null ? t.retencao_total_dias + ' dias' : '—'}
                          {t.retencao_e_padrao === false && (
                            <span style={{
                              marginLeft: 6, background: '#ff8c4222', color: '#ff8c42', border: '1px solid #ff8c4255',
                              padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                            }}>customizada</span>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>{fmtGB(t.gb_mes)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtBRL(t.custo_ingestao_estimado)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: t.custo_retencao_estimado > 0 ? 'var(--orange,#ff8c42)' : undefined }}>
                          {fmtBRL(t.custo_retencao_estimado)}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
                          {!auditoriaConsultasHabilitada ? (
                            <span style={{ color: 'var(--text-muted)', fontFamily: 'inherit' }}>—</span>
                          ) : t.consultas_30d === 0 ? (
                            <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 8, fontWeight: 600, background: '#ff4d6a22', color: '#ff4d6a', border: '1px solid #ff4d6a55' }}>
                              0 consultas
                            </span>
                          ) : (
                            t.consultas_30d ?? '—'
                          )}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 10 }}
                            disabled={detalhando} onClick={() => detalharMutation.mutate(t.tabela)}
                            title="Roda uma query KQL pontual (janela de 3 dias) contra a tabela de log real — diferente do resto da tela, isso consome uma query de verdade">
                            {detalhando ? '...' : 'Detalhar por recurso'}
                          </button>
                        </td>
                      </tr>
                      {detalheRecurso?.tabela === t.tabela && (
                        <tr>
                          <td colSpan={9} style={{ padding: '4px 8px 12px 24px', background: 'var(--bg)' }}>
                            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                              Top recursos por volume em {t.tabela} — últimos {detalheRecurso.janelaDias} dias (query pontual, não é dado pré-coletado)
                            </div>
                            {detalheRecurso.recursos.length === 0 ? (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Nenhum recurso identificado na janela consultada.</div>
                            ) : (
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                                <tbody>
                                  {detalheRecurso.recursos.map((r) => (
                                    <tr key={r.resource_id}>
                                      <td style={{ padding: '2px 8px', wordBreak: 'break-all' }}>{r.resource_id}</td>
                                      <td style={{ padding: '2px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtGB(r.gb)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {workspaceSelecionado && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
            Fontes de Log — {workspaceSelecionado.nome}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
            {fontesQuery.data?.diagnostic_settings_atualizado_em
              ? `Diagnostic Settings coletados em ${new Date(fontesQuery.data.diagnostic_settings_atualizado_em).toLocaleString('pt-BR')}.`
              : 'Diagnostic Settings ainda não coletados — clique em "Atualizar Diagnostic Settings" no topo da tela (etapa separada, pode levar minutos).'}
            {' '}DCRs entram na coleta diária normal.
          </div>
          {fontesQuery.isLoading ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Carregando...</div>
          ) : fontes.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhuma fonte de log identificada ainda para este workspace.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    <th style={{ padding: '6px 8px' }}>Mecanismo</th>
                    <th style={{ padding: '6px 8px' }}>Tipo / Nome</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Recursos / Streams</th>
                    <th style={{ padding: '6px 8px' }}>Categorias / Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {fontes.map((f, idx) => (
                    <tr key={idx} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px' }}>
                        <span style={{
                          fontSize: 10.5, padding: '1px 7px', borderRadius: 8, fontWeight: 600,
                          background: f.mecanismo === 'Diagnostic Setting' ? '#7b2fbe22' : '#2f9bbe22',
                          color: f.mecanismo === 'Diagnostic Setting' ? '#7b2fbe' : '#2f9bbe',
                        }}>{f.mecanismo}</span>
                      </td>
                      <td style={{ padding: '6px 8px' }}>{f.tipo}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>{f.contagem}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11.5 }}>{f.detalhe || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {workspaceSelecionado && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
            Diagnostic Settings — detalhe por recurso
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
            Categorias de log habilitadas/desabilitadas em cada Diagnostic Setting que aponta pra este workspace — "Fontes de Log" acima é o resumo agregado por tipo de recurso, esta tabela é o detalhe recurso a recurso.
          </div>
          {diagSettingsQuery.isLoading ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Carregando...</div>
          ) : diagSettings.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Nenhum Diagnostic Setting coletado ainda — clique em "Atualizar Diagnostic Settings" no topo da tela.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    <th style={{ padding: '6px 8px' }}>Recurso</th>
                    <th style={{ padding: '6px 8px' }}>Config.</th>
                    <th style={{ padding: '6px 8px' }}>Categorias habilitadas</th>
                    <th style={{ padding: '6px 8px' }}>Categorias desabilitadas</th>
                    <th style={{ padding: '6px 8px' }}>Métricas habilitadas</th>
                    <th style={{ padding: '6px 8px' }}>Métricas desabilitadas</th>
                    <th style={{ padding: '6px 8px' }}>Também envia p/</th>
                  </tr>
                </thead>
                <tbody>
                  {diagSettings.map((d, idx) => {
                    const habilitadas = (d.categorias_habilitadas || '').split(';').map((c) => c.trim()).filter(Boolean)
                    const metricasHabilitadas = (d.metricas_habilitadas || '').split(';').map((c) => c.trim()).filter(Boolean)
                    return (
                      <tr key={idx} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 8px', maxWidth: 260 }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }} title={d.recurso_id}>
                            {d.recurso_id.split('/').pop()}
                            {d.outros_workspaces && d.outros_workspaces.length > 0 && (
                              <span
                                title={`Fan-out: também envia pra ${d.outros_workspaces.join(', ')} — ingestão paga em dobro, veja a recomendação`}
                                style={{
                                  fontSize: 9.5, padding: '1px 6px', borderRadius: 8, fontWeight: 700, flexShrink: 0,
                                  background: '#ff4d6a22', color: '#ff4d6a', border: '1px solid #ff4d6a55',
                                }}
                              >⚠ +{d.outros_workspaces.length} workspace{d.outros_workspaces.length > 1 ? 's' : ''}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{d.recurso_tipo}</div>
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{d.nome_config || '—'}</td>
                        <td style={{ padding: '6px 8px' }}>
                          {habilitadas.length === 0 ? <span style={{ color: 'var(--text-muted)' }}>—</span> : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {habilitadas.map((cat) => (
                                <span key={cat} style={{
                                  fontSize: 10, padding: '1px 6px', borderRadius: 8,
                                  background: '#70AD4722', color: '#4f7a31', fontWeight: 600,
                                }}>{cat}</span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.categorias_desabilitadas || ''}>
                          {d.categorias_desabilitadas || '—'}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          {metricasHabilitadas.length === 0 ? <span style={{ color: 'var(--text-muted)' }}>—</span> : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {metricasHabilitadas.map((cat) => (
                                <span key={cat} style={{
                                  fontSize: 10, padding: '1px 6px', borderRadius: 8,
                                  background: '#2f9bbe22', color: '#2f7a9b', fontWeight: 600,
                                }}>{cat}</span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 11, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.metricas_desabilitadas || ''}>
                          {d.metricas_desabilitadas || '—'}
                        </td>
                        <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--text-muted)' }}>
                          {[d.envia_storage && 'Storage', d.envia_eventhub && 'Event Hub'].filter(Boolean).join(', ') || '—'}
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

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Recomendações
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {([undefined, 'critico', 'atencao'] as const).map((s) => (
              <button key={s ?? 'todas'} className="btn-ghost"
                style={{ padding: '4px 10px', fontSize: 11, opacity: filtroSeveridade === s ? 1 : 0.6 }}
                onClick={() => setFiltroSeveridade(s)}>
                {s === undefined ? 'Todas' : SEVERIDADE_LABEL[s]}
              </button>
            ))}
            {workspaceSelecionado && !recomendacoesMostrarTodas && (
              <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={() => setRecomendacoesMostrarTodas(true)}>
                Ver todas ({recomendacoes.length})
              </button>
            )}
          </div>
        </div>
        {workspaceSelecionado && !recomendacoesMostrarTodas && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
            Mostrando só recomendações do workspace <strong style={{ color: 'var(--text)' }}>{workspaceSelecionado.nome}</strong>.
          </div>
        )}
        {recomendacoesQuery.isLoading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Carregando...</div>
        ) : recomendacoes.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nenhuma recomendação encontrada.</div>
        ) : recomendacoesExibidas.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Nenhuma recomendação para este workspace.{' '}
            <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setRecomendacoesMostrarTodas(true)}>Ver todas</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recomendacoesExibidas.map((r) => (
              <div key={r.id} style={{
                display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 12px',
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
              }}>
                <SeveridadeBadge severidade={r.severidade} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.workspace_nome}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{r.detalhe}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
