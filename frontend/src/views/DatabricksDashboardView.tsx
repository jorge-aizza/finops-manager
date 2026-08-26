import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteDatabricksBudget, getDatabricksResumo, listDatabricksBudgets, updateDatabricksBudget } from '../api/databricksColeta'
import type { DatabricksBudget } from '../types/databricksResumo'
import DatabricksBudgetModal from '../components/DatabricksBudgetModal'

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
function RankingCard({ title, color, items, labelKey, hint }: {
  title: string
  color: string
  items: { custo: number; [k: string]: unknown }[]
  labelKey: string
  hint?: string
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
          return (
            <div key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }} title={String(item[labelKey])}>
                  {String(item[labelKey])}
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

// Sparkline SVG simples (sem lib) — linha 2px, sem eixo/grade decorada.
// Rótulo direto só no primeiro/último/pico (regra "rótulos seletivos, nunca
// em todo ponto"); tooltip nativo via <title> em cada ponto substitui a
// camada de hover custom que uma lib de gráfico daria de graça.
function TrendSparkline({ data }: { data: { mes: string; custo: number }[] }) {
  if (data.length === 0) return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '0 20px 16px' }}>Sem dados no período.</div>
  const W = 600, H = 120, PAD = 8
  const max = Math.max(1, ...data.map((d) => d.custo))
  const step = data.length > 1 ? (W - PAD * 2) / (data.length - 1) : 0
  const pts = data.map((d, i) => ({ x: PAD + i * step, y: H - PAD - (d.custo / max) * (H - PAD * 2), ...d }))
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p.x + ',' + p.y).join(' ')
  const maxIdx = data.reduce((best, d, i) => (d.custo > data[best].custo ? i : best), 0)

  return (
    <div style={{ padding: '0 20px 16px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 140 }} preserveAspectRatio="none">
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill="var(--accent)">
            <title>{p.mes}: {fmtBRL(p.custo)}</title>
          </circle>
        ))}
        {[0, maxIdx, pts.length - 1].map((i) => (
          <text key={i} x={pts[i].x} y={Math.max(10, pts[i].y - 8)} fontSize={10} fill="var(--text-muted)" textAnchor="middle">
            {fmtBRL(pts[i].custo)}
          </text>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: -4 }}>
        <span>{data[0].mes}</span>
        <span>{data[data.length - 1].mes}</span>
      </div>
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

export default function DatabricksDashboardView() {
  const queryClient = useQueryClient()
  const [periodo, setPeriodo] = useState(defaultPeriodo)
  const [inicioInput, setInicioInput] = useState(periodo.inicio)
  const [fimInput, setFimInput] = useState(periodo.fim)

  const resumoQuery = useQuery({
    queryKey: ['databricks-resumo', periodo.inicio, periodo.fim],
    queryFn: () => getDatabricksResumo(periodo.inicio, periodo.fim),
  })

  const budgetsQuery = useQuery({ queryKey: ['databricks-budgets'], queryFn: listDatabricksBudgets })
  const [budgetModalOpen, setBudgetModalOpen] = useState(false)
  const [editingBudget, setEditingBudget] = useState<DatabricksBudget | null>(null)

  const toggleAtivoMutation = useMutation({
    mutationFn: (b: DatabricksBudget) => updateDatabricksBudget(b.id, { nome: b.nome, workspace_id: b.workspace_id, valor_mensal: b.valor_mensal, ativo: !b.ativo }),
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
  const workspaces = (resumo?.por_workspace || []).map((w) => w.workspace_id)
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
            <TrendSparkline data={resumo.por_mes} />
          </div>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <RankingCard title="Por Workspace" color="var(--accent)" items={resumo.por_workspace} labelKey="workspace_id" />
            <RankingCard title="Por SKU" color="var(--blue,#4da6ff)" items={resumo.por_sku} labelKey="sku_name" />
            <RankingCard title="Por Usuário" color="var(--green,#22c55e)" items={resumo.por_usuario} labelKey="usuario" hint="Usuário vem de identity_metadata.run_as (System Tables)" />
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
          Alerta é disparado ao entrar no sistema quando o consumo do mês corrente passa de 75% do valor mensal.
        </div>
        <div className="table-wrapper">
          <table className="data-table">
            <thead><tr><th>Nome</th><th>Escopo</th><th>Valor Mensal</th><th>Ativo</th><th>Ações</th></tr></thead>
            <tbody>
              {(budgetsQuery.data || []).map((b) => (
                <tr key={b.id}>
                  <td>{b.nome}</td>
                  <td>{b.workspace_id || 'Todos os workspaces'}</td>
                  <td>{fmtBRL(b.valor_mensal)}</td>
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
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Nenhum orçamento cadastrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {budgetModalOpen && (
        <DatabricksBudgetModal budget={editingBudget} workspaces={workspaces} onClose={() => setBudgetModalOpen(false)} />
      )}
    </div>
  )
}
