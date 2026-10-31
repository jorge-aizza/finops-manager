import { apiFetch } from './client'
import type { WikiCategory, WikiPage, WikiPageInput, WikiPageSummary, WikiRevision } from '../types/wiki'

export function listWikiPages(busca?: string, categoria?: string): Promise<WikiPageSummary[]> {
  const params = new URLSearchParams()
  if (busca) params.set('busca', busca)
  if (categoria) params.set('categoria', categoria)
  const query = params.toString()
  return apiFetch('GET', '/wiki/pages' + (query ? `?${query}` : ''))
}

export const listWikiCategories = () => apiFetch<WikiCategory[]>('GET', '/wiki/categorias')
export const getWikiPage = (slug: string) => apiFetch<WikiPage>('GET', `/wiki/pages/${encodeURIComponent(slug)}`)
export const createWikiPage = (input: WikiPageInput) => apiFetch<WikiPage>('POST', '/wiki/pages', input)
export const updateWikiPage = (id: number, input: WikiPageInput) => apiFetch<WikiPage>('PUT', `/wiki/pages/${id}`, input)
export const publishWikiPage = (id: number) => apiFetch<WikiPageSummary>('POST', `/wiki/pages/${id}/publicar`, {})
export const archiveWikiPage = (id: number) => apiFetch<WikiPageSummary>('POST', `/wiki/pages/${id}/arquivar`, {})
export const listWikiRevisions = (id: number) => apiFetch<WikiRevision[]>('GET', `/wiki/pages/${id}/revisoes`)
export const restoreWikiRevision = (id: number, revisionId: number) =>
  apiFetch<WikiPage>('POST', `/wiki/pages/${id}/revisoes/${revisionId}/restaurar`, {})