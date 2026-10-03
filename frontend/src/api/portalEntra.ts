import { API_BASE } from './client'
import type { PortalIdentSessao } from '../types/portal'
import type { GenieCotasPublicaResposta } from '../types/genieCotasPublica'

const SS_PORTAL_ENTRA_TOKEN = 'portal_entra_token'

// Login PARALELO do portal via Microsoft Entra ID (server.js: /api/public/auth/entra/*) —
// nunca é o mesmo token/sessão do app interno (getToken() de ./client lê 'finops_token',
// outra chave; os dois nunca se misturam).
export function getPortalEntraToken(): string | null {
  try { return sessionStorage.getItem(SS_PORTAL_ENTRA_TOKEN) } catch { return null }
}
export function setPortalEntraToken(token: string) {
  try { sessionStorage.setItem(SS_PORTAL_ENTRA_TOKEN, token) } catch { /* ambiente sem storage */ }
}
export function clearPortalEntraToken() {
  try { sessionStorage.removeItem(SS_PORTAL_ENTRA_TOKEN) } catch { /* ambiente sem storage */ }
}

export async function getPortalEntraLoginUrl(): Promise<string> {
  const r = await fetch(API_BASE + '/public/auth/entra/url')
  const d = await r.json()
  if (!r.ok) throw new Error(d.error || 'Erro ao iniciar login.')
  return d.url
}

export async function consumePortalEntraHandoff(code: string): Promise<{ token: string; user: PortalIdentSessao }> {
  const r = await fetch(API_BASE + '/public/auth/entra/consume?code=' + encodeURIComponent(code))
  const d = await r.json()
  if (!r.ok) throw new Error(d.error || 'Código de login inválido ou expirado.')
  return d
}

export async function getGenieCotasPublica(): Promise<GenieCotasPublicaResposta> {
  const token = getPortalEntraToken()
  const r = await fetch(API_BASE + '/public/genie-cotas', {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  })
  const d = await r.json()
  if (r.status === 401) { clearPortalEntraToken(); throw new Error(d.error || 'Sessão expirada.') }
  if (!r.ok) throw new Error(d.error || 'Erro ao carregar sua cota Genie.')
  return d
}
