import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAzureRecursoDetalhe, getAzureRecursoArmDetalhe, getAzurePropriedadeHistorico } from '../api/azureInventario'
import { listSubscriptions } from '../api/calculadora'
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

// Impacto de custo (2026-09-03, "mostrar o impacto de custo estimado") — decisão de design: NÃO
// usar preço de tabela (a Price List não guarda `armSkuName`, só um nome "bonito" da Retail
// Prices API — mapear "Standard_D2s_v3" pra um meter de forma confiável exigiria coluna nova +
// ressincronizar tudo, risco desproporcional ao pedido). Em vez disso, custo REAL de billing
// (`custo_diario`, já buscado pelo card "Custo — últimos 90 dias" logo abaixo, zero rota nova)
// — média diária nos 7 dias antes vs. 7 dias depois de `detectado_em`. Só propriedades
// diretamente ligadas a custo (SKU/tamanho de VM ou disco, tier de storage) — nunca tag/IP, que
// não têm relação de custo direta.
export const PROPRIEDADES_COM_IMPACTO_CUSTO = new Set(['sku_vm', 'disco_sku', 'disco_tier', 'disco_tamanho_gb', 'storage_sku', 'storage_access_tier'])
export interface ImpactoCusto { antes: number | null; depois: number | null }
export function calcularImpactoCusto(custoDiario: { cost_date: string; custo: number }[], detectadoEm: string): ImpactoCusto {
  const JANELA_MS = 7 * 24 * 60 * 60 * 1000
  const MIN_DIAS = 2 // billing tem 2-3 dias de atraso — menos que isso não é confiável
  const dataMudanca = new Date(detectadoEm).getTime()
  const antes = custoDiario.filter((d) => { const t = new Date(d.cost_date).getTime(); return t >= dataMudanca - JANELA_MS && t < dataMudanca })
  const depois = custoDiario.filter((d) => { const t = new Date(d.cost_date).getTime(); return t >= dataMudanca && t < dataMudanca + JANELA_MS })
  return {
    antes: antes.length >= MIN_DIAS ? antes.reduce((s, d) => s + d.custo, 0) / antes.length : null,
    depois: depois.length >= MIN_DIAS ? depois.reduce((s, d) => s + d.custo, 0) / depois.length : null,
  }
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
  // Mesma queryKey já usada por InventarioView (aba Configuração) — se o usuário já abriu essa
  // aba na sessão, isso só lê do cache do React Query, sem round-trip novo. Só o nome amigável
  // (ex: "Development") depende disso — o GUID cru já vem em `data.recurso.subscription_id`.
  const subsQuery = useQuery({ queryKey: ['calc-subscriptions'], queryFn: listSubscriptions })
  const subscriptionName = subsQuery.data?.find((s) => s.subscription_id === subscriptionId)?.subscription_name

  // Propriedades reais via Resource Graph (2026-09-02, inspirado no ARI) — sob demanda, não
  // auto-fetch: é uma chamada AO VIVO na Azure, e este modal abre com frequência ao navegar
  // "Por Assinatura" — disparar em toda abertura seria carga desnecessária na maioria das
  // vezes (usuário só quer ver custo/linha do tempo). `retry:false` porque 404 (recurso já
  // excluído) é o caso normal, não uma falha transitória.
  const [armAberto, setArmAberto] = useState(false)
  const armQuery = useQuery({
    queryKey: ['azure-inv-recurso-arm-detalhe', subscriptionId, resourceId],
    queryFn: () => getAzureRecursoArmDetalhe(resourceId, subscriptionId),
    enabled: armAberto,
    retry: false,
  })

  // Histórico de Alterações (2026-09-02, SKU de VM; expandido 2026-09-03 pra tags/disco/storage/
  // IP público, ver `_extrairMudancasRastreadas` em server.js) — gravado direto durante a coleta
  // a partir do antes/depois que a Azure Resource Graph Change Analysis já entrega no próprio
  // evento. Sem gate por tipo de recurso — tags e as demais propriedades curadas se aplicam a
  // qualquer tipo, não só VM; a rota simplesmente não retorna nada pros tipos sem propriedade
  // rastreada. Range bem largo (não os 30 dias padrão da aba Auditoria) pra cobrir toda a vida
  // do recurso, não só o que está sendo olhado no momento.
  const propHistQuery = useQuery({
    queryKey: ['azure-inv-mudancas-propriedade-recurso', subscriptionId, resourceId],
    queryFn: () => getAzurePropriedadeHistorico({ resource_id: resourceId, subscription_id: subscriptionId, data_inicio: '2015-01-01', data_fim: new Date().toISOString().slice(0, 10) }),
  })

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
                <div style={{ fontSize: 12, marginTop: 6 }}>
                  Assinatura: <strong style={{ color: 'var(--accent)' }}>{subscriptionName || data.recurso.subscription_id}</strong>
                  {subscriptionName && <span style={{ color: 'var(--text-muted)' }}> ({data.recurso.subscription_id})</span>}
                </div>
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

              {data.billing_detalhe ? (
                <div style={{ fontSize: 12, border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    SKU / Tipo
                    {data.billing_detalhe.origem === 'rg_mesmo_tipo' && (
                      <span style={{ fontWeight: 400, color: 'var(--orange,#ff8c42)', marginLeft: 6 }}>
                        (típico deste Resource Group — este recurso não tem billing próprio)
                      </span>
                    )}
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text)' }}>{data.billing_detalhe.sku || data.billing_detalhe.meter_name || '—'}</strong>
                    {data.billing_detalhe.vcpus != null && (
                      <span style={{ color: 'var(--text-muted)' }}> · {data.billing_detalhe.vcpus} vCPU{data.billing_detalhe.vcpus !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
                    {data.billing_detalhe.meter_category}
                    {data.billing_detalhe.meter_sub_category ? ` › ${data.billing_detalhe.meter_sub_category}` : ''}
                  </div>
                  {data.billing_detalhe.product_name && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>{data.billing_detalhe.product_name}</div>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                  SKU/tipo não disponível — sem nenhuma linha de billing pra este recurso, nem pra outro do mesmo tipo neste Resource Group.
                </div>
              )}

              {data.recurso.custo_acumulado === 0 && data.custo_resource_group > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 16 }}>
                  💡 Custo direto zerado, mas o Resource Group <strong style={{ color: 'var(--text)' }}>{data.recurso.resource_group}</strong> acumulou{' '}
                  <strong style={{ color: 'var(--text)' }}>{fmtBRL(data.custo_resource_group)}</strong> em {data.resource_group_recursos} recurso{data.resource_group_recursos !== 1 ? 's' : ''} diferentes.
                  Isso é normal pra VMs/discos/NICs de cluster (Databricks, AKS) — a Azure recria essas instâncias em questão de horas,
                  então o resource_id exato raramente sobrevive tempo suficiente até o billing ser publicado (~2-3 dias de atraso). O custo do
                  Resource Group inteiro é o número que reflete o ambiente de verdade.
                </div>
              )}

              {data.recurso.origem_deteccao === 'resource_graph' && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
                  🔎 Este recurso foi adicionado por reconciliação (Resource Graph) — existia antes da ativação do Inventário e nunca gerou um evento de criação/atualização, por isso não há "criado por/em" disponível.
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

              {propHistQuery.data && propHistQuery.data.total > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                    Histórico de Alterações ({propHistQuery.data.total} {propHistQuery.data.total === 1 ? 'alteração' : 'alterações'})
                  </div>
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                    {propHistQuery.data.mudancas.map((m) => {
                      const impacto = PROPRIEDADES_COM_IMPACTO_CUSTO.has(m.propriedade) && data.custo_diario.length > 0
                        ? calcularImpactoCusto(data.custo_diario, m.detectado_em)
                        : null
                      return (
                        <div key={m.id} style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ color: 'var(--text-muted)', fontWeight: 600, minWidth: 140 }}>{m.propriedade_label}</span>
                            <span style={{ color: 'var(--red,#ff4d6a)' }}>{m.valor_anterior || '—'}</span>
                            <span style={{ color: 'var(--text-muted)' }}>→</span>
                            <span style={{ color: 'var(--green,#22c55e)', fontWeight: 600 }}>{m.valor_novo || '—'}</span>
                            <span style={{ flex: 1 }} />
                            <span style={{ color: 'var(--text-muted)', fontSize: 11 }} title={m.evento_autor || ''}>{m.evento_autor_nome || m.evento_autor || 'desconhecido'}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{fmtData(m.detectado_em)}</span>
                          </div>
                          {impacto && (impacto.antes != null || impacto.depois != null) ? (
                            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                              💰 Impacto de custo (média/dia, billing real):{' '}
                              {impacto.antes != null ? fmtBRL(impacto.antes) : '—'} → {impacto.depois != null ? fmtBRL(impacto.depois) : '—'}
                              {impacto.antes != null && impacto.depois != null && (
                                <span style={{ color: impacto.depois > impacto.antes ? 'var(--orange,#ff8c42)' : 'var(--green,#22c55e)', fontWeight: 600 }}>
                                  {' '}({impacto.depois > impacto.antes ? '▲' : '▼'} {fmtBRL(Math.abs(impacto.depois - impacto.antes))}/dia)
                                </span>
                              )}
                            </div>
                          ) : PROPRIEDADES_COM_IMPACTO_CUSTO.has(m.propriedade) ? (
                            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-dim)' }}>💰 Impacto de custo ainda não disponível (billing tem 2-3 dias de atraso).</div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {data.custo_diario.length > 0 && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 700, margin: '16px 0 8px' }}>Custo — últimos 90 dias</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Total no período: <strong style={{ color: 'var(--text)' }}>{fmtBRL(data.custo_diario.reduce((s, d) => s + d.custo, 0))}</strong> ({data.custo_diario.length} dia{data.custo_diario.length !== 1 ? 's' : ''} com custo)
                  </div>
                </>
              )}

              <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <button
                  className="btn-ghost" style={{ fontSize: 11 }}
                  disabled={armQuery.isFetching}
                  onClick={() => (armAberto ? armQuery.refetch() : setArmAberto(true))}
                  title="Busca as propriedades reais do recurso direto na Azure (Resource Graph) — SKU exato, configuração, etc."
                >
                  {armQuery.isFetching ? 'Buscando na Azure...' : armAberto ? '🔄 Atualizar propriedades (Azure)' : '🔎 Ver propriedades completas (Azure)'}
                </button>
                {armAberto && armQuery.isError && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                    Não encontrado no Azure agora — provavelmente já foi excluído (comum pra recursos efêmeros de cluster).
                  </div>
                )}
                {armAberto && armQuery.data && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, marginBottom: 6 }}>
                      <strong>{armQuery.data.type}</strong> · {armQuery.data.location || '—'}
                      {!!armQuery.data.sku && (
                        <span style={{ color: 'var(--text-muted)' }}> · SKU: {JSON.stringify(armQuery.data.sku)}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>
                      Propriedades completas (JSON — varia por tipo de recurso)
                    </div>
                    <pre style={{
                      maxHeight: 260, overflow: 'auto', background: 'var(--bg)', border: '1px solid var(--border)',
                      borderRadius: 8, padding: '10px 12px', fontSize: 11, fontFamily: "'IBM Plex Mono',monospace",
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-muted)', margin: 0,
                    }}>
                      {JSON.stringify(armQuery.data.properties, null, 2) || '—'}
                    </pre>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
