import { apiFetch } from './client'
import type { GenieBudget, GenieBudgetInput, GeniePrincipal } from '../types/genieBudgets'

export const listGenieBudgets = () => apiFetch<GenieBudget[]>('GET', '/databricks-coleta/genie-budgets')

export const createGenieBudget = (input: GenieBudgetInput) =>
  apiFetch<GenieBudget>('POST', '/databricks-coleta/genie-budgets', input)

export const deleteGenieBudget = (id: string) =>
  apiFetch<{ ok: boolean }>('DELETE', `/databricks-coleta/genie-budgets/${encodeURIComponent(id)}`)

// Busca usuário (por e-mail exato) ou grupo (por nome exato) via Account SCIM API —
// resolve o principal_id numérico exigido pelos overrides individuais (ver
// GenieBudgetPrincipalOverride, types/genieBudgets.ts).
export const searchGeniePrincipals = (tipo: 'user' | 'group', query: string) =>
  apiFetch<GeniePrincipal[]>('GET', `/databricks-coleta/genie-principals?tipo=${tipo}&query=${encodeURIComponent(query)}`)
