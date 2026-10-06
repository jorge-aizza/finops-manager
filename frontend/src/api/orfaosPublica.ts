import { apiFetch, API_BASE } from './client'
import type { OrfaosPublicaResposta, OrfaoItem } from '../types/orfaosPublica'

// Cache frio no servidor = consultas ao Resource Graph: passa fácil de 30s.
export const getOrfaosPublica = () =>
  apiFetch<OrfaosPublicaResposta>('GET', '/public/orfaos', undefined, 180000)

// Mesmo padrão anônimo (sem token) das demais rotas públicas — o endpoint só reempacota os
// itens que o cliente já recebeu de getOrfaosPublica(), sanitizados, em um Excel formatado.
export async function baixarOrfaosPublicaExcel(itens: OrfaoItem[], filtrosDescricao: string) {
  const resp = await fetch(API_BASE + '/public/orfaos/export/excel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itens, filtros_descricao: filtrosDescricao }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Erro desconhecido' }))
    throw new Error(err.error || 'Erro ao exportar')
  }
  const blob = await resp.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'FinOps_RecursosOrfaos_' + new Date().toISOString().slice(0, 10) + '.xlsx'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
