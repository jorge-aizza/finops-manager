import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createGenieBudget } from '../api/genieBudgets'
import type { GenieActionType, GenieBudgetTagInput, GenieScopeType } from '../types/genieBudgets'

interface Props {
  onClose: () => void
}

// Cria uma quota Genie via Databricks Account Budgets API (resource_type=
// BUDGET_RESOURCE_TYPE_UNITY_AI_GATEWAY) — a Databricks aplica isso de verdade,
// inclusive podendo BLOQUEAR acesso ao Genie (action_type=BLOCK_USAGE). Sem edição
// nem múltiplos thresholds nesta v1 (a API suporta até 4 compartilhados + 20
// overrides por usuário — deliberadamente simplificado aqui pra 1 threshold, dado o
// risco de configurar algo tão sensível sem poder validar contra uma conta real).
export default function GenieBudgetModal({ onClose }: Props) {
  const queryClient = useQueryClient()
  const [nome, setNome] = useState('')
  const [workspaceIdsRaw, setWorkspaceIdsRaw] = useState('')
  const [tags, setTags] = useState<GenieBudgetTagInput[]>([])
  const [valor, setValor] = useState('')
  const [scopeType, setScopeType] = useState<GenieScopeType>('ALERT_CONFIGURATION_SCOPE_TYPE_SHARED')
  const [actionType, setActionType] = useState<GenieActionType>('EMAIL_NOTIFICATION')
  const [emailTarget, setEmailTarget] = useState('')
  const [confirmarBloqueio, setConfirmarBloqueio] = useState(false)

  const workspaceIds = workspaceIdsRaw.split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !isNaN(n))

  function addTag() { setTags((t) => [...t, { key: '', value: '' }]) }
  function updateTag(i: number, field: 'key' | 'value', v: string) {
    setTags((t) => t.map((tag, idx) => (idx === i ? { ...tag, [field]: v } : tag)))
  }
  function removeTag(i: number) { setTags((t) => t.filter((_, idx) => idx !== i)) }

  const isBloqueio = actionType === 'BLOCK_USAGE'
  const podeConfirmar = !!nome && !!valor && parseFloat(valor) > 0 && (!isBloqueio || confirmarBloqueio)

  const salvarMutation = useMutation({
    mutationFn: () => createGenieBudget({
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
    }),
    onSuccess: () => {
      window.showToast?.('Quota Genie criada no Databricks.', 'success')
      queryClient.invalidateQueries({ queryKey: ['genie-budgets'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao criar quota Genie: ' + e.message, 'error'),
  })

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span>🧞 Nova Quota Genie</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 14 }}>
            Cria um orçamento nativo no Databricks (Unity AI Gateway) — o próprio Databricks aplica o limite, não o FinOps Manager. Valores em <strong>USD</strong> (moeda usada pela API de billing do Databricks).
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
            {salvarMutation.isPending ? 'Salvando...' : isBloqueio ? 'Criar quota com bloqueio' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
