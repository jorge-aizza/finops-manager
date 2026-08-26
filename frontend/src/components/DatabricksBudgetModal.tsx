import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createDatabricksBudget, updateDatabricksBudget } from '../api/databricksColeta'
import type { DatabricksBudget } from '../types/databricksResumo'

interface Props {
  budget: DatabricksBudget | null
  workspaces: string[]
  onClose: () => void
}

export default function DatabricksBudgetModal({ budget, workspaces, onClose }: Props) {
  const queryClient = useQueryClient()
  const [nome, setNome] = useState(budget?.nome || '')
  const [workspaceId, setWorkspaceId] = useState(budget?.workspace_id || '')
  const [valorMensal, setValorMensal] = useState(budget?.valor_mensal?.toString() || '')
  const [ativo, setAtivo] = useState(budget?.ativo ?? true)

  const salvarMutation = useMutation({
    mutationFn: () => {
      const input = { nome, workspace_id: workspaceId || null, valor_mensal: parseFloat(valorMensal) || 0, ativo }
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
            <label htmlFor="dbxb-ws">Escopo</label>
            <select id="dbxb-ws" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
              <option value="">Todos os workspaces</option>
              {workspaces.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="dbxb-valor">Valor mensal (R$)</label>
            <input id="dbxb-valor" type="number" min={0} step="0.01" value={valorMensal} onChange={(e) => setValorMensal(e.target.value)} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} style={{ width: 'auto', flexShrink: 0 }} />
            <span style={{ fontSize: 13 }}>Ativo (participa do alerta de estouro)</span>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={salvarMutation.isPending || !nome || !valorMensal} onClick={() => salvarMutation.mutate()}>
            {salvarMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
