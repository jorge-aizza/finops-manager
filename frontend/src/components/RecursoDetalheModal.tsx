import { useQuery } from '@tanstack/react-query'
import { getAzureRecursoDetalhe } from '../api/azureInventario'
import type { AzureAuditoriaAcao } from '../types/azureInventario'

// Detalhe de um recurso — timeline completa de eventos (2026-08-30, pedido do usuário:
// "abrir detalhes do recurso que sofreu alteração"). Aberto ao clicar num recurso na aba
// Recursos, num evento na aba Auditoria, ou num item do Comparativo.

function fmtBRL(v: number): string {
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtData(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const ACAO_BADGE: Record<AzureAuditoriaAcao, { color: string; bg: string; label: string }> = {
  CRIACAO: { color: 'var(--green,#22c55e)', bg: 'rgba(34,197,94,.10)', label: '✚ Criação' },
  ATUALIZACAO: { color: 'var(--blue,#4da6ff)', bg: 'rgba(77,166,255,.10)', label: '✎ Atualização' },
  EXCLUSAO: { color: 'var(--red,#ff4d6a)', bg: 'rgba(255,77,106,.10)', label: '✕ Exclusão' },
}

export default function RecursoDetalheModal({ resourceId, subscriptionId, onClose }: {
  resourceId: string
  subscriptionId: string
  onClose: () => void
}) {
  const q = useQuery({
    queryKey: ['azure-inv-recurso-detalhe', subscriptionId, resourceId],
    queryFn: () => getAzureRecursoDetalhe(resourceId, subscriptionId),
  })
  const data = q.data

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <span>Detalhe do Recurso</span>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {q.isLoading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>Carregando...</div>}
          {q.isError && <div style={{ padding: 20, textAlign: 'center', color: 'var(--red,#ff4d6a)' }}>Recurso não encontrado no inventário.</div>}

          {data && (
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 700, wordBreak: 'break-all' }}>{data.recurso.nome || data.recurso.resource_id}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-all', marginTop: 2 }}>{data.recurso.resource_id}</div>
              </div>

              <div className="stats-grid" style={{ marginBottom: 16, gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="stat-card" style={{ overflow: 'visible' }}>
                  <div className="stat-label">Tipo</div>
                  <div className="stat-value" style={{ fontSize: 13, lineHeight: 1.3, wordBreak: 'break-word' }}>{data.recurso.resource_type || '—'}</div>
                </div>
                <div className="stat-card" style={{ overflow: 'visible' }}>
                  <div className="stat-label">Resource Group</div>
                  <div className="stat-value" style={{ fontSize: 13, lineHeight: 1.3, wordBreak: 'break-word' }}>{data.recurso.resource_group || '—'}</div>
                </div>
                <div className="stat-card" style={{ overflow: 'visible' }}>
                  <div className="stat-label">Custo direto</div>
                  <div className="stat-value" style={{ fontSize: 20, wordBreak: 'break-word' }}>{fmtBRL(data.recurso.custo_acumulado)}</div>
                </div>
              </div>

              {data.recurso.custo_acumulado === 0 && data.custo_resource_group > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 16 }}>
                  💡 Custo direto zerado, mas o Resource Group <strong style={{ color: 'var(--text)' }}>{data.recurso.resource_group}</strong> acumulou{' '}
                  <strong style={{ color: 'var(--text)' }}>{fmtBRL(data.custo_resource_group)}</strong> em {data.resource_group_recursos} recurso{data.resource_group_recursos !== 1 ? 's' : ''} diferentes.
                  Isso é normal pra VMs/discos/NICs de cluster (Databricks, AKS) — a Azure recria essas instâncias em questão de horas,
                  então o resource_id exato raramente sobrevive tempo suficiente até o billing ser publicado (~2-3 dias de atraso). O custo do
                  Resource Group inteiro é o número que reflete o ambiente de verdade.
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, marginBottom: 16 }}>
                <div>Criado por <strong>{data.recurso.criado_por_nome || data.recurso.criado_por || 'desconhecido'}</strong> em {fmtData(data.recurso.criado_em)}</div>
                {data.recurso.atualizado_em && (
                  <div>Última atualização por <strong>{data.recurso.atualizado_por_nome || data.recurso.atualizado_por || 'desconhecido'}</strong> em {fmtData(data.recurso.atualizado_em)}</div>
                )}
                {!data.recurso.ativo && (
                  <div style={{ color: 'var(--red,#ff4d6a)' }}>Excluído por <strong>{data.recurso.excluido_por_nome || data.recurso.excluido_por || 'desconhecido'}</strong> em {fmtData(data.recurso.excluido_em)}</div>
                )}
              </div>

              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Linha do tempo ({data.eventos.length} evento{data.eventos.length !== 1 ? 's' : ''})</div>
              <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                {data.eventos.length === 0 && (
                  <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                    Nenhum evento de auditoria disponível — pode ter sido removido pela retenção configurável, ou o recurso já existia antes da primeira coleta.
                  </div>
                )}
                {data.eventos.map((ev) => {
                  const b = ACAO_BADGE[ev.acao]
                  return (
                    <div key={ev.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                      <span style={{ background: b.bg, color: b.color, padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, flexShrink: 0 }}>{b.label}</span>
                      <span style={{ flex: 1 }}>{ev.autor_nome || ev.autor || 'desconhecido'}</span>
                      <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{fmtData(ev.quando)}</span>
                    </div>
                  )
                })}
              </div>

              {data.custo_diario.length > 0 && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, margin: '16px 0 8px' }}>Custo — últimos 90 dias</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Total no período: <strong style={{ color: 'var(--text)' }}>{fmtBRL(data.custo_diario.reduce((s, d) => s + d.custo, 0))}</strong> ({data.custo_diario.length} dia{data.custo_diario.length !== 1 ? 's' : ''} com custo)
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
