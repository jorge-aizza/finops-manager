// Cliente de API único para o bundle React — unifica o comportamento das
// duas implementações legadas divergentes (api() em app.js, _api() dentro
// da IIFE Calculadora em calculadora.js). Segue o padrão de api() (mais
// seguro): lança em resposta não-2xx e desloga em 401, reaproveitando
// window.logout() já existente em app.js em vez de reimplementar logout.
//
// Mesma origem de token/URL do sistema legado — não inventa um novo esquema
// de auth: sessionStorage tem prioridade sobre localStorage, mesma chave
// 'finops_token'.

const API_BASE = window.location.origin + '/api'

export class ApiError extends Error {}

function getToken(): string | null {
  return sessionStorage.getItem('finops_token') || localStorage.getItem('finops_token')
}

export async function apiFetch<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 30000,
): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const token = getToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = 'Bearer ' + token

    const res = await fetch(API_BASE + path, {
      method,
      headers,
      signal: ctrl.signal,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (res.status === 401) {
      window.logout?.(false)
      throw new ApiError('Sessão expirada')
    }

    const data = await res.json()
    if (!res.ok) throw new ApiError(data?.error || 'Erro desconhecido')
    return data as T
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError(
        `Servidor não respondeu em ${timeoutMs / 1000}s — verifique se o servidor está rodando`,
      )
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}
