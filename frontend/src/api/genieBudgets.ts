import { apiFetch } from './client'
import type { GenieBudget, GenieBudgetInput } from '../types/genieBudgets'

export const listGenieBudgets = () => apiFetch<GenieBudget[]>('GET', '/databricks-coleta/genie-budgets')

export const createGenieBudget = (input: GenieBudgetInput) =>
  apiFetch<GenieBudget>('POST', '/databricks-coleta/genie-budgets', input)

export const deleteGenieBudget = (id: string) =>
  apiFetch<{ ok: boolean }>('DELETE', `/databricks-coleta/genie-budgets/${encodeURIComponent(id)}`)
