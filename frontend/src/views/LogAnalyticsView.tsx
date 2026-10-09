import { Fragment, useState, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getLogAnalyticsWorkspaces, getLogAnalyticsRecomendacoes, getLogAnalyticsTabelas, getLogAnalyticsFontes,
  getLogAnalyticsDiagnosticSettings, getLogAnalyticsResumo, getLogAnalyticsAppInsights,
  getLogAnalyticsRecursosVolume, getLogAnalyticsExportSemWorkspace, getLogAnalyticsCustoObservabilidade,
  forcarColetaLogAnalytics, forcarColetaDiagnosticSettings, detalharRecursoTabela,
  baixarLogAnalyticsExcel, baixarLogAnalyticsDashboardHtml, habilitarAuditoriaConsultas,
  type LogAnalyticsSeveridade, type LogAnalyticsWorkspace, type LogAnalyticsRecursoDetalhado,
  type LogAnalyticsRankingItem,
} from '../api/logAnalytics'
import LogAnalyticsConsumoModal from '../components/LogAnalyticsConsumoModal'
import { TenantSelector } from '../components/TenantSelector'
import { useTenantFilter } from '../contexts/TenantFilterContext'

// v1 (2026-09-29): descoberta de workspaces + ingestão diária por tabela + as 5 regras do
// motor de FinOps + export Excel. v1.1 (mesmo dia): retenção por tabela (ARM Tables - List) +
// custo real por workspace (JOIN com azure_costs, já coletado pela Coleta Azure) + rateio
// estimado de custo por tabela + 2 novas regras (candidata a Basic, retenção customizada).
// v1.2: Diagnostic Settings (API oficial por recurso, cadência própria/semanal — Resource
// Graph não indexa esse recurso de forma confiável) + DCR (coleta diária, barato) + "Fontes de
// Log" consolidado + detalhamento por recurso sob demanda (KQL pontual, janela de 3 dias).
// Sem score 0-100, sem os 3 dashboards (Executivo/Operacional/Engenharia) — isso é v2.

// Dropdown de mês (2026-10-xx, pedido do usuário) — substitui a janela fixa de 30 dias/mês
// corrente que a tela tinha antes. Componentes LOCAIS da data (não toISOString(), que é UTC e
// "volta" um dia depois das 21h em UTC-3 — mesmo bug já identificado em outras telas do app).
const _MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
function mesAtualYYYYMM(): string {
  const hoje = new Date()
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
}
function mesOpcoes(): { value: string; label: string }[] {
  const hoje = new Date()
  const opcoes: { value: string; label: string }[] = []
  for (let i = 0; i < 12; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    opcoes.push({ value, label: `${_MESES_PT[d.getMonth()]}/${d.getFullYear()}` })
  }
  return opcoes
}

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
  const { selectedTenantId, tenantNome, matchSubscription } = useTenantFilter()
  const [filtroSeveridade, setFiltroSeveridade] = useState<LogAnalyticsSeveridade | undefined>(undefined)
  const [exportando, setExportando] = useState(false)
  const [gerandoDashboard, setGerandoDashboard] = useState(false)
  const [workspaceClicado, setWorkspaceClicado] = useState<LogAnalyticsWorkspace | null>(null)

  const [detalheRecurso, setDetalheRecurso] = useState<{ tabela: string; recursos: LogAnalyticsRecursoDetalhado[]; janelaDias: number; limite: number } | null>(null)
  // Recurso cujo Diagnostic Setting está aberto no modal. Guarda o id (não o setting) porque
  // o "não encontrado" também precisa ser mostrado, e aí não há setting pra guardar.
  const [diagDoRecurso, setDiagDoRecurso] = useState<string | null>(null)
  const [somenteWorkspacesComCusto, setSomenteWorkspacesComCusto] = useState(false)
  const [somenteTabelasComCusto, setSomenteTabelasComCusto] = useState(false)
  const [appInsightsMostrarTodos, setAppInsightsMostrarTodos] = useState(false)
  const [recomendacoesMostrarTodas, setRecomendacoesMostrarTodas] = useState(false)
  const [mes, setMes] = useState(mesAtualYYYYMM)
  const [consumoModalWorkspace, setConsumoModalWorkspace] = useState<LogAnalyticsWorkspace | null>(null)
  // Recorte por workspace, pra análise detalhada de um só. '' = todos. O recorte é aplicado no
  // banco (painel, rankings e exports), não sobre a resposta já agregada.
  const [workspaceFiltro, setWorkspaceFiltro] = useState('')

  const workspacesQuery = useQuery({ queryKey: ['log-analytics-workspaces', mes], queryFn: () => getLogAnalyticsWorkspaces(mes) })
  // Trocar de SP pode tirar da lista o workspace escolhido; nesse caso o recorte cai pra
  // "todos" em vez de filtrar por um guid que não está mais à vista.
  const workspaceAtivo = workspaceFiltro
    && (workspacesQuery.data || []).some((w) => w.workspace_guid === workspaceFiltro && matchSubscription(w.subscription_id))
    ? workspaceFiltro
    : ''
  // Clicar numa linha da tabela abre o detalhe, como sempre; escolher no filtro faz o mesmo
  // sem exigir o clique — "selecionar um workspace" passa a valer pra tela inteira (tabelas,
  // fontes, Diagnostic Settings, App Insights e recomendações).
  const workspaceSelecionado = workspaceClicado
    ?? (workspaceAtivo ? (workspacesQuery.data || []).find((w) => w.workspace_guid === workspaceAtivo) ?? null : null)
  const appInsightsQuery = useQuery({ queryKey: ['log-analytics-app-insights', selectedTenantId], queryFn: () => getLogAnalyticsAppInsights(selectedTenantId) })
  const resumoQuery = useQuery({ queryKey: ['log-analytics-resumo', mes, selectedTenantId, workspaceAtivo], queryFn: () => getLogAnalyticsResumo(mes, selectedTenantId, workspaceAtivo || null) })
  const tabelasQuery = useQuery({
    queryKey: ['log-analytics-tabelas', workspaceSelecionado?.workspace_guid, mes],
    queryFn: () => getLogAnalyticsTabelas(workspaceSelecionado!.workspace_guid, mes),
    enabled: !!workspaceSelecionado,
  })
  const fontesQuery = useQuery({
    queryKey: ['log-analytics-fontes', workspaceSelecionado?.workspace_guid],
    queryFn: () => getLogAnalyticsFontes(workspaceSelecionado!.workspace_guid),
    enabled: !!workspaceSelecionado,
  })
  // Ranking de recursos por volume — vem do acumulado (log_analytics_ingestao_recurso), não da
  // consulta ao vivo: cobre todas as tabelas grandes de uma vez e tem histórico.
  const recursosVolumeQuery = useQuery({
    queryKey: ['log-analytics-recursos-volume', workspaceSelecionado?.workspace_guid],
    queryFn: () => getLogAnalyticsRecursosVolume(workspaceSelecionado!.workspace_guid, 30),
    enabled: !!workspaceSelecionado,
  })
  // Custo de export de log (Storage/Event Hub) — nível tela, não de um workspace: a Azure
  // carimba no recurso de origem, então nunca entrou no custo de workspace nenhum.
  const observabilidadeQuery = useQuery({
    queryKey: ['log-analytics-custo-observabilidade', selectedTenantId],
    queryFn: () => getLogAnalyticsCustoObservabilidade(30, selectedTenantId),
  })
  const exportQuery = useQuery({
    queryKey: ['log-analytics-export-sem-ws', selectedTenantId],
    queryFn: () => getLogAnalyticsExportSemWorkspace(30, selectedTenantId),
  })
  const diagSettingsQuery = useQuery({
    queryKey: ['log-analytics-diagnostic-settings', workspaceSelecionado?.workspace_guid],
    queryFn: () => getLogAnalyticsDiagnosticSettings(workspaceSelecionado!.workspace_guid),
    enabled: !!workspaceSelecionado,
  })
  const recomendacoesQuery = useQuery({
    queryKey: ['log-analytics-recomendacoes', filtroSeveridade, selectedTenantId],
    queryFn: () => getLogAnalyticsRecomendacoes(filtroSeveridade, selectedTenantId),
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
    mutationFn: ({ tabela, limite }: { tabela: string; limite: number }) =>
      detalharRecursoTabela(workspaceSelecionado!.workspace_guid, tabela, limite),
    onSuccess: (r, { tabela, limite }) => setDetalheRecurso({ tabela, recursos: r.recursos, janelaDias: r.janela_dias, limite }),
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
      await baixarLogAnalyticsExcel(mes, selectedTenantId, workspaceAtivo || null)
    } catch (e) {
      window.showToast?.(e instanceof Error ? e.message : 'Erro ao exportar', 'error')
    } finally {
      setExportando(false)
    }
  }

  async function gerarDashboard() {
    setGerandoDashboard(true)
    try {
      await baixarLogAnalyticsDashboardHtml(mes, selectedTenantId, workspaceAtivo || null)
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

  // Atribuição por assinatura: as SPs cadastradas não compartilham subscriptions,
  // então `subscription_id` já identifica a dona do workspace. Ver TenantFilterContext.
  const workspacesFiltroPorTenant = useMemo(
    () => workspaces.filter((w) => matchSubscription(w.subscription_id)),
    [workspaces, matchSubscription],
  )

  const workspacesDoRecorte = workspaceAtivo
    ? workspacesFiltroPorTenant.filter((w) => w.workspace_guid === workspaceAtivo)
    : workspacesFiltroPorTenant
  const workspacesExibidos = somenteWorkspacesComCusto
    ? workspacesDoRecorte.filter((w) => (Number(w.custo_mes_total) || 0) > 0)
    : workspacesDoRecorte
  const tabelasExibidas = somenteTabelasComCusto
    ? tabelas.filter((t) => (Number(t.custo_ingestao_estimado) || 0) + (Number(t.custo_retencao_estimado) || 0) > 0)
    : tabelas
  const fontes = fontesQuery.data?.fontes || []
  const diagSettings = diagSettingsQuery.data || []
  const appInsights = appInsightsQuery.data || []

  function selecionarWorkspace(w: LogAnalyticsWorkspace | null) {
    setWorkspaceClicado(w)
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
  // Sentinel e capacidade pré-paga vinham somados dentro de "ingestão" e sumiam do radar.
  const custoSentinel = workspacesExibidos.reduce((a, w) => a + (Number(w.custo_mes_sentinel) || 0), 0)
  const custoCommitment = workspacesExibidos.reduce((a, w) => a + (Number(w.custo_mes_commitment) || 0), 0)
  const tabelasCustomizadas = workspacesExibidos.reduce((a, w) => a + (Number(w.tabelas_retencao_customizada) || 0), 0)
  const economiaCommitmentTier = workspacesExibidos.reduce((a, w) => a + (Number(w.economia_commitment_tier_periodo) || 0), 0)
  const mesLabel = resumoQuery.data?.mes_label || mesOpcoes().find((o) => o.value === mes)?.label || mes

  return (
    <div>
      <div className="view-hero">
        <div className="page-title">Log Analytics FinOps</div>
        <div className="view-hero-sub">Ingestão, retenção e oportunidades de economia nos workspaces de Log Analytics.</div>
      </div>

      {/* Filtro de Tenant (Service Principal) */}
      <div style={{ padding: '0 20px' }}>
        <TenantSelector />
        {workspacesFiltroPorTenant.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              Filtrar por Workspace:
            </label>
            <select
              className="filter-select"
              value={workspaceAtivo}
              onChange={(e) => { setWorkspaceFiltro(e.target.value); setWorkspaceClicado(null) }}
              style={{ flex: 1, maxWidth: 360 }}
            >
              <option value="">Todos os workspaces ({workspacesFiltroPorTenant.length})</option>
              {workspacesFiltroPorTenant.map((w) => (
                <option key={w.workspace_guid} value={w.workspace_guid}>{w.nome || w.workspace_guid}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <select className="filter-select" aria-label="Período" value={mes} onChange={(e) => setMes(e.target.value)}>
          {mesOpcoes().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
      </div>

      <div className="stats-grid-5">
        <div className="stat-card accent">
          <div className="stat-label">Custo ({mesLabel}, real)</div>
          <div className="stat-value">{fmtBRL(custoTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Custo ingestão ({mesLabel})</div>
          <div className="stat-value">{fmtBRL(custoIngestao)}</div>
        </div>
        {custoSentinel > 0 && (
          <div className="stat-card">
            <div className="stat-label" title="Análise do Sentinel, cobrada por cima da ingestão num medidor próprio">
              Custo Sentinel ({mesLabel})
            </div>
            <div className="stat-value">{fmtBRL(custoSentinel)}</div>
          </div>
        )}
        {custoCommitment > 0 && (
          <div className="stat-card">
            <div className="stat-label" title="Capacidade pré-paga: quando contratada, substitui a cobrança por GB">
              Commitment Tier ({mesLabel})
            </div>
            <div className="stat-value">{fmtBRL(custoCommitment)}</div>
          </div>
        )}
        <div className="stat-card yellow-card">
          <div className="stat-label">Custo retenção ({mesLabel})</div>
          <div className="stat-value" style={{ color: 'var(--orange,#ff8c42)' }}>{fmtBRL(custoRetencao)}</div>
        </div>
        <div className="stat-card danger">
          <div className="stat-label">Tabelas c/ retenção customizada</div>
          <div className="stat-value">{tabelasCustomizadas}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{economiaCommitmentTier < 0 ? '⚠️' : '💰'} Economia com Commitment Tier</div>
          <div className="stat-value" style={{ color: economiaCommitmentTier > 0 ? 'var(--green,#22c55e)' : economiaCommitmentTier < 0 ? 'var(--red,#ff4d6a)' : undefined }}>
            {fmtBRL(economiaCommitmentTier)}
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -10 }}>
        Custo real correlacionado com `azure_costs` (Cost Management) pelo resource_id do workspace. O período
        selecionado é sempre o mês civil. Clique em um workspace na tabela abaixo para ver o inventário por tabela.
        {resumoQuery.data?.custo_consolidado_ate && (
          <> O mês corrente vai do dia 1 até <strong style={{ color: 'var(--orange,#ff8c42)' }}>
            {new Date(resumoQuery.data.custo_consolidado_ate + 'T00:00:00').toLocaleDateString('pt-BR')}
          </strong>, o último dia com custo fechado — a Azure publica o billing com atraso, e os dias seguintes ficam de
          fora para nenhum deles entrar pela metade.</>
        )}
        {somenteWorkspacesComCusto && (
          <> <strong style={{ color: 'var(--text)' }}>Filtro "só com custo" ativo</strong> — os KPIs acima somam só os workspaces visíveis na tabela, não o total geral (o Painel logo abaixo continua mostrando o total de todos).</>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {resumoQuery.isLoading ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>Carregando painel...</div>
        ) : (
          <>
            <RankingList title={`Custo por Workspace — Top 10 (${mesLabel})`} color="#7B2FBE" items={resumoQuery.data?.custoPorWorkspace || []} fmt={fmtBRL} />
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
        ) : workspacesFiltroPorTenant.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Nenhum workspace coletado para <strong>{tenantNome}</strong> — os {workspaces.length} workspaces
            conhecidos pertencem a assinaturas de outra Service Principal. Selecione "Todas as SPs" para vê-los.
          </div>
        ) : workspacesExibidos.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Nenhum workspace com custo (30d) maior que zero — desmarque o filtro pra ver todos.
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Resource Group</th>
                  <th>Retenção (workspace)</th>
                  <th>SKU</th>
                  <th>Daily Cap</th>
                  <th style={{ textAlign: 'right' }}>Ingestão do mês</th>
                  <th style={{ textAlign: 'right' }}>Média GB/dia</th>
                  <th style={{ textAlign: 'right' }}>Custo ({mesLabel})</th>
                  <th style={{ textAlign: 'right' }}>Tabelas c/ retenção custom.</th>
                  <th style={{ textAlign: 'right' }}>Recomendações</th>
                </tr>
              </thead>
              <tbody>
                {workspacesExibidos.map((w) => {
                  const selecionado = workspaceSelecionado?.resource_id === w.resource_id
                  return (
                  <tr key={w.resource_id} onClick={() => selecionarWorkspace(w)}
                    style={{
                      cursor: 'pointer',
                      background: selecionado ? '#7B2FBE1f' : undefined,
                      boxShadow: selecionado ? 'inset 3px 0 0 #7B2FBE' : undefined,
                    }}>
                    <td>{w.nome || '—'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{w.resource_group || '—'}</td>
                    <td>{w.retencao_dias != null ? w.retencao_dias + ' dias' : '—'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>
                      {w.sku || '—'}
                      {/* Baseado no período selecionado (billing real), não no SKU atual — um
                          workspace pode ter tido Commitment Tier num mês passado e não ter mais
                          hoje (ou vice-versa); null = não houve cobrança de Commitment Tier
                          nesse período específico. */}
                      {w.economia_commitment_tier_periodo != null && (
                        <div
                          style={{ fontSize: 10.5, fontWeight: 600, marginTop: 2, color: w.economia_commitment_tier_periodo >= 0 ? 'var(--green,#22c55e)' : 'var(--red,#ff4d6a)' }}
                          title={`Economia real em ${mesLabel} vs Pay-As-You-Go pelo mesmo volume — negativo significa que o tier contratado estava acima do necessário`}
                        >
                          {w.economia_commitment_tier_periodo >= 0 ? '💰 ' : '⚠ '}{fmtBRL(w.economia_commitment_tier_periodo)}
                        </div>
                      )}
                    </td>
                    <td>
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
                    <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>{fmtGB(w.ingestao_mes_gb)}</td>
                    <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
                      {w.ingestao_media_gb_dia != null ? fmtGB(w.ingestao_media_gb_dia) + '/dia' : '—'}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setConsumoModalWorkspace(w) }}
                        title="Ver gráfico de consumo diário (GB e custo, dia a dia)"
                        style={{
                          marginLeft: 7, border: 'none', background: 'transparent', cursor: 'pointer',
                          fontSize: 13, verticalAlign: 'middle', padding: 0, lineHeight: 1,
                        }}
                      >📊</button>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}
                      title={[
                        `Ingestão: ${fmtBRL(w.custo_mes_ingestao)}`,
                        w.custo_mes_sentinel > 0 ? `Sentinel: ${fmtBRL(w.custo_mes_sentinel)}` : null,
                        w.custo_mes_commitment > 0 ? `Commitment Tier: ${fmtBRL(w.custo_mes_commitment)}` : null,
                        w.custo_mes_retencao > 0 ? `Retenção: ${fmtBRL(w.custo_mes_retencao)}` : null,
                      ].filter(Boolean).join(' · ')}>
                      {fmtBRL(w.custo_mes_total)}
                      {/* Sentinel e capacidade pré-paga costumam dominar o total e não são
                          ingestão — sem a marca, o número passa por custo de volume. */}
                      {(w.custo_mes_sentinel > 0 || w.custo_mes_commitment > 0) && (
                        <span style={{ marginLeft: 4, fontSize: 9, color: 'var(--text-muted)', fontWeight: 400 }}>✦</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {w.tabelas_retencao_customizada > 0 ? (
                        <span style={{ color: '#ff8c42', fontWeight: 600 }}>{w.tabelas_retencao_customizada}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>0</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
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
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Resource Group</th>
                  <th>Tipo</th>
                  <th style={{ textAlign: 'right' }}>Sampling</th>
                  <th style={{ textAlign: 'right' }}>Retenção</th>
                  <th>Daily Cap</th>
                  <th>Workspace vinculado</th>
                </tr>
              </thead>
              <tbody>
                {appInsightsExibidos.map((ai) => {
                  const wsVinculado = ai.workspace_resource_id
                    ? workspaces.find((w) => w.resource_id.toUpperCase() === ai.workspace_resource_id!.toUpperCase())
                    : undefined
                  return (
                    <tr key={ai.resource_id}>
                      <td>{ai.nome || '—'}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{ai.resource_group || '—'}</td>
                      <td>
                        {ai.workspace_resource_id ? (
                          <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 8, fontWeight: 600, background: '#2f9bbe22', color: '#2f7a9b' }}>Workspace-based</span>
                        ) : (
                          <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 8, fontWeight: 600, background: 'var(--bg)', color: 'var(--text-muted)' }}>Clássico</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {ai.sampling_percentage == null ? '—' : (
                          <span style={{ fontWeight: 600, color: ai.sampling_percentage < 100 ? '#70AD47' : 'var(--text)' }}>
                            {ai.sampling_percentage.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>{ai.retencao_dias != null ? ai.retencao_dias + ' dias' : '—'}</td>
                      <td>
                        {ai.daily_cap_gb != null ? (
                          <span style={{ fontSize: 10.5, padding: '1px 7px', borderRadius: 8, fontWeight: 600, background: '#ff8c4222', color: '#ff8c42', border: '1px solid #ff8c4255' }}>
                            {ai.daily_cap_gb.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB/dia
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>Sem limite</span>
                        )}
                      </td>
                      <td>
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

      {observabilidadeQuery.data && observabilidadeQuery.data.total > 0 && (() => {
        const o = observabilidadeQuery.data
        const fora = o.total - o.coberto_pela_tela
        return (
        <div className="card" style={{ margin: '0 20px 18px' }}>
          <div className="card-header">
            <span className="card-title">Gasto de observabilidade — todos os medidores (30d)</span>
            <span className="badge">{fmtBRL(o.total)}</span>
          </div>
          <div style={{ padding: '0 20px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
            Esta tela soma o que a Azure carimba no recurso do workspace — {fmtBRL(o.coberto_pela_tela)}, {o.coberto_pct}%
            do gasto de observabilidade. Os {fmtBRL(fora)} restantes são cobrados no recurso de ORIGEM (export para
            Storage/Event Hub, alertas, agentes) e não entram no custo de workspace nenhum.
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr>
                <th>Balde</th><th style={{ textAlign: 'right' }}>Custo</th><th style={{ textAlign: 'right' }}>%</th>
                <th style={{ textAlign: 'right' }}>Nesta tela</th><th>Maior medidor</th>
              </tr></thead>
              <tbody>
                {o.baldes.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>{b.rotulo}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtBRL(b.custo)}</td>
                    <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>{b.pct}%</td>
                    <td style={{ textAlign: 'right', fontSize: 11,
                      color: b.custo_em_workspace > 0 ? undefined : 'var(--orange,#ff8c42)' }}>
                      {b.custo_em_workspace > 0 ? fmtBRL(b.custo_em_workspace) : 'fora'}
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--text-muted)' }}>{b.medidores[0]?.nome || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        )
      })()}

      {(exportQuery.data?.sem_workspace || 0) > 0 && (
        <div className="card" style={{ margin: '0 20px 18px' }}>
          <div className="card-header">
            <span className="card-title">Export de log sem workspace</span>
            <span className="badge" style={{ background: 'var(--orange,#ff8c42)', color: '#fff' }}>
              {fmtBRL(exportQuery.data!.sem_workspace)}/30d
            </span>
          </div>
          <div style={{ padding: '0 20px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
            Diagnostic Settings que mandam para Storage ou Event Hub <strong>sem alimentar nenhum workspace</strong>:
            pagam ingestão e não viram consulta no Log Analytics. A Azure cobra isso no recurso de origem
            ("Platform Logs Data Processed"), por isso não aparece no custo de workspace nenhum.
            De {fmtBRL(exportQuery.data!.total)} de export no período, {fmtBRL(exportQuery.data!.sem_workspace)} não
            alimentam workspace.
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead><tr>
                <th>Recurso</th><th>Tipo</th><th>Destino</th><th style={{ textAlign: 'right' }}>Custo (30d)</th>
              </tr></thead>
              <tbody>
                {exportQuery.data!.itens.filter((x) => !x.alimenta_workspace).slice(0, 15).map((x) => (
                  <tr key={x.recurso_id}>
                    <td style={{ maxWidth: 330 }}>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{x.recurso_id.split('/').pop()}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{x.recurso_id}</div>
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--text-muted)' }}>{x.recurso_tipo || '—'}</td>
                    <td style={{ fontSize: 11 }}>
                      {x.setting_desconhecido ? (
                        <span style={{ color: 'var(--text-muted)' }} title="O Diagnostic Setting deste recurso ainda não foi coletado — tipo fora da lista ou falha na coleta. Não é o mesmo que não ter setting.">
                          não coletado
                        </span>
                      ) : (
                        [x.envia_storage ? 'Storage' : null, x.envia_eventhub ? 'Event Hub' : null]
                          .filter(Boolean).join(' + ') || '—'
                      )}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtBRL(x.custo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {workspaceSelecionado && (() => {
        const recursos = recursosVolumeQuery.data?.recursos || []
        const cobertura = recursosVolumeQuery.data?.cobertura_pct ?? null
        const totalGb = recursos.reduce((a, r) => a + r.gb, 0)
        // Custo por recurso é rateio do custo real do workspace pela participação em GB — mesma
        // lógica já usada por tabela. Não é fatura por recurso: a Azure não cobra nesse nível.
        const custoWs = Number(workspaceSelecionado.custo_mes_ingestao) || 0
        return (
        <div className="card" style={{ margin: '0 20px 18px' }}>
          <div className="card-header">
            <span className="card-title">Recursos por volume — {workspaceSelecionado.nome}</span>
            {recursos.length > 0 && <span className="badge">{recursos.length}</span>}
          </div>
          <div style={{ padding: '0 20px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
            Quem gerou a ingestão nos últimos 30 dias, somando todas as tabelas grandes do workspace — histórico
            acumulado, diferente do "Detalhar por recurso" acima, que é uma consulta ao vivo de 3 dias numa tabela só.
            O custo é rateio da participação em GB, não fatura por recurso: a Azure não cobra nesse nível.
            {cobertura != null && (
              <> <strong style={{ color: cobertura >= 80 ? 'var(--text)' : 'var(--orange,#ff8c42)' }}>
                {cobertura}% do volume dessas tabelas tem recurso identificado
              </strong> — aproximado: o restante chega por agente (DCR), que não carimba o recurso de origem, e a
              Azure ainda revisa o volume por tabela dos dias recentes, então o denominador cresce depois da medição.</>
            )}
            {(recursosVolumeQuery.data?.tabelas_sem_atribuicao?.length ?? 0) > 0 && (
              <div style={{ marginTop: 6 }}>
                Fora da atribuição:{' '}
                {recursosVolumeQuery.data!.tabelas_sem_atribuicao.slice(0, 6).map((t, i) => (
                  <span key={t.tabela}>
                    {i > 0 && ' · '}
                    <strong style={{ color: 'var(--text)' }}>{t.tabela}</strong>{' '}
                    <span title={t.detalhe || ''}>
                      ({fmtGB(t.gb)}, {t.desfecho === 'vazio' ? 'sem recurso carimbado' : 'erro na consulta'})
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
          {recursosVolumeQuery.isLoading ? (
            <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</div>
          ) : recursos.length === 0 ? (
            <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
              Nada acumulado ainda para este workspace — a coleta de ingestão por recurso roda junto com a coleta
              diária do Log Analytics.
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead><tr>
                  <th>Recurso</th><th>Chega por</th><th>Maior tabela</th><th style={{ textAlign: 'right' }}>Tabelas</th>
                  <th style={{ textAlign: 'right' }}>GB (30d)</th><th style={{ textAlign: 'right' }}>% do total</th>
                  <th style={{ textAlign: 'right' }}>Custo (estim.)</th><th></th>
                </tr></thead>
                <tbody>
                  {recursos.slice(0, 50).map((r) => {
                    const pct = totalGb > 0 ? (r.gb / totalGb) * 100 : 0
                    return (
                      <tr key={r.recurso_id}>
                        <td style={{ maxWidth: 330 }}>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{r.recurso_id.split('/').pop()}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', wordBreak: 'break-all' }}>{r.recurso_id}</div>
                        </td>
                        <td>
                          {r.origem === 'diagnostic_setting' ? (
                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Diagnostic Setting</span>
                          ) : r.origem === 'app_insights' ? (
                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>App Insights</span>
                          ) : (
                            <span style={{ fontSize: 10, color: 'var(--orange,#ff8c42)' }}
                              title="Envia, mas não achamos como: normalmente agente via DCR, cuja associação a recursos não é coletada">
                              não mapeado
                            </span>
                          )}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.maior_tabela || '—'}</td>
                        <td style={{ textAlign: 'right', fontSize: 11 }}>{r.tabelas}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtGB(r.gb)}</td>
                        <td style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>{pct.toFixed(1)}%</td>
                        <td style={{ textAlign: 'right' }}>{totalGb > 0 ? fmtBRL(custoWs * (r.gb / totalGb)) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn-ghost" style={{ padding: '1px 6px', fontSize: 10 }}
                            onClick={() => setDiagDoRecurso(r.recurso_id)}
                            title="Ver o Diagnostic Setting configurado neste recurso">
                            ⚙ Diagnostic Setting
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {recursos.length > 50 && (
                <div style={{ padding: '8px 20px', fontSize: 11, color: 'var(--text-muted)' }}>
                  Mostrando os 50 maiores de {recursos.length}.
                </div>
              )}
            </div>
          )}
        </div>
        )
      })()}

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
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tabela</th>
                    <th>Plano</th>
                    <th>Retenção interativa</th>
                    <th>Retenção total</th>
                    <th style={{ textAlign: 'right' }}>Ingestão do mês</th>
                    <th style={{ textAlign: 'right' }}>Custo ingestão (estim.)</th>
                    <th style={{ textAlign: 'right' }}>Custo retenção (estim.)</th>
                    <th style={{ textAlign: 'right' }}>Consultas (30d)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tabelasExibidas.map((t) => {
                    const detalhando = detalharMutation.isPending && detalharMutation.variables?.tabela === t.tabela
                    return (
                    <Fragment key={t.tabela}>
                      <tr>
                        <td>{t.tabela}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{t.plano || '—'}</td>
                        <td>{t.retencao_dias != null ? t.retencao_dias + ' dias' : '—'}</td>
                        <td>
                          {t.retencao_total_dias != null ? t.retencao_total_dias + ' dias' : '—'}
                          {t.retencao_e_padrao === false && (
                            <span style={{
                              marginLeft: 6, background: '#ff8c4222', color: '#ff8c42', border: '1px solid #ff8c4255',
                              padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600,
                            }}>customizada</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>{fmtGB(t.gb_mes)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtBRL(t.custo_ingestao_estimado)}</td>
                        <td style={{ textAlign: 'right', color: t.custo_retencao_estimado > 0 ? 'var(--orange,#ff8c42)' : undefined }}>
                          {fmtBRL(t.custo_retencao_estimado)}
                        </td>
                        <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>
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
                        <td>
                          <button className="btn-ghost" style={{ padding: '2px 8px', fontSize: 10 }}
                            disabled={detalhando} onClick={() => detalharMutation.mutate({ tabela: t.tabela, limite: 20 })}
                            title="Roda uma query KQL pontual (janela de 3 dias) contra a tabela de log real — diferente do resto da tela, isso consome uma query de verdade">
                            {detalhando ? '...' : 'Detalhar por recurso'}
                          </button>
                        </td>
                      </tr>
                      {detalheRecurso?.tabela === t.tabela && (
                        <tr>
                          <td colSpan={9} style={{ padding: '4px 8px 12px 24px', background: 'var(--bg)' }}>
                            <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                              <span>
                                {detalheRecurso.recursos.length} recurso(s) em {t.tabela} — últimos {detalheRecurso.janelaDias} dias
                                (query pontual, não é dado pré-coletado)
                              </span>
                              {/* O `top N` só trunca a saída: o scan dos 3 dias já aconteceu, então pedir
                                  todos não custa uma consulta mais cara, só um payload maior. O botão só
                                  aparece quando a lista encostou no limite — sinal de que há mais. */}
                              {detalheRecurso.recursos.length >= detalheRecurso.limite && (
                                <button className="btn-ghost" style={{ padding: '1px 8px', fontSize: 10 }}
                                  disabled={detalhando}
                                  onClick={() => detalharMutation.mutate({ tabela: t.tabela, limite: 5000 })}
                                  title="Refaz a consulta sem o corte dos 20 primeiros">
                                  {detalhando ? '...' : 'Ver todos os recursos'}
                                </button>
                              )}
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
                                      <td style={{ padding: '2px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                        <button className="btn-ghost" style={{ padding: '1px 6px', fontSize: 10 }}
                                          onClick={() => setDiagDoRecurso(r.resource_id)}
                                          title="Ver o Diagnostic Setting configurado neste recurso">
                                          ⚙ Diagnostic Setting
                                        </button>
                                      </td>
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
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Mecanismo</th>
                    <th>Tipo / Nome</th>
                    <th style={{ textAlign: 'right' }}>Recursos / Streams</th>
                    <th>Categorias / Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {fontes.map((f, idx) => (
                    <tr key={idx}>
                      <td>
                        <span style={{
                          fontSize: 10.5, padding: '1px 7px', borderRadius: 8, fontWeight: 600,
                          background: f.mecanismo === 'Diagnostic Setting' ? '#7b2fbe22' : '#2f9bbe22',
                          color: f.mecanismo === 'Diagnostic Setting' ? '#7b2fbe' : '#2f9bbe',
                        }}>{f.mecanismo}</span>
                      </td>
                      <td>{f.tipo}</td>
                      <td style={{ textAlign: 'right', fontFamily: "'IBM Plex Mono', monospace" }}>{f.contagem}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{f.detalhe || '—'}</td>
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
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Recurso</th>
                    <th>Config.</th>
                    <th>Categorias habilitadas</th>
                    <th>Categorias desabilitadas</th>
                    <th>Métricas habilitadas</th>
                    <th>Métricas desabilitadas</th>
                    <th>Também envia p/</th>
                  </tr>
                </thead>
                <tbody>
                  {diagSettings.map((d, idx) => {
                    const habilitadas = (d.categorias_habilitadas || '').split(';').map((c) => c.trim()).filter(Boolean)
                    const metricasHabilitadas = (d.metricas_habilitadas || '').split(';').map((c) => c.trim()).filter(Boolean)
                    return (
                      <tr key={idx}>
                        <td style={{ maxWidth: 260 }}>
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
                        <td style={{ color: 'var(--text-muted)' }}>{d.nome_config || '—'}</td>
                        <td>
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
                        <td style={{ color: 'var(--text-muted)', fontSize: 11, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.categorias_desabilitadas || ''}>
                          {d.categorias_desabilitadas || '—'}
                        </td>
                        <td>
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
                        <td style={{ color: 'var(--text-muted)', fontSize: 11, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.metricas_desabilitadas || ''}>
                          {d.metricas_desabilitadas || '—'}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>
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
      {diagDoRecurso && (() => {
        // O workspace selecionado já teve seus Diagnostic Settings carregados (diagSettingsQuery),
        // então a busca é local — nada de ida nova ao servidor. Um recurso pode ter mais de uma
        // configuração, por isso filtra em vez de procurar a primeira.
        const achados = (diagSettingsQuery.data || []).filter(
          (d) => d.recurso_id.toUpperCase() === diagDoRecurso.toUpperCase(),
        )
        const nome = diagDoRecurso.split('/').pop()
        return (
          <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && setDiagDoRecurso(null)}>
            <div className="modal modal-wide" style={{ maxWidth: 820 }}>
              <div className="modal-header">
                <span>⚙ Diagnostic Setting — {nome}</span>
                <button className="modal-close" aria-label="Fechar" onClick={() => setDiagDoRecurso(null)}>✕</button>
              </div>
              <div className="modal-body" style={{ padding: 20 }}>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', wordBreak: 'break-all', marginBottom: 14 }}>{diagDoRecurso}</div>
                {achados.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    Nenhum Diagnostic Setting deste recurso apontando para <strong>{workspaceSelecionado?.nome}</strong>.
                    <br />Isso não significa erro: o recurso pode estar enviando por uma <strong>Data Collection Rule</strong>
                    {' '}(agente), que é outro caminho e não aparece aqui. Também pode ser um tipo fora da lista coletada, ou
                    ter sido configurado depois da última coleta — ela roda semanalmente.
                  </div>
                ) : achados.map((d, i) => (
                  <div key={i} style={{ marginBottom: i < achados.length - 1 ? 18 : 0, paddingBottom: i < achados.length - 1 ? 18 : 0, borderBottom: i < achados.length - 1 ? '1px solid var(--border)' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 13 }}>{d.nome_config || '(sem nome)'}</strong>
                      {d.recurso_tipo && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.recurso_tipo}</span>}
                      {d.outros_workspaces?.length ? (
                        <span title={'Também envia para: ' + d.outros_workspaces.join(', ')}
                          style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, color: 'var(--orange,#ff8c42)', background: 'rgba(255,140,66,.12)' }}>
                          fan-out: +{d.outros_workspaces.length} workspace(s)
                        </span>
                      ) : null}
                    </div>
                    <table className="data-table" style={{ fontSize: 11.5 }}>
                      <tbody>
                        {[
                          ['Categorias habilitadas', d.categorias_habilitadas],
                          ['Categorias desabilitadas', d.categorias_desabilitadas],
                          ['Grupos de categoria', d.grupos_categoria],
                          ['Métricas habilitadas', d.metricas_habilitadas],
                          ['Métricas desabilitadas', d.metricas_desabilitadas],
                        ].map(([rot, val]) => (
                          <tr key={rot as string}>
                            <td style={{ width: 200, color: 'var(--text-muted)' }}>{rot}</td>
                            <td style={{ wordBreak: 'break-word' }}>{val || '—'}</td>
                          </tr>
                        ))}
                        <tr>
                          <td style={{ color: 'var(--text-muted)' }}>Outros destinos</td>
                          <td>
                            {d.envia_storage || d.envia_eventhub
                              ? [d.envia_storage && 'Storage', d.envia_eventhub && 'Event Hub'].filter(Boolean).join(' + ')
                              : 'só Log Analytics'}
                          </td>
                        </tr>
                        <tr>
                          <td style={{ color: 'var(--text-muted)' }}>Coletado em</td>
                          <td>{new Date(d.atualizado_em).toLocaleString('pt-BR')}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}
      {consumoModalWorkspace && (
        <LogAnalyticsConsumoModal
          workspaceGuid={consumoModalWorkspace.workspace_guid}
          workspaceNomeFallback={consumoModalWorkspace.nome || consumoModalWorkspace.resource_id}
          mes={mes}
          mesLabel={mesLabel}
          onClose={() => setConsumoModalWorkspace(null)}
        />
      )}
    </div>
  )
}
