import { apiFetch } from './client'

// Simulador de Preços (Portal Público) — busca sobre o catálogo público da Azure
// (azure_price_list, já sincronizado em Configurações → Price List). Sem token, mesmo padrão
// anônimo de api/portal.ts — dado público, não é billing do tenant.

export interface PriceSimItem {
  produto: string | null
  sku: string | null
  meter: string | null
  unidade: string | null
  preco_brl: number
  regiao: string | null
  // service_family do catálogo — usado para agrupar a estimativa por tipo de recurso.
  categoria?: string | null
}

export interface PriceSimBusca {
  itens: PriceSimItem[]
  total: number
  page: number
  por_pagina: number
}

export interface VmFamilia {
  produto: string
  skus: number
  preco_min: number
}

// Famílias de VM do catálogo, para o drill-down tipo → família → tamanho do assistente.
export const getVmFamilias = (params: { regiao?: string; so?: string; modelo?: string }) => {
  const qs = new URLSearchParams()
  if (params.regiao) qs.set('regiao', params.regiao)
  if (params.so) qs.set('so', params.so)
  if (params.modelo) qs.set('modelo', params.modelo)
  const suffix = qs.toString()
  return apiFetch<VmFamilia[]>('GET', '/public/price-simulator/vm-familias' + (suffix ? '?' + suffix : ''))
}

export const getVmSkus = (params: { produto: string; regiao?: string; so?: string; modelo?: string }) => {
  const qs = new URLSearchParams()
  qs.set('produto', params.produto)
  if (params.regiao) qs.set('regiao', params.regiao)
  if (params.so) qs.set('so', params.so)
  if (params.modelo) qs.set('modelo', params.modelo)
  return apiFetch<PriceSimBusca>('GET', '/public/price-simulator/vm-skus?' + qs.toString())
}

export const getPriceSimCategorias = () =>
  apiFetch<string[]>('GET', '/public/price-simulator/categorias')

export const getPriceSimRegioes = () =>
  apiFetch<string[]>('GET', '/public/price-simulator/regioes')

export interface FacetaItem {
  nome: string
  meters: number
  preco_min: number
  categoria?: string
}

// Catálogo inteiro da região num só retorno (produto + categoria), para o assistente montar
// as caixas de serviço.
export const getCatalogo = (regiao?: string) => {
  const qs = new URLSearchParams({ nivel: 'catalogo' })
  if (regiao) qs.set('regiao', regiao)
  return apiFetch<{ nivel: string; itens: FacetaItem[] }>('GET', '/public/price-simulator/facetas?' + qs.toString())
}

// Opções do catálogo para a busca manual em dois níveis: sem `produto` devolve os produtos
// (famílias de VM, serviços), com `produto` devolve os SKUs/tiers dele.
export const getFacetas = (params: { categoria?: string; regiao?: string; produto?: string }) => {
  const qs = new URLSearchParams()
  if (params.categoria) qs.set('categoria', params.categoria)
  if (params.regiao) qs.set('regiao', params.regiao)
  if (params.produto) qs.set('produto', params.produto)
  const suffix = qs.toString()
  return apiFetch<{ nivel: 'produto' | 'sku'; itens: FacetaItem[] }>('GET', '/public/price-simulator/facetas' + (suffix ? '?' + suffix : ''))
}

export const buscarPrecos = (params: { categoria?: string; regiao?: string; q?: string; produto?: string; produtos?: string[]; sku?: string; comPreco?: boolean; page?: number }) => {
  const qs = new URLSearchParams()
  if (params.categoria) qs.set('categoria', params.categoria)
  if (params.regiao) qs.set('regiao', params.regiao)
  if (params.q) qs.set('q', params.q)
  if (params.produto) qs.set('produto', params.produto)
  if (params.produtos?.length) qs.set('produtos', params.produtos.join('|'))
  if (params.sku) qs.set('sku', params.sku)
  if (params.comPreco) qs.set('comPreco', '1')
  if (params.page) qs.set('page', String(params.page))
  const suffix = qs.toString()
  return apiFetch<PriceSimBusca>('GET', '/public/price-simulator/buscar' + (suffix ? '?' + suffix : ''))
}
