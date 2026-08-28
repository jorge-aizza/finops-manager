import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createGenieBudget, searchGeniePrincipals, updateGenieBudget } from '../api/genieBudgets'
import type { GenieActionType, GenieBudget, GenieBudgetTagInput, GeniePrincipal, GenieScopeType } from '../types/genieBudgets'

interface Props {
  budget?: GenieBudget | null
  onClose: () => void
}

interface OverrideRow {
  principal_id: number
  nome: string
  override_threshold: string
}

// Cria (ou edita — PUT é substituição total, a Budgets API não tem PATCH parcial) uma
// quota Genie via Databricks Account Budgets API (resource_type=
// BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY) — a Databricks aplica isso de verdade,
// inclusive podendo BLOQUEAR acesso ao Genie (action_type=BLOCK_USAGE). Múltiplos
// thresholds compartilhados (a API suporta até 4) continuam fora do escopo — só o
// primeiro threshold é editável por aqui, dado o risco de configurar algo tão sensível
// sem poder validar contra uma conta real.
export default function GenieBudgetModal({ budget, onClose }: Props) {
  const isEdit = !!budget
  const alertaExistente = budget?.alert_configurations?.[0]
  const queryClient = useQueryClient()
  const [nome, setNome] = useState(budget?.display_name || '')
  const [workspaceIdsRaw, setWorkspaceIdsRaw] = useState(budget?.filter?.workspace_id?.values?.join(', ') || '')
  const [tags, setTags] = useState<GenieBudgetTagInput[]>(
    budget?.filter?.tags?.map((t) => ({ key: t.key, value: t.value?.values?.[0] || '' })) || [],
  )
  const [valor, setValor] = useState(alertaExistente?.quantity_threshold || '')
  const [scopeType, setScopeType] = useState<GenieScopeType>((alertaExistente?.scope_type as GenieScopeType) || 'ALERT_CONFIGURATION_SCOPE_TYPE_SHARED')
  const [actionType, setActionType] = useState<GenieActionType>((alertaExistente?.action_configurations?.[0]?.action_type as GenieActionType) || 'EMAIL_NOTIFICATION')
  const [emailTarget, setEmailTarget] = useState(alertaExistente?.action_configurations?.[0]?.target || '')
  // Sempre começa desmarcado, mesmo editando uma quota que já bloqueia — exige uma
  // confirmação nova a cada alteração salva, não só na criação original.
  const [confirmarBloqueio, setConfirmarBloqueio] = useState(false)

  // Overrides — limite individual por usuário (busca por e-mail) ou grupo (busca por
  // nome) via Account SCIM API, resolvendo pro principal_id numérico que a Budgets API
  // exige. Só faz sentido (e só é aceito pelo servidor) com escopo "Por usuário" — ver
  // guard-rail em POST/PUT /genie-budgets. Overrides já existentes (vindos de `budget`)
  // não têm nome/e-mail na resposta da API — só principal_id —, então mostram "ID: N"
  // até serem removidos; novos overrides adicionados na mesma sessão de edição mostram
  // o nome real (resolvido pela busca).
  const [overrideTipo, setOverrideTipo] = useState<'user' | 'group'>('user')
  const [overrideQuery, setOverrideQuery] = useState('')
  const [overrideResultados, setOverrideResultados] = useState<GeniePrincipal[]>([])
  const [overrideBuscando, setOverrideBuscando] = useState(false)
  const [overrides, setOverrides] = useState<OverrideRow[]>(
    alertaExistente?.principal_overrides?.map((o) => ({
      principal_id: o.principal_id, nome: `ID: ${o.principal_id}`, override_threshold: o.override_threshold,
    })) || [],
  )

  const workspaceIds = workspaceIdsRaw.split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !isNaN(n))
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

  const overridesValidos = overrides.every((o) => o.override_threshold && parseFloat(o.override_threshold) > 0)
  const isBloqueio = actionType === 'BLOCK_USAGE'
  const podeConfirmar = !!nome && !!valor && parseFloat(valor) > 0 && (!isBloqueio || confirmarBloqueio) && overridesValidos

  const salvarMutation = useMutation({
    mutationFn: () => {
      const input = {
        display_name: nome,
        workspace_ids: workspaceIds,
        tags: tags.filter((t) => t.key && t.value),
        threshold: {
          quantity_threshold: valor,
          scope_type: scopeType,
          action_type: actionType,
          email_target: actionType === 'EMAIL_NOTIFICATION' ? (emailTarget || undefined) : undefined,
        },
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
            {isEdit ? 'Atualiza' : 'Cria'} um orçamento nativo no Databricks (Unity AI Gateway) — o próprio Databricks aplica o limite, não o FinOps Manager. Valores em <strong>USD</strong> (moeda usada pela API de billing do Databricks).
          </div>
          <div className="form-group">
            <label htmlFor="gb-nome">Nome</label>
            <input id="gb-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Quota Genie — Time de Dados" />
          </div>
          <div className="form-group">
            <label htmlFor="gb-ws">Workspace IDs (opcional, separados por vírgula)</label>
            <input id="gb-ws" value={workspaceIdsRaw} onChange={(e) => setWorkspaceIdsRaw(e.target.value)} placeholder="Ex: 123456, 789012 — vazio = toda a conta" />
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
            <label htmlFor="gb-valor">Limite mensal (US$)</label>
            <input id="gb-valor" type="number" min={0} step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} />
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
                  placeholder={overrideTipo === 'user' ? 'e-mail exato' : 'nome exato do grupo'}
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
            <label htmlFor="gb-acao">Ação ao atingir o limite</label>
            <select id="gb-acao" value={actionType} onChange={(e) => { setActionType(e.target.value as GenieActionType); setConfirmarBloqueio(false) }}>
              <option value="EMAIL_NOTIFICATION">Enviar alerta por e-mail (usuários mantêm acesso)</option>
              <option value="BLOCK_USAGE">Bloquear acesso ao Genie</option>
            </select>
          </div>
          {actionType === 'EMAIL_NOTIFICATION' && (
            <div className="form-group">
              <label htmlFor="gb-email">E-mail de destino (opcional)</label>
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
                Assim que o consumo atingir o limite configurado, o próprio Databricks impede novas requisições
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
