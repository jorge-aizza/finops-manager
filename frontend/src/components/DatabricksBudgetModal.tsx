import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createDatabricksBudget, getDatabricksTagKeys, getDatabricksTagValues, updateDatabricksBudget } from '../api/databricksColeta'
import type { DatabricksBudget, DatabricksBudgetEscopoTipo } from '../types/databricksResumo'

interface Props {
  budget: DatabricksBudget | null
  workspaces: string[]
  onClose: () => void
}

export default function DatabricksBudgetModal({ budget, workspaces, onClose }: Props) {
  const queryClient = useQueryClient()
  const [nome, setNome] = useState(budget?.nome || '')
  const [escopoTipo, setEscopoTipo] = useState<DatabricksBudgetEscopoTipo>(budget?.escopo_tipo || (workspaces.length ? 'workspace' : 'global'))
  const [workspaceId, setWorkspaceId] = useState(budget?.workspace_id || '')
  const [tagKey, setTagKey] = useState(budget?.tag_key || '')
  const [tagValor, setTagValor] = useState(budget?.tag_valor || '')
  const [valorMensal, setValorMensal] = useState(budget?.valor_mensal?.toString() || '')
  const [thresholdAtencao, setThresholdAtencao] = useState(budget?.threshold_atencao?.toString() || '75')
  const [thresholdCritico, setThresholdCritico] = useState(budget?.threshold_critico?.toString() || '90')
  const [ativo, setAtivo] = useState(budget?.ativo ?? true)

  const tagKeysQuery = useQuery({ queryKey: ['databricks-tag-keys'], queryFn: getDatabricksTagKeys, enabled: escopoTipo === 'tag' })
  const tagValuesQuery = useQuery({
    queryKey: ['databricks-tag-values', tagKey],
    queryFn: () => getDatabricksTagValues(tagKey),
    enabled: escopoTipo === 'tag' && !!tagKey,
  })

  const thAtencaoNum = parseFloat(thresholdAtencao)
  const thCriticoNum = parseFloat(thresholdCritico)
  const thresholdsValidos = thAtencaoNum > 0 && thAtencaoNum < 100 && thCriticoNum > thAtencaoNum && thCriticoNum <= 100
  const escopoValido = escopoTipo === 'global' || (escopoTipo === 'workspace' && !!workspaceId) || (escopoTipo === 'tag' && !!tagKey && !!tagValor)

  const salvarMutation = useMutation({
    mutationFn: () => {
      const input = {
        nome,
        escopo_tipo: escopoTipo,
        workspace_id: escopoTipo === 'workspace' ? workspaceId : null,
        tag_key: escopoTipo === 'tag' ? tagKey : null,
        tag_valor: escopoTipo === 'tag' ? tagValor : null,
        valor_mensal: parseFloat(valorMensal) || 0,
        threshold_atencao: thAtencaoNum,
        threshold_critico: thCriticoNum,
        ativo,
      }
      return budget ? updateDatabricksBudget(budget.id, input) : createDatabricksBudget(input)
    },
    onSuccess: () => {
      window.showToast?.('Orçamento salvo.', 'success')
      queryClient.invalidateQueries({ queryKey: ['databricks-budgets'] })
      queryClient.invalidateQueries({ queryKey: ['databricks-alertas'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar orçamento: ' + e.message, 'error'),
  })

  function handleEscopoTipoChange(v: DatabricksBudgetEscopoTipo) {
    setEscopoTipo(v)
    if (v !== 'tag') { setTagKey(''); setTagValor('') }
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span>{budget ? 'Editar Orçamento' : 'Novo Orçamento'}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="dbxb-nome">Nome</label>
            <input id="dbxb-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Orçamento mensal — time de Dados" />
          </div>
          <div className="form-group">
            <label htmlFor="dbxb-escopo-tipo">Tipo de escopo</label>
            <select id="dbxb-escopo-tipo" value={escopoTipo} onChange={(e) => handleEscopoTipoChange(e.target.value as DatabricksBudgetEscopoTipo)}>
              <option value="global">Global (todos os workspaces)</option>
              <option value="workspace">Um workspace específico</option>
              <option value="tag">Por tag (projeto, time, centro de custo...)</option>
            </select>
          </div>
          {escopoTipo === 'workspace' && (
            <div className="form-group">
              <label htmlFor="dbxb-ws">Workspace</label>
              <select id="dbxb-ws" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
                <option value="">Selecione...</option>
                {workspaces.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
          )}
          {escopoTipo === 'tag' && (
            <>
              <div className="form-group">
                <label htmlFor="dbxb-tag-key">Chave da tag</label>
                <input
                  id="dbxb-tag-key" list="dbxb-tag-key-options" value={tagKey}
                  onChange={(e) => { setTagKey(e.target.value); setTagValor('') }}
                  placeholder="Ex: projeto, time, centro_custo"
                />
                <datalist id="dbxb-tag-key-options">
                  {(tagKeysQuery.data || []).map((k) => <option key={k} value={k} />)}
                </datalist>
              </div>
              <div className="form-group">
                <label htmlFor="dbxb-tag-valor">Valor da tag</label>
                <input
                  id="dbxb-tag-valor" list="dbxb-tag-valor-options" value={tagValor}
                  onChange={(e) => setTagValor(e.target.value)}
                  placeholder="Ex: finops-core, Dados"
                  disabled={!tagKey}
                />
                <datalist id="dbxb-tag-valor-options">
                  {(tagValuesQuery.data || []).map((v) => <option key={v} value={v} />)}
                </datalist>
              </div>
            </>
          )}
          <div className="form-group">
            <label htmlFor="dbxb-valor">Valor mensal (R$)</label>
            <input id="dbxb-valor" type="number" min={0} step="0.01" value={valorMensal} onChange={(e) => setValorMensal(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="dbxb-th-atencao">Alertar em (%)</label>
              <input id="dbxb-th-atencao" type="number" min={1} max={99} step={1} value={thresholdAtencao} onChange={(e) => setThresholdAtencao(e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="dbxb-th-critico">Crítico em (%)</label>
              <input id="dbxb-th-critico" type="number" min={1} max={100} step={1} value={thresholdCritico} onChange={(e) => setThresholdCritico(e.target.value)} />
            </div>
          </div>
          {!thresholdsValidos && (
            <div style={{ fontSize: 11, color: 'var(--danger)' }}>
              "Crítico" deve ser maior que "Alertar" e ambos entre 1 e 100. 100% ou mais é sempre tratado como estourado.
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} style={{ width: 'auto', flexShrink: 0 }} />
            <span style={{ fontSize: 13 }}>Ativo (participa do alerta de estouro)</span>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button
            className="btn-primary"
            disabled={salvarMutation.isPending || !nome || !valorMensal || !thresholdsValidos || !escopoValido}
            onClick={() => salvarMutation.mutate()}
          >
            {salvarMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
