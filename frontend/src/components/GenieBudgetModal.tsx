import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createGenieBudget, searchGeniePrincipals, updateGenieBudget } from '../api/genieBudgets'
import type { GenieActionType, GenieBudget, GenieBudgetTagInput, GeniePrincipal, GenieScopeType } from '../types/genieBudgets'

interface Props {
  budget?: GenieBudget | null
  workspaces: { workspace_id: string; nome: string; custo: number | null }[]
  workspacesLoading?: boolean
  workspacesError?: string | null
  consumoLoading?: boolean
  consumoError?: string | null
  onRetryWorkspaces?: () => void
  onClose: () => void
}

interface OverrideRow {
  principal_id: number
  nome: string
  override_threshold: string
}

interface LevelRow {
  percentage: string
  alert: boolean
  block: boolean
}

const DEFAULT_LEVELS: LevelRow[] = [
  { percentage: '50', alert: true, block: false },
  { percentage: '80', alert: true, block: false },
  { percentage: '100', alert: true, block: true },
]

function levelsFromBudget(budget?: GenieBudget | null): { base: string; levels: LevelRow[]; baseAlert?: GenieBudget['alert_configurations'][number] } {
  const alerts = [...(budget?.alert_configurations || [])]
    .sort((a, b) => Number(a.quantity_threshold) - Number(b.quantity_threshold))
  const baseAlert = alerts[alerts.length - 1]
  const base = Number(baseAlert?.quantity_threshold || 0)
  if (!alerts.length) return { base: '', levels: DEFAULT_LEVELS.map(level => ({ ...level })) }
  return {
    base: String(baseAlert?.quantity_threshold || ''),
    baseAlert,
    levels: alerts.map(alert => {
      const actions = alert.action_configurations?.map(action => action.action_type) || []
      return {
        percentage: base > 0 ? String(Number((Number(alert.quantity_threshold) / base * 100).toFixed(2))) : '100',
        alert: actions.includes('EMAIL_NOTIFICATION'),
        block: actions.includes('BLOCK_USAGE'),
      }
    }),
  }
}

export default function GenieBudgetModal({
  budget, workspaces = [], workspacesLoading = false, workspacesError = null,
  consumoLoading = false, consumoError = null, onRetryWorkspaces, onClose,
}: Props) {
  const isEdit = !!budget
  const configuracaoInicial = levelsFromBudget(budget)
  const alertaExistente = budget?.alert_configurations?.[0]
  const queryClient = useQueryClient()
  const [nome, setNome] = useState(budget?.display_name || '')
  const workspaceIdsIniciais = budget?.filter?.workspace_id?.values?.map(String) || []
  const [workspaceIds, setWorkspaceIds] = useState<string[]>(workspaceIdsIniciais)
  const [workspaceSearch, setWorkspaceSearch] = useState('')
  const [workspaceScope, setWorkspaceScope] = useState<'account' | 'selected' | null>(
    budget ? (workspaceIdsIniciais.length ? 'selected' : 'account') : null,
  )
  const [tags, setTags] = useState<GenieBudgetTagInput[]>(
    budget?.filter?.tags?.map((t) => ({ key: t.key, value: t.value?.values?.[0] || '' })) || [],
  )
  const [limiteMensal, setLimiteMensal] = useState(configuracaoInicial.base)
  const [levels, setLevels] = useState<LevelRow[]>(configuracaoInicial.levels)
  const [scopeType, setScopeType] = useState<GenieScopeType>((alertaExistente?.scope_type as GenieScopeType) || 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED')
  const [emailTarget, setEmailTarget] = useState(configuracaoInicial.baseAlert?.action_configurations?.find(a => a.action_type === 'EMAIL_NOTIFICATION')?.target || '')
  // Sempre começa desmarcado, mesmo editando uma quota que já bloqueia — exige uma
  // confirmação nova a cada alteração salva, não só na criação original.
  const [confirmarBloqueio, setConfirmarBloqueio] = useState(false)

  // Overrides — limite individual por usuário (busca por parte do e-mail) ou grupo (busca
  // por parte do nome) via Account SCIM API, resolvendo pro principal_id numérico que a
  // Budgets API exige. Busca por substring (`co`, não `eq`) — a conta Databricks da Vivo
  // já tem provisionamento SCIM configurado a partir do Entra ID (confirmado pelo usuário,
  // 2026-08-29), então o diretório real tem muitos usuários/grupos; exigir o valor exato
  // completo não seria prático. Só faz sentido (e só é aceito pelo servidor) com escopo
  // "Por usuário" — ver
  // guard-rail em POST/PUT /genie-budgets. Overrides já existentes (vindos de `budget`)
  // não têm nome/e-mail na resposta da API — só principal_id —, então mostram "ID: N"
  // até serem removidos; novos overrides adicionados na mesma sessão de edição mostram
  // o nome real (resolvido pela busca).
  const [overrideTipo, setOverrideTipo] = useState<'user' | 'group'>('user')
  const [overrideQuery, setOverrideQuery] = useState('')
  const [overrideResultados, setOverrideResultados] = useState<GeniePrincipal[]>([])
  const [overrideBuscando, setOverrideBuscando] = useState(false)
  const [overrides, setOverrides] = useState<OverrideRow[]>(
    configuracaoInicial.baseAlert?.principal_overrides?.map((o) => ({
      principal_id: o.principal_id, nome: `ID: ${o.principal_id}`, override_threshold: o.override_threshold,
    })) || [],
  )

  function toggleWorkspace(id: string) {
    setWorkspaceIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }
  const workspacesFiltrados = workspaces.filter((ws) =>
    `${ws.nome} ${ws.workspace_id}`.toLocaleLowerCase().includes(workspaceSearch.trim().toLocaleLowerCase()),
  )
  const temTagsAtivas = tags.some((tag) => tag.key && tag.value)
  const isPerUser = scopeType === 'ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER'

  function addTag() { setTags((t) => [...t, { key: '', value: '' }]) }
  function updateTag(i: number, field: 'key' | 'value', v: string) {
    setTags((t) => t.map((tag, idx) => (idx === i ? { ...tag, [field]: v } : tag)))
  }
  function removeTag(i: number) { setTags((t) => t.filter((_, idx) => idx !== i)) }

  async function buscarPrincipal() {
    const q = overrideQuery.trim()
    if (!q) return
    setOverrideBuscando(true)
    setOverrideResultados([])
    try {
      const resultados = await searchGeniePrincipals(overrideTipo, q)
      if (resultados.length === 0) window.showToast?.('Nenhum resultado encontrado.', 'warn')
      setOverrideResultados(resultados)
    } catch (e) {
      window.showToast?.('Erro ao buscar: ' + (e as Error).message, 'error')
    } finally {
      setOverrideBuscando(false)
    }
  }

  function adicionarOverride(p: GeniePrincipal) {
    const id = Number(p.id)
    if (overrides.some((o) => o.principal_id === id)) { window.showToast?.('Já adicionado.', 'warn'); return }
    if (overrides.length >= 20) { window.showToast?.('Máximo de 20 overrides por quota.', 'warn'); return }
    setOverrides((prev) => [...prev, { principal_id: id, nome: p.nome, override_threshold: '' }])
    setOverrideResultados([])
    setOverrideQuery('')
  }

  function removerOverride(principalId: number) {
    setOverrides((prev) => prev.filter((o) => o.principal_id !== principalId))
  }

  function updateOverrideThreshold(principalId: number, v: string) {
    setOverrides((prev) => prev.map((o) => (o.principal_id === principalId ? { ...o, override_threshold: v } : o)))
  }

  function updateLevel(index: number, field: keyof LevelRow, value: string | boolean) {
    setLevels(prev => prev.map((level, i) => i === index ? { ...level, [field]: value } : level))
  }

  function addLevel() {
    if (levels.length >= 4) return
    const usados = new Set(levels.map(level => Number(level.percentage)))
    const percentage = [50, 80, 90, 95, 99].find(value => !usados.has(value))
    if (percentage == null) return
    setLevels(prev => [...prev, { percentage: String(percentage), alert: true, block: false }]
      .sort((a, b) => Number(a.percentage) - Number(b.percentage)))
  }

  function removeLevel(index: number) {
    setLevels(prev => prev.filter((_, i) => i !== index))
  }

  const niveisOrdenados = [...levels].sort((a, b) => Number(a.percentage) - Number(b.percentage))
  const percentuais = niveisOrdenados.map(level => Number(level.percentage))
  const limite = Number(limiteMensal)
  const niveisValidos = niveisOrdenados.length > 0 && niveisOrdenados.length <= 4
    && percentuais.every(value => Number.isFinite(value) && value > 0 && value <= 100)
    && percentuais.every((value, i) => i === 0 || value > percentuais[i - 1])
    && percentuais[percentuais.length - 1] === 100
    && niveisOrdenados.every(level => level.alert || level.block)
    && niveisOrdenados.every(level => !level.block || Number(level.percentage) === 100)
    && niveisOrdenados.every((level, i) => {
      const amount = Math.round(limite * Number(level.percentage))
      const previous = i ? Math.round(limite * Number(niveisOrdenados[i - 1].percentage)) : 0
      return amount > previous && amount > 0
    })
  const overridesValidos = overrides.every((o) => o.override_threshold && parseFloat(o.override_threshold) > 0)
  const isBloqueio = levels.some(level => level.block)
  const temAlertas = levels.some(level => level.alert)
  const podeConfirmar = !!nome && Number.isFinite(limite) && limite > 0 && niveisValidos
    && (!isBloqueio || confirmarBloqueio) && overridesValidos
    && (workspaceScope === 'account' || (workspaceScope === 'selected' && workspaceIds.length > 0 && !workspacesLoading && !workspacesError))

  const salvarMutation = useMutation({
    mutationFn: () => {
      const input = {
        display_name: nome,
        workspace_ids: workspaceScope === 'selected' ? workspaceIds.map(Number).filter(Number.isFinite) : [],
        tags: tags.filter((t) => t.key && t.value),
        monthly_limit_usd: limiteMensal,
        scope_type: scopeType,
        levels: niveisOrdenados.map(level => ({
          percentage: Number(level.percentage),
          actions: [
            ...(level.alert ? ['EMAIL_NOTIFICATION' as GenieActionType] : []),
            ...(level.block ? ['BLOCK_USAGE' as GenieActionType] : []),
          ],
        })),
        email_target: temAlertas ? (emailTarget || undefined) : undefined,
        confirmar_bloqueio: isBloqueio ? true : undefined,
        principal_overrides: isPerUser && overrides.length
          ? overrides.map((o) => ({ principal_id: o.principal_id, override_threshold: o.override_threshold }))
          : undefined,
      }
      return budget ? updateGenieBudget(budget.budget_configuration_id, input) : createGenieBudget(input)
    },
    onSuccess: () => {
      window.showToast?.(isEdit ? 'Quota Genie atualizada no Databricks.' : 'Quota Genie criada no Databricks.', 'success')
      queryClient.invalidateQueries({ queryKey: ['genie-budgets'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.(`Erro ao ${isEdit ? 'atualizar' : 'criar'} quota Genie: ` + e.message, 'error'),
  })

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span>🧞 {isEdit ? 'Editar Quota Genie' : 'Nova Quota Genie'}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
            {isEdit ? 'Atualiza' : 'Cria'} um orçamento nativo no Databricks (Unity AI Gateway). Os percentuais são calculados sobre o teto mensal em <strong>USD</strong>; cada nível vira um alerta nativo na API.
          </div>
          <div className="form-group">
            <label htmlFor="gb-nome">Nome</label>
            <input id="gb-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Quota Genie — Time de Dados" />
          </div>
          <div className="form-group">
            <label>Escopo dos workspaces</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', margin: '4px 0 10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                <input type="radio" name="gb-workspace-scope" checked={workspaceScope === 'account'} onChange={() => setWorkspaceScope('account')} style={{ width: 'auto' }} />
                Toda a conta
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
                <input type="radio" name="gb-workspace-scope" checked={workspaceScope === 'selected'} onChange={() => setWorkspaceScope('selected')} style={{ width: 'auto' }} />
                Workspaces específicos
              </label>
            </div>
            {workspaceScope === 'account' && (
              <div role="status" style={{ padding: '8px 10px', color: 'var(--text-muted)', fontSize: 12, border: '1px solid var(--border,#d6dbe1)', borderRadius: 4 }}>
                A quota não terá filtro por workspace. {temTagsAtivas
                  ? 'As tags informadas abaixo ainda limitam os recursos incluídos.'
                  : 'Sem tags, vale para todos os workspaces da conta, inclusive os adicionados futuramente.'}
              </div>
            )}
            {workspaceScope === null && (
              <div role="status" style={{ padding: '8px 10px', color: 'var(--orange,#ff8c42)', fontSize: 12 }}>
                Escolha explicitamente se a quota vale para toda a conta ou para workspaces específicos.
              </div>
            )}
            {workspaceScope === 'selected' && (
              <>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                  Workspaces selecionados: {workspaceIds.length} · exibindo {workspacesFiltrados.length} de {workspaces.length}.
                </div>
                <input
                  type="search"
                  aria-label="Filtrar workspaces da conta"
                  value={workspaceSearch}
                  onChange={(e) => setWorkspaceSearch(e.target.value)}
                  placeholder="Filtrar por nome ou ID"
                  style={{ marginBottom: 8 }}
                />
                <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border,#d6dbe1)', borderRadius: 4 }}>
                  {workspacesLoading && !workspaces.length && (
                    <div role="status" style={{ padding: 10, color: 'var(--text-muted)', fontSize: 12 }}>Carregando workspaces da Account API...</div>
                  )}
                  {workspacesError && (
                    <div role="alert" style={{ padding: 10, color: 'var(--orange,#ff8c42)', fontSize: 12 }}>
                      Não foi possível carregar todos os workspaces da conta: {workspacesError}.
                      {onRetryWorkspaces && <button type="button" className="btn-ghost" style={{ marginLeft: 8 }} onClick={onRetryWorkspaces}>Tentar novamente</button>}
                    </div>
                  )}
                  {workspacesFiltrados.length ? workspacesFiltrados.map((ws) => (
                    <label key={ws.workspace_id} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) minmax(90px, auto)', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border,#d6dbe1)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={workspaceIds.includes(String(ws.workspace_id))} onChange={() => toggleWorkspace(String(ws.workspace_id))} />
                      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }} title={ws.nome}>{ws.nome}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'right', overflowWrap: 'anywhere' }}>
                        {ws.custo == null
                          ? consumoLoading ? 'Carregando consumo...' : consumoError ? 'Consumo indisponível' : 'Sem consumo no mês'
                          : `US$ ${ws.custo.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} no mês`}
                      </span>
                    </label>
                  )) : !workspacesLoading && !workspacesError && (
                    <div role="status" style={{ padding: 10, color: 'var(--text-muted)', fontSize: 12 }}>
                      {workspaces.length ? 'Nenhum workspace corresponde à busca.' : 'A Account API não retornou workspaces.'}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="form-group">
            <label>Tags (opcional)</label>
            {tags.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <input value={t.key} onChange={(e) => updateTag(i, 'key', e.target.value)} placeholder="chave" style={{ flex: 1 }} />
                <input value={t.value} onChange={(e) => updateTag(i, 'value', e.target.value)} placeholder="valor" style={{ flex: 1 }} />
                <button className="btn-icon delete" title="Remover" onClick={() => removeTag(i)} style={{ flexShrink: 0 }}>✕</button>
              </div>
            ))}
            <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={addTag}>+ Adicionar tag</button>
          </div>
          <div className="form-group">
            <label htmlFor="gb-valor">Teto mensal (US$)</label>
            <input id="gb-valor" type="number" min={0.01} step="0.01" value={limiteMensal} onChange={(e) => setLimiteMensal(e.target.value)} />
          </div>
          <div className="form-group">
            <label htmlFor="gb-escopo">Escopo do limite</label>
            <select id="gb-escopo" value={scopeType} onChange={(e) => setScopeType(e.target.value as GenieScopeType)}>
              <option value="ALERT_CONFIGURATION_SCOPE_TYPE_SHARED">Compartilhado (soma de todos os usuários)</option>
              <option value="ALERT_CONFIGURATION_SCOPE_TYPE_PER_USER">Por usuário (cada usuário até este valor)</option>
            </select>
          </div>

          {isPerUser && (
            <div className="form-group">
              <label>Limites individuais por usuário/grupo (opcional, até 20)</label>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                Sobrescreve o limite acima só pra quem for adicionado aqui — os demais usuários continuam com o valor padrão.
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <select value={overrideTipo} onChange={(e) => setOverrideTipo(e.target.value as 'user' | 'group')} style={{ flexShrink: 0, width: 110 }}>
                  <option value="user">Usuário</option>
                  <option value="group">Grupo</option>
                </select>
                <input
                  value={overrideQuery}
                  onChange={(e) => setOverrideQuery(e.target.value)}
                  placeholder={overrideTipo === 'user' ? 'parte do e-mail' : 'parte do nome do grupo'}
                  style={{ flex: 1 }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), buscarPrincipal())}
                />
                <button className="btn-ghost" style={{ flexShrink: 0 }} disabled={overrideBuscando || !overrideQuery.trim()} onClick={buscarPrincipal}>
                  {overrideBuscando ? 'Buscando...' : 'Buscar'}
                </button>
              </div>
              {overrideResultados.length > 0 && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 6, marginBottom: 8, overflow: 'hidden' }}>
                  {overrideResultados.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => adicionarOverride(p)}
                      style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)' }}
                      title="Clique para adicionar"
                    >
                      {p.nome} <span style={{ color: 'var(--text-muted)' }}>({p.id})</span>
                    </div>
                  ))}
                </div>
              )}
              {overrides.map((o) => (
                <div key={o.principal_id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.nome}>{o.nome}</span>
                  <input
                    type="number" min={0} step="0.01" value={o.override_threshold}
                    onChange={(e) => updateOverrideThreshold(o.principal_id, e.target.value)}
                    placeholder="US$"
                    style={{ width: 100, flexShrink: 0 }}
                  />
                  <button className="btn-icon delete" title="Remover" onClick={() => removerOverride(o.principal_id)} style={{ flexShrink: 0 }}>✕</button>
                </div>
              ))}
              {overrides.length > 0 && !overridesValidos && (
                <div style={{ fontSize: 11, color: 'var(--danger)' }}>Preencha um limite válido (maior que zero) pra cada override.</div>
              )}
            </div>
          )}

          <div className="form-group">
            <label>Níveis de alerta (máximo 4; o último deve ser 100%)</label>
            <div style={{ display: 'grid', gridTemplateColumns: '80px minmax(0, 1fr) 32px', gap: 8, alignItems: 'center', marginBottom: 6, color: 'var(--text-muted)', fontSize: 11 }}>
              <span>Percentual</span><span>Ações</span><span />
            </div>
            {levels.map((level, index) => (
              <div key={index} style={{ display: 'grid', gridTemplateColumns: '80px minmax(0, 1fr) 32px', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input aria-label={`Percentual do nível ${index + 1}`} type="number" min={1} max={100} step="1" value={level.percentage}
                    onChange={(e) => updateLevel(index, 'percentage', e.target.value)} style={{ width: 58 }} />
                  <span>%</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                    <input type="checkbox" aria-label={`Enviar alerta no nível ${index + 1}`} checked={level.alert}
                      onChange={(e) => updateLevel(index, 'alert', e.target.checked)} style={{ width: 'auto' }} />
                    Alertar por e-mail
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                    <input type="checkbox" aria-label={`Bloquear no nível ${index + 1}`} checked={level.block}
                      onChange={(e) => updateLevel(index, 'block', e.target.checked)} style={{ width: 'auto' }} />
                    Bloquear
                  </label>
                </div>
                <button className="btn-icon delete" title="Remover nível" onClick={() => removeLevel(index)} disabled={levels.length <= 1}>✕</button>
              </div>
            ))}
            <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 10px' }} onClick={addLevel} disabled={levels.length >= 4}>+ Adicionar nível</button>
            {!niveisValidos && (
              <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>
                Use percentuais crescentes e distintos, termine em 100%, mantenha pelo menos uma ação por nível e deixe o bloqueio somente em 100%.
              </div>
            )}
          </div>

          {temAlertas && (
            <div className="form-group">
              <label htmlFor="gb-email">E-mail de destino dos alertas (opcional)</label>
              <input id="gb-email" type="email" value={emailTarget} onChange={(e) => setEmailTarget(e.target.value)} placeholder="ex: finops@vivo.com.br" />
            </div>
          )}

          {isBloqueio && (
            <div style={{
              border: '1px solid color-mix(in srgb, var(--red,#ff4d6a) 40%, transparent)',
              background: 'color-mix(in srgb, var(--red,#ff4d6a) 10%, transparent)',
              borderRadius: 8, padding: '12px 14px', marginTop: 4,
            }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--red,#ff4d6a)', marginBottom: 6 }}>
                ⚠ Esta ação bloqueia acesso real ao Genie
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                Ao atingir o nível marcado para bloqueio, o próprio Databricks impede novas requisições
                ao Genie pros usuários no escopo definido — sem nenhuma checagem adicional do FinOps Manager
                depois de criado. Confirme que é essa a intenção antes de salvar.
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={confirmarBloqueio} onChange={(e) => setConfirmarBloqueio(e.target.checked)} style={{ width: 'auto', flexShrink: 0 }} />
                Entendo e quero bloquear o acesso ao atingir o limite
              </label>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button
            className="btn-primary"
            style={isBloqueio ? { background: 'var(--red,#ff4d6a)' } : undefined}
            disabled={salvarMutation.isPending || !podeConfirmar}
            onClick={() => salvarMutation.mutate()}
          >
            {salvarMutation.isPending
              ? 'Salvando...'
              : isBloqueio
                ? (isEdit ? 'Salvar com bloqueio' : 'Criar quota com bloqueio')
                : (isEdit ? 'Salvar alterações' : 'Salvar')}
          </button>
        </div>
      </div>
    </div>
  )
}
