import { apiFetch } from './client'
import { numFields } from './normalize'
import type {
  AzureCostsDiag, DetalheDiarioRow, PorServicoRow, Reconciliacao, RecursoBilling,
  RecursosQuery, ResourceGroupOption, SubscriptionOption,
} from '../types/calculadora'

export const listSubscriptions = () =>
  apiFetch<SubscriptionOption[]>('GET', '/calculadora/subscriptions')

// Porta de _diagCache()/_forcarRefreshCache() (calculadora.js) — exibido no
// dropdown de Assinatura quando a lista vem vazia, pra diagnosticar se é
// falta de import ou cache desatualizado.
export const diagAzureCosts = () => apiFetch<AzureCostsDiag>('GET', '/azure-costs/diag')
export const refreshAzureCache = () => apiFetch<{ subs: number }>('POST', '/azure-costs/refresh-cache')

export const listResourceGroups = (subscriptionIds: string[]) =>
  apiFetch<ResourceGroupOption[]>('GET', '/calculadora/resource-groups?subscription_id=' + encodeURIComponent(subscriptionIds.join(',')))

// Exportado para reuso em api/calculadoraPublica.ts — mesmo shape de linha,
// mesma necessidade de normalização (colunas NUMERIC do Postgres voltam como
// string via `pg`; ver frontend/src/api/normalize.ts).
export const RECURSO_NUM_FIELDS: (keyof RecursoBilling)[] = [
  'taxa_cambio', 'custo_hora_billing', 'taxa_hora_rate', 'custo_uom_billing', 'custo_uom_usd',
  'dias_ativos', 'total_billing', 'total_usd', 'total_qty', 'custo_mes_billing', 'custo_dia_billing',
  'custo_dia_usd', 'custo_hora_usd', 'total_upq_brl', 'total_upq_usd', 'horas_reais', 'soma_h_driver',
  'custo_hora_pico', 'custo_hora_pico_cluster', 'pico_custo_rg', 'pico_h_driver', 'pico_custo_dia', 'pico_horas_dia',
  'pico_cluster_custo_rg', 'pico_cluster_horas_dia',
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
  // Bug real corrigido: nomes de RG do Azure são case-insensitive (a Azure preserva a grafia
  // original mas nunca trata "RG-X" e "rg-x" como recursos diferentes), mas o `parent_rg`
  // resolvido pelo servidor (_resolveParentRgs, server.js) às vezes vem numa grafia diferente
  // da que o RG pai realmente tem em `resource_group_name` — ex: filho resolvido com
  // `parent_rg: "RG-ADBX-DAUD-BRSOUTH-001-DEV"` (maiúsculo), mas o RG pai real na lista é
  // `"rg-adbx-daud-brsouth-001-dev"` (minúsculo). Um Map chaveado pelo texto exato nunca batia
  // nesses casos — o pai (que realmente estava na lista!) nunca era encontrado, e o filho virava
  // "raiz" incorretamente. Efeito visto pelo usuário: workspaces Databricks distintos (cada um
  // com seu próprio RG pai, todos presentes na lista) apareciam soltos, sem nenhum agrupamento
  // visível — ao contrário do esperado (cada RG gerenciado agrupado sob o pai real). Corrigido
  // casando por UPPERCASE — mesma convenção já usada em outros lugares do app pra comparar RG
  // (ex: server.js sempre usa UPPER(resource_group_name) nas queries).
  const byNameUpper = new Map(rgs.map((r) => [r.resource_group_name.toUpperCase(), r]))
  // Órfãos de verdade (pai realmente ausente da lista — ex: filtro de resource_groups[] do
  // Portal Público liberou só o filho, ou o pai não tem billing direto e nunca aparece na
  // lista de RGs distintos) também viram raiz, com parent_rg normalizado pra null — sem isso,
  // CmsMultiSelect.tsx (via `parentValue: r.parent_rg`) desenharia "↳ " + indentação como se o
  // item fosse filho de algo sem nenhum pai visível pra associar.
  const raiz = rgs
    .map((r) => (r.parent_rg && !byNameUpper.has(r.parent_rg.toUpperCase())) ? { ...r, parent_rg: null } : r)
    .filter((r) => !r.parent_rg)
    .sort((a, b) => a.resource_group_name.localeCompare(b.resource_group_name))
  const filhosPorPai = new Map<string, ResourceGroupOption[]>()
  for (const r of rgs) {
    const pai = r.parent_rg && byNameUpper.get(r.parent_rg.toUpperCase())
    if (pai) {
      // Agrupa pela grafia REAL do pai (pai.resource_group_name), não pela grafia do
      // parent_rg resolvido — é essa grafia real que aparece como chave abaixo, na raiz.
      const paiKey = pai.resource_group_name
      if (!filhosPorPai.has(paiKey)) filhosPorPai.set(paiKey, [])
      filhosPorPai.get(paiKey)!.push(r)
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
