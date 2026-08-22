import { apiFetch } from './client'
import type { PortalConfig } from '../types/portal'

// Sem token — usuário anônimo. apiFetch já lida bem com isso (só não envia
// Authorization se não achar 'finops_token' em sessionStorage/localStorage,
// o que nunca vai existir aqui).
export const getPortalConfig = () => apiFetch<PortalConfig>('GET', '/public/calculadora/config')

export const identificar = (nome: string, email: string) =>
  apiFetch<{ ok: boolean; nome: string; email: string }>('POST', '/public/calculadora/identificar', { nome, email })
