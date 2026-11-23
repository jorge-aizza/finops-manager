import { useState } from 'react'
import type { DatabricksCotaUsuario } from '../types/databricksResumo'
import type { GenieBudget, GenieResolvedUserPrincipal } from '../types/genieBudgets'

export interface GenieBudgetUserRow {
  usuario: string
  principal_id: number | null
  gasto: number
  dbus: number
  limite: number | null
  limite_individual: number | null
  percentual: number | null
  origem: 'padrao' | 'override' | 'nao_resolvido' | 'tag_nao_atribuida'
  grupo: string
  status: 'Normal' | 'Atenção' | 'Crítico' | 'Limite atingido' | 'Sem cota' | 'Não resolvido' | 'Não atribuível'
}

export function calcularUsuariosQuotaGenie(
  budget: GenieBudget,
  consumo: DatabricksCotaUsuario[],
  principals: GenieResolvedUserPrincipal[],
  consumoFiltradoPorTags = false,
): { linhas: GenieBudgetUserRow[]; naoResolvidos: number; filtroPorTag: boolean; tagsAplicadas: boolean } {
  const tagsAplicadas = !!budget.filter?.tags?.length
  const filtroPorTag = tagsAplicadas && !consumoFiltradoPorTags

  const workspaceIds = budget.filter?.workspace_id?.values?.map(String)
  const agregado = new Map<string, { gasto: number; dbus: number }>()
  for (const linha of consumo) {
    if (workspaceIds?.length && !workspaceIds.includes(String(linha.workspace_id))) continue
    const usuario = linha.usuario.trim()
    if (!usuario) continue
    const atual = agregado.get(usuario.toLowerCase()) || { gasto: 0, dbus: 0 }
    atual.gasto += linha.custo
    atual.dbus += linha.dbus
    agregado.set(usuario.toLowerCase(), atual)
  }

  const alertas = budget.alert_configurations || []
  const alertasUsuario = alertas.filter((alerta) => alerta.scope_type === 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER')
  const alertaUsuario = alertasUsuario[0]
  const alertaUsuarioBase = [...alertasUsuario].sort((a, b) => Number(b.quantity_threshold) - Number(a.quantity_threshold))[0]
  const overrides = alertas.flatMap((alerta) => alerta.scope_type === 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER'
    ? (alerta.principal_overrides || []).map((override) => ({
      principal_id: String(override.principal_id), limite: Number(override.override_threshold),
    }))
    : [])
  const nomes = new Map(principals.map((principal) => [principal.username.toLowerCase(), principal]))
  const idsUsados = new Set<string>()
  const limitePadrao = alertaUsuario ? Number(alertaUsuario.quantity_threshold) : null
  const linhas = [...agregado.entries()].map(([usuario, uso]) => {
    const principal = nomes.get(usuario)
    const correspondencias = principal
      ? overrides.filter((override) => override.principal_id === principal.id || principal.grupos.some((grupo) => grupo.id === override.principal_id))
      : []
    for (const override of correspondencias) idsUsados.add(override.principal_id)
    const limiteOverride = correspondencias.length ? Math.min(...correspondencias.map((override) => override.limite)) : null
    const overrideIndividual = principal && alertaUsuarioBase?.principal_overrides?.find(
      (override) => String(override.principal_id) === principal.id,
    )
    const identidadeIncerta = !principal && overrides.length > 0
    const origem: GenieBudgetUserRow['origem'] = filtroPorTag
      ? 'tag_nao_atribuida'
      : identidadeIncerta ? 'nao_resolvido' : limiteOverride != null ? 'override' : 'padrao'
    const limite = origem === 'override' ? limiteOverride : origem === 'padrao' ? limitePadrao : null
    const percentual = limite != null && limite > 0 ? uso.gasto / limite * 100 : null
    const status: GenieBudgetUserRow['status'] = origem === 'tag_nao_atribuida'
      ? 'Não atribuível'
      : origem === 'nao_resolvido' ? 'Não resolvido'
      : limite == null ? 'Sem cota'
        : percentual != null && percentual >= 100 ? 'Limite atingido'
          : percentual != null && percentual >= 90 ? 'Crítico'
            : percentual != null && percentual >= 75 ? 'Atenção' : 'Normal'
    const grupos = correspondencias
      .filter((override) => principal?.grupos.some((grupo) => grupo.id === override.principal_id))
      .map((override) => principal?.grupos.find((grupo) => grupo.id === override.principal_id)?.nome)
      .filter((nome): nome is string => !!nome)
    return {
      usuario: principal?.nome || usuario,
      principal_id: principal ? Number(principal.id) : null,
      gasto: uso.gasto,
      dbus: uso.dbus,
      limite,
      limite_individual: principal && alertaUsuarioBase
        ? Number(overrideIndividual?.override_threshold ?? alertaUsuarioBase.quantity_threshold)
        : null,
      percentual,
      origem,
      grupo: origem === 'tag_nao_atribuida' ? 'Consumo não atribuído ao filtro de tags'
        : tagsAplicadas ? `${grupos.join(', ') || (origem === 'override' ? 'Override individual' : 'Padrão da quota')} · tags aplicadas`
        : grupos.join(', ') || (origem === 'override' ? 'Override individual' : origem === 'padrao' ? 'Padrão da quota' : 'Principal não resolvido'),
      status,
    }
  }).sort((a, b) => b.gasto - a.gasto || b.dbus - a.dbus)

  return {
    linhas,
    naoResolvidos: filtroPorTag ? 0 : Math.max(0, overrides.length - idsUsados.size),
    filtroPorTag,
    tagsAplicadas,
  }
}

function usd(valor: number) {
  return 'US$ ' + valor.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function statusStyle(status: GenieBudgetUserRow['status']): React.CSSProperties {
  if (status === 'Limite atingido' || status === 'Crítico') return { background: 'var(--red,#ff4d6a)', color: '#fff' }
  if (status === 'Atenção') return { background: 'var(--orange,#ff8c42)', color: '#fff' }
  if (status === 'Normal') return { background: 'color-mix(in srgb, var(--green,#22c55e) 14%, transparent)', color: 'var(--green,#22c55e)' }
  return { background: 'var(--bg-hover)', color: 'var(--text-muted)' }
}

export default function GenieBudgetUsersModal({
  budget, linhas, escopo, naoResolvidos, filtroPorTag, tagsAplicadas, semBillingLocal, carregandoPrincipals, erroPrincipals,
  carregandoConsumoTags, erroConsumoTags,
  salvandoOverride, onUpdateOverride, onClose,
}: {
  budget: GenieBudget
  linhas: GenieBudgetUserRow[]
  escopo: 'padrao' | 'overrides'
  naoResolvidos: number
  filtroPorTag: boolean
  tagsAplicadas: boolean
  semBillingLocal: boolean
  carregandoPrincipals: boolean
  erroPrincipals: string | null
  carregandoConsumoTags: boolean
  erroConsumoTags: string | null
  salvandoOverride: boolean
  onUpdateOverride: (principalId: number, monthlyLimit: number, confirmarBloqueio: boolean) => void
  onClose: () => void
}) {
  const nomeEscopo = escopo === 'padrao' ? 'Padrão por usuário' : 'Overrides individuais'
  const linhasEscopo = filtroPorTag ? linhas : linhas.filter((linha) => escopo === 'padrao'
    ? linha.origem === 'padrao'
    : linha.origem === 'override' || linha.origem === 'nao_resolvido')
  const defaultUsers = linhasEscopo.filter((linha) => linha.origem === 'padrao')
  const overrideUsers = linhasEscopo.filter((linha) => linha.origem === 'override' || linha.origem === 'nao_resolvido')
  const noLimiteDefault = defaultUsers.filter((linha) => linha.status === 'Limite atingido').length
  const noLimiteOverride = overrideUsers.filter((linha) => linha.status === 'Limite atingido').length
  const noLimiteTotal = noLimiteDefault + noLimiteOverride
  const statusIndisponivel = semBillingLocal || filtroPorTag || carregandoConsumoTags || !!erroConsumoTags
  const maiorGasto = Math.max(0, ...linhasEscopo.map((linha) => linha.gasto))
  const topGastos = linhasEscopo.slice(0, 8)
  const [linhaEditando, setLinhaEditando] = useState<{ principalId: number; usuario: string; limite: string } | null>(null)
  const temLimitePorUsuario = budget.alert_configurations?.some(
    (alerta) => alerta.scope_type === 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER',
  ) ?? false
  const limitePadraoPorUsuario = Math.max(0, ...(budget.alert_configurations || [])
    .filter((alerta) => alerta.scope_type === 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER')
    .map((alerta) => Number(alerta.quantity_threshold) || 0))
  const bloqueiaUso = budget.alert_configurations?.some((alerta) =>
    alerta.scope_type === 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER'
    && alerta.action_configurations?.some((action) => action.action_type === 'BLOCK_USAGE'),
  ) ?? false

  function salvarOverride() {
    if (!linhaEditando) return
    const limite = Number(linhaEditando.limite)
    if (!Number.isFinite(limite) || limite <= 0) return
    if (bloqueiaUso && !window.confirm(`Aumentar o limite individual de ${linhaEditando.usuario} para US$ ${limite.toFixed(2)}? A quota pode bloquear o uso ao atingir o novo limite.`)) return
    onUpdateOverride(linhaEditando.principalId, limite, bloqueiaUso)
    setLinhaEditando(null)
  }

  return (
    <div className="modal-overlay open" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="genie-users-title" style={{ maxWidth: 1120 }}>
        <div className="modal-header">
          <span id="genie-users-title">Usuários · {budget.display_name} · {filtroPorTag ? 'atribuição não verificada' : nomeEscopo}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
            {filtroPorTag
              ? 'Esta quota filtra por tags e a Budgets API não informa quais usuários foram bloqueados. Não é possível confirmar se cada pessoa está coberta pela quota ou atingiu o limite.'
              : tagsAplicadas
                ? 'Gasto do billing local filtrado pelas mesmas tags da quota. O percentual pode atrasar conforme a chegada do billing; BLOCK_USAGE é aplicado pelo Databricks ao atingir o limite.'
              : 'Gasto do billing local comparado ao limite individual. Faixas: Atenção a partir de 75%, Crítico a partir de 90% e Limite atingido a partir de 100%. Isso não confirma um bloqueio emitido pelo Databricks.'}
          </div>
          {filtroPorTag ? (
            <div style={{ padding: '8px 12px', marginBottom: 18, borderLeft: '2px solid var(--orange,#ff8c42)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Status de bloqueio</div>
              <strong>Não verificável</strong>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · disponível o ajuste do limite individual abaixo</span>
            </div>
          ) : tagsAplicadas ? (
            <div style={{ padding: '8px 12px', marginBottom: 18, borderLeft: '2px solid var(--accent)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Acompanhamento por usuário</div>
              <strong>Billing filtrado pelas tags da quota</strong>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · leitura pode ter atraso de ingestão</span>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 12, marginBottom: 18 }}>
              <div style={{ padding: '4px 12px', borderLeft: '2px solid var(--red,#ff4d6a)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Limite atingido (billing)</div>
                <strong>{statusIndisponivel ? '—' : noLimiteTotal}</strong>
              </div>
              <div style={{ padding: '4px 12px', borderLeft: '2px solid var(--accent)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Usuários com billing local</div>
                <strong>{semBillingLocal ? '—' : linhas.length}</strong>
              </div>
              <div style={{ padding: '4px 12px', borderLeft: '2px solid var(--orange,#ff8c42)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Padrão da quota</div>
                <strong>{statusIndisponivel ? '—' : `${noLimiteDefault} no limite`}</strong><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{semBillingLocal ? ' · dados insuficientes' : ` · ${defaultUsers.length} usuários com gasto`}</span>
              </div>
              <div style={{ padding: '4px 12px', borderLeft: '2px solid var(--accent)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Limites individuais</div>
                <strong>{statusIndisponivel ? '—' : `${noLimiteOverride} no limite`}</strong><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{semBillingLocal ? ' · dados insuficientes' : ` · ${overrideUsers.length} usuários identificados`}</span>
              </div>
            </div>
          )}
          {!filtroPorTag && topGastos.length > 0 && (
            <section aria-label="Gasto estimado por usuário" style={{ paddingBottom: 16, marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ margin: '0 0 10px', fontSize: 13 }}>{tagsAplicadas ? `Gasto no mês · ${nomeEscopo} (tags da quota)` : `Gasto no mês · ${nomeEscopo}`}</h3>
              <div style={{ display: 'grid', gap: 8 }}>
                {topGastos.map((linha) => (
                  <div key={linha.usuario} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 190px) minmax(60px, 1fr) auto', alignItems: 'center', gap: 10, fontSize: 11 }}>
                    <span title={linha.usuario} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{linha.usuario}</span>
                    <div style={{ height: 9, background: 'var(--border)', borderRadius: 5 }}>
                      <div style={{ width: `${maiorGasto > 0 ? Math.max(linha.gasto / maiorGasto * 100, linha.gasto > 0 ? 2 : 0) : 0}%`, height: '100%', background: linha.status === 'Limite atingido' || linha.status === 'Crítico' ? 'var(--red,#ff4d6a)' : linha.status === 'Atenção' ? 'var(--orange,#ff8c42)' : 'var(--accent)', borderRadius: 5 }} />
                    </div>
                    <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{usd(linha.gasto)}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}
          {carregandoPrincipals && <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>Resolvendo usuários e grupos na Account API...</div>}
          {carregandoConsumoTags && <div role="status" style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>Filtrando billing pelas tags desta quota...</div>}
          {erroConsumoTags && <div role="status" style={{ marginBottom: 12, fontSize: 12, color: 'var(--orange,#ff8c42)' }}>Não foi possível filtrar o billing pelas tags. O progresso individual fica indisponível.</div>}
          {erroPrincipals && <div role="status" style={{ marginBottom: 12, fontSize: 12, color: 'var(--orange,#ff8c42)' }}>Não foi possível resolver todos os principals. Overrides não associados não entram na contagem.</div>}
          {escopo === 'overrides' && naoResolvidos > 0 && <div role="status" style={{ marginBottom: 12, fontSize: 12, color: 'var(--orange,#ff8c42)' }}>{naoResolvidos} override(s) não associado(s) a usuário com consumo no mês.</div>}
          {filtroPorTag && <div role="status" style={{ marginBottom: 12, padding: 10, color: 'var(--orange,#ff8c42)', background: 'color-mix(in srgb, var(--orange,#ff8c42) 10%, transparent)' }}>O Databricks não fornece pela Budgets API a lista de usuários bloqueados. Como esta quota filtra por tags e o billing não foi filtrado por elas, não é possível atribuir o gasto nem calcular progresso individual.</div>}
          {semBillingLocal ? (
            <div role="status" style={{ padding: 18, color: 'var(--orange,#ff8c42)', textAlign: 'center' }}>{tagsAplicadas ? 'Nenhuma linha de billing por usuário corresponde às tags desta quota neste mês.' : 'A Budgets API não fornece a lista de bloqueios individuais, e não há linhas de billing Genie por usuário neste mês para calcular os status.'}</div>
          ) : !linhasEscopo.length ? (
            <div style={{ padding: 18, color: 'var(--text-muted)', textAlign: 'center' }}>Nenhum usuário com consumo Genie encontrado no escopo {nomeEscopo} neste workspace no mês.</div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table" style={{ minWidth: temLimitePorUsuario ? (filtroPorTag ? 560 : 920) : 760 }}>
                <thead><tr><th>Nome</th><th>{filtroPorTag ? 'Status do bloqueio' : 'Status calculado'}</th>{!filtroPorTag && <><th>Gasto no mês</th><th>Limite efetivo</th><th>Grupo / origem</th><th>% do limite</th></>}{temLimitePorUsuario && <th>Limite individual</th>}</tr></thead>
                <tbody>
                  {linhasEscopo.map((linha) => (
                    <tr key={linha.usuario}>
                      <td>{linha.usuario}</td>
                      <td><span className="badge" style={statusStyle(linha.status)}>{filtroPorTag ? 'Bloqueio não verificável' : linha.status === 'Limite atingido' && bloqueiaUso ? 'Limite atingido · BLOCK configurado' : linha.status}</span></td>
                      {!filtroPorTag && <>
                        <td>{usd(linha.gasto)}</td>
                        <td>{linha.limite == null ? '—' : usd(linha.limite)}</td>
                        <td>{linha.grupo}</td>
                        <td style={{ minWidth: 135 }}>
                        {linha.percentual == null ? '—' : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ minWidth: 42 }}>{Math.round(linha.percentual)}%</span>
                            <div
                              role="progressbar"
                              aria-label={`Consumo de ${linha.usuario}`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.min(linha.percentual, 100)}
                              aria-valuetext={`${Math.round(linha.percentual)}% do limite, ${usd(linha.gasto)} de ${usd(linha.limite ?? 0)}`}
                              style={{ height: 7, flex: 1, background: 'var(--border)', borderRadius: 4 }}
                            >
                              <div style={{ width: `${Math.min(linha.percentual, 100)}%`, height: '100%', background: linha.status === 'Limite atingido' || linha.status === 'Crítico' ? 'var(--red,#ff4d6a)' : linha.status === 'Atenção' ? 'var(--orange,#ff8c42)' : 'var(--green,#22c55e)', borderRadius: 4 }} />
                            </div>
                          </div>
                        )}
                        </td>
                      </>}
                      {temLimitePorUsuario && (
                        <td style={{ minWidth: 180 }}>
                          {linha.principal_id && temLimitePorUsuario ? (
                            linhaEditando?.principalId === linha.principal_id ? (
                              <div style={{ display: 'grid', gap: 5 }}>
                                <input
                                  aria-label={`Novo limite individual de ${linha.usuario}`}
                                  type="number" min="0.01" step="0.01" value={linhaEditando.limite}
                                  onChange={(event) => setLinhaEditando({ ...linhaEditando, limite: event.target.value })}
                                />
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button type="button" className="btn-primary" disabled={salvandoOverride || Number(linhaEditando.limite) <= 0} onClick={salvarOverride}>
                                    {salvandoOverride ? 'Salvando...' : 'Salvar limite'}
                                  </button>
                                  <button type="button" className="btn-ghost" disabled={salvandoOverride} onClick={() => setLinhaEditando(null)}>Cancelar</button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: 'grid', gap: 5 }}>
                                <span>{usd(linha.limite_individual ?? linha.limite ?? limitePadraoPorUsuario)}</span>
                                <button
                                  type="button" className="btn-ghost" style={{ fontSize: 10, padding: '4px 7px' }}
                                  aria-label={`Ajustar limite de ${linha.usuario}`}
                                  onClick={() => setLinhaEditando({
                                    principalId: linha.principal_id!, usuario: linha.usuario,
                                    limite: String(linha.limite_individual ?? linha.limite ?? limitePadraoPorUsuario),
                                  })}
                                >Ajustar limite</button>
                              </div>
                            )
                          ) : '—'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}