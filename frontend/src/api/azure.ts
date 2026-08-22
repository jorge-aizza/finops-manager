import { apiFetch } from './client'
import type { AzureResourceGroup, AzureSubscription } from '../types/reserva'

// Mesmos endpoints já usados pela Calculadora (calculadora.js) — cache
// pré-agregada (azure_subs_cache/azure_rg_cache), não é chamada ARM ao vivo.
export const listSubscriptions = () =>
  apiFetch<AzureSubscription[]>('GET', '/calculadora/subscriptions')

export const listResourceGroups = (subscriptionId?: string) => {
  const qs = subscriptionId ? '?subscription_id=' + encodeURIComponent(subscriptionId) : ''
  return apiFetch<AzureResourceGroup[]>('GET', '/calculadora/resource-groups' + qs)
}
