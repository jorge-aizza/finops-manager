import { API_BASE, ApiError, apiFetch, getToken } from './client'
import type {
  MailingCampanha, MailingCampanhaInput, MailingCampanhaProgresso, MailingContato,
  MailingContatoStatus, MailingEnvio, MailingImportLote, MailingTemplate, MailingTemplateInput,
} from '../types/mailing'

// ── Contatos (cadastro único) ──────────────────────────────────────
export const listContatos = (busca?: string, status?: MailingContatoStatus) => {
  const qs = new URLSearchParams()
  if (busca) qs.set('busca', busca)
  if (status) qs.set('status', status)
  const q = qs.toString()
  return apiFetch<MailingContato[]>('GET', '/mailing/contatos' + (q ? '?' + q : ''))
}

export const criarContato = (input: { email: string; nome?: string }) =>
  apiFetch<{ ok: boolean }>('POST', '/mailing/contatos', input)

export const atualizarContato = (id: number, input: { nome?: string; status?: MailingContatoStatus }) =>
  apiFetch<{ ok: boolean }>('PATCH', '/mailing/contatos/' + id, input)

export const excluirContato = (id: number) =>
  apiFetch<{ ok: boolean }>('DELETE', '/mailing/contatos/' + id)

export const listImportLotes = () =>
  apiFetch<MailingImportLote[]>('GET', '/mailing/import-lotes')

// Upload multipart — mesmo motivo de uploadImportFile (api/coleta.ts): apiFetch fixa
// Content-Type application/json, incompatível com FormData.
export async function importarContatos(file: File): Promise<MailingImportLote> {
  const fd = new FormData()
  fd.append('arquivo', file)
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch(API_BASE + '/mailing/contatos/import', { method: 'POST', headers, body: fd })
  if (res.status === 401) { window.logout?.(false); throw new ApiError('Sessão expirada') }
  const data = await res.json().catch(() => ({}) as { error?: string })
  if (!res.ok) throw new ApiError((data as { error?: string }).error || `Erro HTTP ${res.status}`)
  return data as MailingImportLote
}

// Upload de imagem do composer — mesma mecânica de FormData, devolve a URL pública
// (servida em /mailing-uploads/*) pra inserir no editor.
export async function uploadImagemMailing(file: File): Promise<{ ok: boolean; url: string }> {
  const fd = new FormData()
  fd.append('imagem', file)
  const token = getToken()
  const headers: Record<string, string> = {}
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch(API_BASE + '/mailing/upload-imagem', { method: 'POST', headers, body: fd })
  if (res.status === 401) { window.logout?.(false); throw new ApiError('Sessão expirada') }
  const data = await res.json().catch(() => ({}) as { error?: string })
  if (!res.ok) throw new ApiError((data as { error?: string }).error || `Erro HTTP ${res.status}`)
  return data as { ok: boolean; url: string }
}

// ── Campanhas ───────────────────────────────────────────────────────
export const listCampanhas = () =>
  apiFetch<MailingCampanha[]>('GET', '/mailing/campanhas')

export const getCampanha = (id: number) =>
  apiFetch<MailingCampanha>('GET', '/mailing/campanhas/' + id)

export const criarCampanha = (input: MailingCampanhaInput) =>
  apiFetch<MailingCampanha>('POST', '/mailing/campanhas', input)

export const atualizarCampanha = (id: number, input: MailingCampanhaInput) =>
  apiFetch<{ ok: boolean }>('PUT', '/mailing/campanhas/' + id, input)

export const excluirCampanha = (id: number) =>
  apiFetch<{ ok: boolean }>('DELETE', '/mailing/campanhas/' + id)

export const enviarTesteCampanha = (id: number, email: string) =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/mailing/campanhas/' + id + '/enviar-teste', { email }, 20000)

export const enviarCampanha = (id: number) =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/mailing/campanhas/' + id + '/enviar', {}, 20000)

export const reenviarFalhasCampanha = (id: number) =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/mailing/campanhas/' + id + '/reenviar-falhas', {}, 20000)

export const cancelarCampanha = (id: number) =>
  apiFetch<{ ok: boolean }>('POST', '/mailing/campanhas/' + id + '/cancelar')

export const getProgressoCampanha = (id: number) =>
  apiFetch<MailingCampanhaProgresso>('GET', '/mailing/campanhas/' + id + '/progresso')

export const listEnviosCampanha = (id: number) =>
  apiFetch<MailingEnvio[]>('GET', '/mailing/campanhas/' + id + '/envios')

// ── Modelos (templates) ──────────────────────────────────────────
export const listTemplates = () =>
  apiFetch<MailingTemplate[]>('GET', '/mailing/templates')

export const salvarTemplate = (input: MailingTemplateInput) =>
  apiFetch<MailingTemplate>('POST', '/mailing/templates', input)

export const excluirTemplate = (id: number) =>
  apiFetch<{ ok: boolean }>('DELETE', '/mailing/templates/' + id)
