import { apiFetch } from './client'
import { numFields } from './normalize'
import type {
  DetalheDiarioRow, PorServicoRow, Reconciliacao, RecursoBilling,
  RecursosQuery, ResourceGroupOption, SubscriptionOption,
} from '../types/calculadora'

export const listSubscriptions = () =>
  apiFetch<SubscriptionOption[]>('GET', '/calculadora/subscriptions')

export const listResourceGroups = (subscriptionIds: string[]) =>
  apiFetch<ResourceGroupOption[]>('GET', '/calculadora/resource-groups?subscription_id=' + encodeURIComponent(subscriptionIds.join(',')))

const RECURSO_NUM_FIELDS: (keyof RecursoBilling)[] = [
  'taxa_cambio', 'custo_hora_billing', 'taxa_hora_rate', 'custo_uom_billing', 'custo_uom_usd',
  'dias_ativos', 'total_billing', 'total_usd', 'total_qty', 'custo_mes_billing', 'custo_dia_billing',
  'custo_dia_usd', 'custo_hora_usd', 'total_upq_brl', 'total_upq_usd', 'horas_reais', 'soma_h_driver',
  'custo_hora_pico', 'custo_hora_pico_cluster', 'pico_custo_rg', 'pico_h_driver', 'pico_custo_dia', 'pico_horas_dia',
]

// Query pesada (sem paginação, timeout de rede maior que o default do
// apiFetch) — o servidor abre conexão dedicada com statement_timeout=120s.
export const getRecursos = (q: RecursosQuery) => {
  const params = new URLSearchParams({
    subscription_id: q.subscription_id.join(','),
    resource_group: q.resource_group.join(','),
    data_inicio: q.data_inicio,
    data_fim: q.data_fim,
  })
  if (q.pico) params.set('pico', '1')
  return apiFetch<RecursoBilling[]>('GET', '/calculadora/recursos?' + params.toString(), undefined, 3 * 60 * 1000)
    .then((rows) => rows.map((r) => numFields(r, RECURSO_NUM_FIELDS)))
}

export const getReconciliacao = (q: Omit<RecursosQuery, 'pico'>) => {
  const params = new URLSearchParams({
    subscription_id: q.subscription_id.join(','),
    resource_group: q.resource_group.join(','),
    data_inicio: q.data_inicio,
    data_fim: q.data_fim,
  })
  // Números já vêm normalizados pelo servidor (parseFloat/parseInt antes do
  // res.json) — sem necessidade de numFields() aqui.
  return apiFetch<Reconciliacao>('GET', '/calculadora/reconciliacao?' + params.toString())
}

const DETALHE_NUM_FIELDS: (keyof DetalheDiarioRow)[] = ['cost']
export const getDetalheDiario = (q: Omit<RecursosQuery, 'pico'>) => {
  const params = new URLSearchParams({
    subscription_id: q.subscription_id.join(','),
    resource_group: q.resource_group.join(','),
    data_inicio: q.data_inicio,
    data_fim: q.data_fim,
  })
  return apiFetch<DetalheDiarioRow[]>('GET', '/calculadora/detalhe-diario?' + params.toString())
    .then((rows) => rows.map((r) => numFields(r, DETALHE_NUM_FIELDS)))
}

const SERVICO_NUM_FIELDS: (keyof PorServicoRow)[] = ['qtd_recursos', 'qtd_rgs', 'total_brl']
export const getPorServico = (q: Omit<RecursosQuery, 'pico'>) => {
  const params = new URLSearchParams({
    subscription_id: q.subscription_id.join(','),
    resource_group: q.resource_group.join(','),
    data_inicio: q.data_inicio,
    data_fim: q.data_fim,
  })
  return apiFetch<PorServicoRow[]>('GET', '/calculadora/por-servico?' + params.toString())
    .then((rows) => rows.map((r) => numFields(r, SERVICO_NUM_FIELDS)))
}

// Porta de _sortRgsComFilhos — ordena a lista de RGs pra que filhos
// gerenciados (Databricks/AKS) apareçam logo depois do RG pai resolvido,
// em vez de espalhados em ordem alfabética pura.
export function sortRgsComFilhos(rgs: ResourceGroupOption[]): ResourceGroupOption[] {
  const byName = new Map(rgs.map((r) => [r.resource_group_name, r]))
  const raiz = rgs.filter((r) => !r.parent_rg || !byName.has(r.parent_rg))
    .sort((a, b) => a.resource_group_name.localeCompare(b.resource_group_name))
  const filhosPorPai = new Map<string, ResourceGroupOption[]>()
  for (const r of rgs) {
    if (r.parent_rg && byName.has(r.parent_rg)) {
      if (!filhosPorPai.has(r.parent_rg)) filhosPorPai.set(r.parent_rg, [])
      filhosPorPai.get(r.parent_rg)!.push(r)
    }
  }
  const out: ResourceGroupOption[] = []
  for (const r of raiz) {
    out.push(r)
    const filhos = (filhosPorPai.get(r.resource_group_name) || [])
      .sort((a, b) => a.resource_group_name.localeCompare(b.resource_group_name))
    out.push(...filhos)
  }
  return out
}
