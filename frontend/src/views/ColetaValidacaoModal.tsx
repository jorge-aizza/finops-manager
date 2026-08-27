import { useMutation, useQueryClient } from '@tanstack/react-query'
import { validarHistorico } from '../api/coleta'
import { validarHistoricoDatabricks } from '../api/databricksColeta'
import type { HistoricoItem } from '../types/coleta'

interface Props {
  item: HistoricoItem
  // 'databricks' — mesmo modal, mas chama a rota de validação da Coleta
  // Databricks (2026-08-27, paridade com a Coleta Azure) em vez da de Azure,
  // e troca o rótulo "Subscriptions" por "Workspaces" (Databricks não tem o
  // conceito de lista de subscriptions esperada — ver _validarColetaDatabricks).
  fonte?: 'azure' | 'databricks'
  onClose: () => void
}

const STATUS_CFG: Record<string, { color: string; label: string }> = {
  ok: { color: 'var(--green)', label: '✅ OK — dados íntegros' },
  aviso: { color: 'var(--orange)', label: '⚠ Aviso — dados parciais' },
  falha: { color: 'var(--danger)', label: '❌ Falha — sem dados' },
  inconclusivo: { color: 'var(--text-muted)', label: '— Inconclusivo' },
}

function fmtNum(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString('pt-BR')
}
function fmtBrl(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
}

// Porta de verValidacaoColeta()/revalidarColeta() (app.js:6339-6438) — resumo
// de integridade de uma coleta já concluída (registros/custo/dias com dados/
// subscriptions sem dados) + botão pra rodar a validação sob demanda.
export default function ColetaValidacaoModal({ item, fonte = 'azure', onClose }: Props) {
  const queryClient = useQueryClient()
  const revalidarMutation = useMutation({
    mutationFn: () => (fonte === 'databricks' ? validarHistoricoDatabricks(item.id) : validarHistorico(item.id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['coleta-historico'] }),
    onError: (e: Error) => window.showToast?.('Erro ao revalidar: ' + e.message, 'error'),
  })
  const rotuloEscopo = fonte === 'databricks' ? 'Workspaces' : 'Subscriptions'

  const vs = revalidarMutation.data?.validacao_status ?? item.validacao_status
  const vj = revalidarMutation.data?.validacao_json ?? item.validacao_json
  const sc = (vs && STATUS_CFG[vs]) || { color: 'var(--text-muted)', label: '— Não validado' }

  const pIni = item.periodo_inicio ? new Date(item.periodo_inicio).toLocaleDateString('pt-BR') : null
  const pFim = item.periodo_fim ? new Date(item.periodo_fim).toLocaleDateString('pt-BR') : null
  const periodo = pIni && pFim ? `${pIni} → ${pFim}` : '—'

  const diasOk = vj ? (vj.dias_com_dados ?? 0) >= Math.floor((vj.dias_esperados || 1) * 0.85) : true
  const subsOk = vj ? (!vj.subs_esperadas || (vj.subs_sem_dados?.length ?? 0) === 0) : true
  const validEm = vj?.validado_em ? new Date(vj.validado_em).toLocaleString('pt-BR') : '—'

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-wide" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <span>Validação — Coleta #{item.id}</span>
          <button className="modal-close" aria-label="Fechar modal" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {revalidarMutation.isPending ? (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 12 }}>Validando dados no banco…</div>
          ) : !vs || !vj ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 12 }}>
              Coleta sem validação registrada.<br />
              <button className="btn-primary" style={{ marginTop: 14, fontSize: 12, padding: '7px 18px' }} onClick={() => revalidarMutation.mutate()}>
                🔍 Validar agora
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,.04)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: sc.color }}>{sc.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Período: {periodo} · Validado em: {validEm}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Registros</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{fmtNum(vj.total_registros)}</div>
                </div>
                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Custo total</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>R$ {fmtBrl(vj.custo_total)}</div>
                </div>
                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,.03)', border: '1px solid ' + (diasOk ? 'var(--border)' : 'var(--orange)') }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>Dias com dados</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: diasOk ? 'var(--green)' : 'var(--orange)' }}>{vj.dias_com_dados} / {vj.dias_esperados}</div>
                  {!diasOk && <div style={{ fontSize: 10, color: 'var(--orange)', marginTop: 2 }}>abaixo de 85% — pode ser lag</div>}
                </div>
                {vj.subs_esperadas ? (
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,.03)', border: '1px solid ' + (subsOk ? 'var(--border)' : 'var(--danger)') }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{rotuloEscopo}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: subsOk ? 'var(--green)' : 'var(--danger)' }}>{vj.subs_com_dados} / {vj.subs_esperadas}</div>
                  </div>
                ) : (
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,255,255,.03)', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>{rotuloEscopo}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{fmtNum(vj.subs_com_dados)}</div>
                  </div>
                )}
              </div>
              {(vj.subs_sem_dados?.length ?? 0) > 0 && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,77,106,.06)', border: '1px solid rgba(255,77,106,.25)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--danger)', marginBottom: 6 }}>❌ Subscriptions sem dados ({vj.subs_sem_dados!.length})</div>
                  {vj.subs_sem_dados!.map((s) => <div key={s} style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'monospace', padding: '2px 0' }}>{s}</div>)}
                </div>
              )}
              {(vj.dias_sem_dados?.length ?? 0) > 0 && (
                <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,140,66,.06)', border: '1px solid rgba(255,140,66,.20)' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--orange)', marginBottom: 6 }}>
                    ⚠ Dias sem dados ({vj.dias_sem_dados!.length}{vj.dias_sem_dados!.length === 31 ? '+' : ''})
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.8 }}>
                    {vj.dias_sem_dados!.map((d) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR')).join(' · ')}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
                <button className="btn-ghost" style={{ fontSize: 12, padding: '6px 16px' }} onClick={() => revalidarMutation.mutate()}>
                  🔍 Revalidar
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  )
}
