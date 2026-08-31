import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { criarAzureOrcamentoInventario, atualizarAzureOrcamentoInventario } from '../api/azureInventario'
import { listResourceGroups } from '../api/calculadora'
import type { AzureOrcamentoEscopoTipo, AzureOrcamentoInventario, AzureOrcamentoTipoLimite } from '../types/azureInventario'

// Orçamento/teto de crescimento — pedido do usuário ("quais melhorias vc me sugere para
// poder ter o controle de crescimento de recursos na cloud"). Mesmo padrão de
// DatabricksBudgetModal.tsx (escopo + threshold configurável), mas escopado por
// subscription/Resource Group (não workspace/tag) e com 2 tipos de limite: contagem de
// recursos ativos, ou custo do mês corrente.

interface Props {
  orcamento: AzureOrcamentoInventario | null
  subscriptions: { subscription_id: string; subscription_name: string | null }[]
  onClose: () => void
}

export default function InventarioOrcamentoModal({ orcamento, subscriptions, onClose }: Props) {
  const queryClient = useQueryClient()
  const [nome, setNome] = useState(orcamento?.nome || '')
  const [escopoTipo, setEscopoTipo] = useState<AzureOrcamentoEscopoTipo>(orcamento?.escopo_tipo || 'subscription')
  const [subscriptionId, setSubscriptionId] = useState(orcamento?.subscription_id || '')
  const [resourceGroup, setResourceGroup] = useState(orcamento?.resource_group || '')
  const [tipoLimite, setTipoLimite] = useState<AzureOrcamentoTipoLimite>(orcamento?.tipo_limite || 'recursos')
  const [limiteValor, setLimiteValor] = useState(orcamento?.limite_valor?.toString() || '')
  const [thresholdAtencao, setThresholdAtencao] = useState(orcamento?.threshold_atencao?.toString() || '75')
  const [thresholdCritico, setThresholdCritico] = useState(orcamento?.threshold_critico?.toString() || '90')
  const [ativo, setAtivo] = useState(orcamento?.ativo ?? true)

  const rgsQuery = useQuery({
    queryKey: ['calc-rgs', subscriptionId],
    queryFn: () => listResourceGroups([subscriptionId]),
    enabled: escopoTipo === 'resource_group' && !!subscriptionId,
  })

  const thAtencaoNum = parseFloat(thresholdAtencao)
  const thCriticoNum = parseFloat(thresholdCritico)
  const thresholdsValidos = thAtencaoNum > 0 && thAtencaoNum < 100 && thCriticoNum > thAtencaoNum && thCriticoNum <= 100
  const escopoValido = !!subscriptionId && (escopoTipo === 'subscription' || (escopoTipo === 'resource_group' && !!resourceGroup))
  const limiteValido = parseFloat(limiteValor) > 0

  const salvarMutation = useMutation({
    mutationFn: () => {
      const input = {
        nome,
        escopo_tipo: escopoTipo,
        subscription_id: subscriptionId,
        resource_group: escopoTipo === 'resource_group' ? resourceGroup : null,
        tipo_limite: tipoLimite,
        limite_valor: parseFloat(limiteValor) || 0,
        threshold_atencao: thAtencaoNum,
        threshold_critico: thCriticoNum,
        ativo,
      }
      return orcamento ? atualizarAzureOrcamentoInventario(orcamento.id, input) : criarAzureOrcamentoInventario(input)
    },
    onSuccess: () => {
      window.showToast?.('Orçamento salvo.', 'success')
      queryClient.invalidateQueries({ queryKey: ['azure-inv-orcamentos'] })
      queryClient.invalidateQueries({ queryKey: ['azure-inv-orcamentos-alertas'] })
      onClose()
    },
    onError: (e: Error) => window.showToast?.('Erro ao salvar orçamento: ' + e.message, 'error'),
  })

  function handleEscopoTipoChange(v: AzureOrcamentoEscopoTipo) {
    setEscopoTipo(v)
    if (v !== 'resource_group') setResourceGroup('')
  }

  return (
    <div className="modal-overlay open" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span>{orcamento ? 'Editar Orçamento' : 'Novo Orçamento'}</span>
          <button className="modal-close" aria-label="Fechar" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="invorc-nome">Nome</label>
            <input id="invorc-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Teto de recursos — ambiente Dev" />
          </div>
          <div className="form-group">
            <label htmlFor="invorc-sub">Subscription</label>
            <select id="invorc-sub" value={subscriptionId} onChange={(e) => { setSubscriptionId(e.target.value); setResourceGroup('') }}>
              <option value="">Selecione...</option>
              {subscriptions.map((s) => <option key={s.subscription_id} value={s.subscription_id}>{s.subscription_name || s.subscription_id}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="invorc-escopo-tipo">Escopo</label>
            <select id="invorc-escopo-tipo" value={escopoTipo} onChange={(e) => handleEscopoTipoChange(e.target.value as AzureOrcamentoEscopoTipo)}>
              <option value="subscription">Toda a subscription</option>
              <option value="resource_group">Um Resource Group específico</option>
            </select>
          </div>
          {escopoTipo === 'resource_group' && (
            <div className="form-group">
              <label htmlFor="invorc-rg">Resource Group</label>
              <input
                id="invorc-rg" list="invorc-rg-options" value={resourceGroup}
                onChange={(e) => setResourceGroup(e.target.value)}
                placeholder="Ex: databricks-rg-dbw-nfcom-dev-..."
                disabled={!subscriptionId}
              />
              <datalist id="invorc-rg-options">
                {(rgsQuery.data || []).map((rg) => <option key={rg.resource_group_name} value={rg.resource_group_name} />)}
              </datalist>
            </div>
          )}
          <div className="form-group">
            <label htmlFor="invorc-tipo-limite">Tipo de limite</label>
            <select id="invorc-tipo-limite" value={tipoLimite} onChange={(e) => setTipoLimite(e.target.value as AzureOrcamentoTipoLimite)}>
              <option value="recursos">Quantidade de recursos ativos</option>
              <option value="custo">Custo do mês corrente (R$)</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="invorc-limite">{tipoLimite === 'custo' ? 'Limite mensal (R$)' : 'Limite de recursos'}</label>
            <input id="invorc-limite" type="number" min={0} step={tipoLimite === 'custo' ? '0.01' : '1'} value={limiteValor} onChange={(e) => setLimiteValor(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="invorc-th-atencao">Alertar em (%)</label>
              <input id="invorc-th-atencao" type="number" min={1} max={99} step={1} value={thresholdAtencao} onChange={(e) => setThresholdAtencao(e.target.value)} />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label htmlFor="invorc-th-critico">Crítico em (%)</label>
              <input id="invorc-th-critico" type="number" min={1} max={100} step={1} value={thresholdCritico} onChange={(e) => setThresholdCritico(e.target.value)} />
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
            disabled={salvarMutation.isPending || !nome || !limiteValido || !thresholdsValidos || !escopoValido}
            onClick={() => salvarMutation.mutate()}
          >
            {salvarMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
