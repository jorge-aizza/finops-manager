import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteDatabricksBudget, getDatabricksAnomalias, getDatabricksResumo, listDatabricksBudgets, updateDatabricksBudget, type DatabricksResumoFiltros } from '../api/databricksColeta'
import type { DatabricksBudget } from '../types/databricksResumo'
import DatabricksBudgetModal from '../components/DatabricksBudgetModal'
import { forecastLinear } from '../lib/forecastLinear'

function escopoLabel(b: DatabricksBudget): string {
  if (b.escopo_tipo === 'workspace') return b.workspace_id || '—'
  if (b.escopo_tipo === 'tag') return `${b.tag_key} = ${b.tag_valor}`
  return 'Todos os workspaces'
}

function fmtBRL(v: number): string {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
function RankingCard({ title, color, items, hint, activeValue, onToggle }: {
  title: string
  color: string
  items: { custo: number; label: string; value: string }[]
  hint?: string
  activeValue?: string | null
  onToggle?: (value: string) => void
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
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                  {item.label}
                </span>
                {i < 3 && <span style={{ fontWeight: 700, color }}>{fmtBRL(item.custo)}</span>}
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
// ver frontend/src/lib/forecastLinear.ts) anexado como barras extras. Forecast usa
// textura hachurada + borda tracejada (não só uma cor mais clara) — é a distinção
// categórica "real vs. previsto", não uma questão de magnitude, então a regra do
// skill dataviz de usar textura pro caso CVD/impressão se aplica bem aqui: quem não
// distingue as duas cores ainda vê a hachura. Rótulos de valor só nas barras de
// previsão + na última barra real (regra "rótulos seletivos, nunca em todo ponto") —
// o histórico completo já está disponível via tooltip nativo (<title>).
function MonthlyBarChart({ data }: { data: { mes: string; custo: number }[] }) {
  if (data.length === 0) return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 20px 16px' }}>Sem dados no período.</div>

  const serie = forecastLinear(data, 3)
  const temPrevisao = serie.some((d) => d.previsto)

  const W = 640, H = 190, PAD_TOP = 26, PAD_BOTTOM = 30, PAD_SIDE = 10
  const plotH = H - PAD_TOP - PAD_BOTTOM
  const max = Math.max(1, ...serie.map((d) => d.custo))
  const slot = (W - PAD_SIDE * 2) / serie.length
  const barW = Math.max(6, slot * 0.55)
  const destacar = data.length - 1 // última barra real

  return (
    <div style={{ padding: '0 20px 16px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 210 }}>
        <defs>
          <pattern id="dbxForecastHatch" width={6} height={6} patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
            <rect width={6} height={6} fill="var(--accent)" fillOpacity={0.10} />
            <line x1={0} y1={0} x2={0} y2={6} stroke="var(--accent)" strokeWidth={2} strokeOpacity={0.4} />
          </pattern>
        </defs>
        {serie.map((d, i) => {
          const x = PAD_SIDE + i * slot + (slot - barW) / 2
          const h = (d.custo / max) * plotH
          const y = H - PAD_BOTTOM - h
          const mostrarValor = d.previsto || i === destacar
          return (
            <g key={d.mes}>
              <rect
                x={x} y={y} width={barW} height={Math.max(1, h)} rx={3}
                fill={d.previsto ? 'url(#dbxForecastHatch)' : 'var(--accent)'}
                stroke={d.previsto ? 'var(--accent)' : 'none'}
                strokeWidth={d.previsto ? 1.5 : 0}
                strokeDasharray={d.previsto ? '3,2' : undefined}
              >
                <title>{mesLabel(d.mes)}: {fmtBRL(d.custo)}{d.previsto ? ' (previsão — tendência linear)' : ''}</title>
              </rect>
              {mostrarValor && (
                <text x={x + barW / 2} y={Math.max(10, y - 6)} fontSize={9.5} fill="var(--text-muted)" textAnchor="middle">
                  {fmtBRL(d.custo)}
                </text>
              )}
              <text x={x + barW / 2} y={H - PAD_BOTTOM + 14} fontSize={10} fill="var(--text-muted)" textAnchor="middle">
                {mesLabel(d.mes)}
              </text>
            </g>
          )
        })}
      </svg>
      {temPrevisao && (
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--accent)', borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />Real</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, border: '1.5px dashed var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', borderRadius: 2, marginRight: 4, verticalAlign: -1 }} />Previsão (tendência linear, 3 meses)</span>
        </div>
      )}
    </div>
  )
}

// Últimos 6 meses — mesmo default usado no servidor (GET /resumo sem
// data_inicio/data_fim) — calculado aqui também pra inicializar os
// date-pickers já em sincronia com a primeira busca, sem precisar de um
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
}
function labelFiltroValor(campo: keyof DatabricksResumoFiltros, valor: string): string {
  if (campo === 'usuario' && valor === '__vazio__') return 'Não identificado'
  return valor
}

export default function DatabricksDashboardView() {
  const queryClient = useQueryClient()
  const [periodo, setPeriodo] = useState(defaultPeriodo)
  const [inicioInput, setInicioInput] = useState(periodo.inicio)
  const [fimInput, setFimInput] = useState(periodo.fim)
  const [filtros, setFiltros] = useState<DatabricksResumoFiltros>({})

  const resumoQuery = useQuery({
    queryKey: ['databricks-resumo', periodo.inicio, periodo.fim, filtros.workspace_id, filtros.sku_name, filtros.usuario],
    queryFn: () => getDatabricksResumo(periodo.inicio, periodo.fim, filtros),
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
  const workspaces = (workspacesQuery.data?.por_workspace || []).map((w) => w.workspace_id)

  function toggleFiltro(campo: keyof DatabricksResumoFiltros, valor: string) {
    setFiltros((f) => (f[campo] === valor ? { ...f, [campo]: undefined } : { ...f, [campo]: valor }))
  }

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
      tag_key: b.tag_key, tag_valor: b.tag_valor, valor_mensal: b.valor_mensal,
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="view-hero">
        <div className="page-title">Dashboard Databricks</div>
        <div className="view-hero-sub">Consumo mensal, custo por workspace/SKU/usuário, free-tier vs. pago e orçamentos</div>
      </div>

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
        {resumoQuery.isFetching && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Carregando...</span>}
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
                {FILTRO_LABELS[campo]}: {labelFiltroValor(campo, valor)} ✕
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
              <div className="stat-value">{fmtBRL(resumo.total_custo)}</div>
              <div className="stat-sub">{resumo.periodo.inicio} → {resumo.periodo.fim}</div>
            </div>
            <div className="stat-card green-card">
              <div className="stat-label">Free-tier</div>
              <div className="stat-value green">{fmtBRL(totalFree)}</div>
              <div className="stat-sub">{pctFree}% do consumo</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Pago</div>
              <div className="stat-value">{fmtBRL(totalPago)}</div>
              <div className="stat-sub">{100 - pctFree}% do consumo</div>
            </div>
          </div>

          {totalFreePago > 0 && (
            <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', border: '1px solid var(--border)' }}>
              <div style={{ width: pctFree + '%', background: 'var(--green,#22c55e)' }} title={`Free-tier: ${fmtBRL(totalFree)}`} />
              <div style={{ width: (100 - pctFree) + '%', background: 'var(--accent)' }} title={`Pago: ${fmtBRL(totalPago)}`} />
            </div>
          )}

          <div className="card">
            <div className="card-header"><span className="card-title">Tendência Mensal</span></div>
            <MonthlyBarChart data={resumo.por_mes} />
          </div>

          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            🔍 Clique num item de Workspace, SKU ou Usuário para detalhar os demais números por esse filtro — clique de novo pra remover.
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <RankingCard
              title="Por Workspace"
              color="var(--accent)"
              items={resumo.por_workspace.map((w) => ({ custo: w.custo, label: w.workspace_id, value: w.workspace_id }))}
              activeValue={filtros.workspace_id ?? null}
              onToggle={(v) => toggleFiltro('workspace_id', v)}
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
              items={resumo.por_usuario.map((u) => ({ custo: u.custo, label: u.usuario, value: u.usuario === 'Não identificado' ? '__vazio__' : u.usuario }))}
              hint="Usuário vem de identity_metadata.run_as (System Tables)"
              activeValue={filtros.usuario ?? null}
              onToggle={(v) => toggleFiltro('usuario', v)}
            />
          </div>
        </>
      )}

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
                  <td>{escopoLabel(b)}</td>
                  <td>{fmtBRL(b.valor_mensal)}</td>
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

      <AnomaliasCard />

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
function AnomaliasCard() {
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
                  <td>{a.escopo_tipo === 'workspace' ? a.escopo_valor : 'Global'}</td>
                  <td>
                    {new Date(a.usage_date + 'T00:00:00').toLocaleDateString('pt-BR')} — {fmtBRL(a.custo)}
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> (média {fmtBRL(a.media)})</span>
                  </td>
                  <td style={{ color: 'var(--orange,#ff8c42)', fontWeight: 700 }}>Z {a.zscore >= 0 ? '+' : ''}{a.zscore.toFixed(2)}</td>
                </tr>
              ))}
              {anomalias.usuarios.map((u, i) => (
                <tr key={'us' + i}>
                  <td>👤 Usuário</td>
                  <td>{u.usuario}</td>
                  <td>
                    Últimos 7 dias: {fmtBRL(u.custo_recente)}
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> (histórico: {fmtBRL(u.media_diaria_historica)}/dia)</span>
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
