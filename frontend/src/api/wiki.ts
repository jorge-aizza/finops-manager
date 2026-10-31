import { API_BASE, ApiError, apiFetch, getToken } from './client'
import type { WikiCategory, WikiImportedDocument, WikiPage, WikiPageInput, WikiPageSummary, WikiRevision } from '../types/wiki'

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
export const deleteWikiPage = (id: number) => apiFetch<{ ok: boolean; id: number }>('DELETE', `/wiki/pages/${id}`)
export const listWikiRevisions = (id: number) => apiFetch<WikiRevision[]>('GET', `/wiki/pages/${id}/revisoes`)
export const restoreWikiRevision = (id: number, revisionId: number) =>
  apiFetch<WikiPage>('POST', `/wiki/pages/${id}/revisoes/${revisionId}/restaurar`, {})

async function uploadWikiFile<T>(path: string, field: string, file: File): Promise<T> {
  const form = new FormData()
  form.append(field, file)
  const token = getToken()
  const response = await fetch(API_BASE + path, {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    body: form,
  })
  if (response.status === 401) {
    window.logout?.(false)
    throw new ApiError('Sessão expirada')
  }
  const data = await response.json().catch(() => ({}) as { error?: string })
  if (!response.ok) throw new ApiError((data as { error?: string }).error || `Erro HTTP ${response.status}`)
  return data as T
}

export const uploadWikiImage = (file: File) =>
  uploadWikiFile<{ mediaId: number; mimeType: string }>('/wiki/midias/imagens', 'imagem', file)

export const importWikiDocument = (file: File) =>
  uploadWikiFile<WikiImportedDocument>('/wiki/importar', 'documento', file)

export async function fetchWikiImage(mediaId: number): Promise<Blob> {
  const token = getToken()
  const response = await fetch(`${API_BASE}/wiki/midias/${mediaId}`, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  })
  if (response.status === 401) {
    window.logout?.(false)
    throw new ApiError('Sessão expirada')
  }
  if (!response.ok) throw new ApiError('Imagem indisponível')
  return response.blob()
}