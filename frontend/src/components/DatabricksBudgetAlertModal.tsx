import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDatabricksAlertas } from '../api/databricksColeta'
import type { DatabricksAlertaSeveridade, DatabricksBudget } from '../types/databricksResumo'

function escopoLabel(b: DatabricksBudget): string {
  if (b.escopo_tipo === 'workspace') return b.workspace_id || '—'
  if (b.escopo_tipo === 'tag') return `${b.tag_key} = ${b.tag_valor}`
  return 'Todos os workspaces'
}

// Porta do padrão de checkRsvAlertsPopup (app.js:423-480, Reservas) pra orçamentos
// Databricks: popup ao entrar no app quando algum orçamento ativo passou de 75% do
// mês corrente. Diferença deliberada: o original não tem nenhum guard de sessão real
// (o comentário no legado promete "uma vez por sessão" mas não há um) — aqui uso
// sessionStorage pra não repetir o mesmo alerta a cada navegação de view, já que isso
// é código novo, não uma porta 1:1 (o gap do Reservas é um bug documentado, não uma
// característica a replicar).
const DISMISSED_KEY = 'databricks_alertas_dismissed'

const SEVERIDADE_INFO: Record<DatabricksAlertaSeveridade, { label: string; cor: string }> = {
  estourado: { label: 'Estourado', cor: 'var(--red,#ff4d6a)' },
  critico: { label: 'Crítico', cor: 'var(--orange,#ff8c42)' },
  atencao: { label: 'Atenção', cor: '#f5c518' },
}

function readDismissed(): Set<number> {
  try { return new Set(JSON.parse(sessionStorage.getItem(DISMISSED_KEY) || '[]')) } catch { return new Set() }
}

export default function DatabricksBudgetAlertModal() {
  const alertasQuery = useQuery({ queryKey: ['databricks-alertas'], queryFn: getDatabricksAlertas })
  const [dismissed, setDismissed] = useState<Set<number>>(readDismissed)

  // Derivado direto da query + do estado de dismissed — nada de useEffect
  // pra "abrir": some sozinho assim que o dismissed cobre todos os ids
  // retornados, sem precisar de um booleano `open` espelhando isso.
  const alertas = (alertasQuery.data || []).filter((a) => !dismissed.has(a.budget.id))

  function fechar() {
    const novo = new Set(dismissed)
    for (const a of alertasQuery.data || []) novo.add(a.budget.id)
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...novo]))
    setDismissed(novo)
  }

  if (alertas.length === 0) return null

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && fechar()}>
      <div className="modal">
        <div className="modal-header">
          <span>⚠ Orçamentos Databricks</span>
          <button className="modal-close" aria-label="Fechar" onClick={fechar}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
            {alertas.length === 1 ? '1 orçamento atingiu' : `${alertas.length} orçamentos atingiram`} o limite de alerta configurado.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {alertas.map((a) => {
              const info = SEVERIDADE_INFO[a.severidade]
              const pctFmt = ((a.pct ?? 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })
              return (
                <div
                  key={a.budget.id}
                  style={{
                    border: `1px solid color-mix(in srgb, ${info.cor} 35%, transparent)`,
                    background: `color-mix(in srgb, ${info.cor} 8%, transparent)`,
                    borderRadius: 8, padding: '10px 14px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <strong style={{ fontSize: 13 }}>{a.budget.nome}</strong>
                    <span style={{ fontSize: 11, fontWeight: 700, color: info.cor, border: `1px solid ${info.cor}`, borderRadius: 8, padding: '1px 8px' }}>
                      {info.label} · {pctFmt}%
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {escopoLabel(a.budget)} — R$ {(a.custo_atual ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                    {' de R$ '}{(a.budget.valor_mensal ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-primary" onClick={fechar}>Entendi</button>
        </div>
      </div>
    </div>
  )
}
