import { apiFetch } from './client'
import type { GenieBudget, GenieBudgetInput, GeniePrincipal, GenieQuotaUsuarioResposta } from '../types/genieBudgets'

export const listGenieBudgets = () => apiFetch<GenieBudget[]>('GET', '/databricks-coleta/genie-budgets')

export const createGenieBudget = (input: GenieBudgetInput) =>
  apiFetch<GenieBudget>('POST', '/databricks-coleta/genie-budgets', input)

// PUT — substituição total (a Budgets API do Databricks não tem PATCH parcial).
export const updateGenieBudget = (id: string, input: GenieBudgetInput) =>
  apiFetch<GenieBudget>('PUT', `/databricks-coleta/genie-budgets/${encodeURIComponent(id)}`, input)

export const deleteGenieBudget = (id: string) =>
  apiFetch<{ ok: boolean }>('DELETE', `/databricks-coleta/genie-budgets/${encodeURIComponent(id)}`)

// Busca usuário (por e-mail exato) ou grupo (por nome exato) via Account SCIM API —
// resolve o principal_id numérico exigido pelos overrides individuais (ver
// GenieBudgetPrincipalOverride, types/genieBudgets.ts).
export const searchGeniePrincipals = (tipo: 'user' | 'group', query: string) =>
  apiFetch<GeniePrincipal[]>('GET', `/databricks-coleta/genie-principals?tipo=${tipo}&query=${encodeURIComponent(query)}`)

// Quota Genie nativa (Budgets API) aplicável a um usuário — distinta do orçamento local
// (getDatabricksCotas). `workspaceId` opcional restringe aos budgets que filtram por ele.
export const getGenieQuotaUsuario = (usuario: string, workspaceId?: string | null) => {
  const q = new URLSearchParams({ usuario })
  if (workspaceId) q.set('workspace_id', workspaceId)
  return apiFetch<GenieQuotaUsuarioResposta>('GET', `/databricks-coleta/genie-quota-usuario?${q.toString()}`)
}
