import { apiFetch } from './client'
import { numFields } from './normalize'
import type {
  AzureInventarioConfig, AzureInventarioConfigInput, AzureInventarioStatus,
  AzureInventarioColetaHistoricoItem, AzureRecursoInventario, AzureAuditoriaEvento,
  AzureCrescimentoDia, AzureComparativoResposta, AzureRecursoDetalheResposta,
} from '../types/azureInventario'

export const getAzureInventarioConfig = () =>
  apiFetch<AzureInventarioConfig>('GET', '/azure-inventario/config').then((c) => numFields(c, ['retencao_dias']))

export const salvarAzureInventarioConfig = (input: AzureInventarioConfigInput) =>
  apiFetch<{ ok: boolean }>('POST', '/azure-inventario/config', input)

export const coletarAzureInventario = () =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/azure-inventario/coletar')

export const getAzureInventarioStatus = () =>
  apiFetch<AzureInventarioStatus>('GET', '/azure-inventario/status')

export const getAzureInventarioColetaHistorico = () =>
  apiFetch<AzureInventarioColetaHistoricoItem[]>('GET', '/azure-inventario/coleta-historico').then((rows) =>
    rows.map((r) => numFields(r, ['eventos_processados', 'recursos_novos', 'recursos_atualizados', 'recursos_excluidos']))
  )

export const limparAzureInventarioColetaHistorico = () =>
  apiFetch<{ ok: boolean }>('DELETE', '/azure-inventario/coleta-historico')

export interface AzureRecursosFiltros {
  subscription_id?: string
  ativo?: boolean
  criado_por?: string
  data_inicio?: string
  data_fim?: string
}
export const getAzureRecursosInventario = (filtros?: AzureRecursosFiltros) => {
  const q = new URLSearchParams()
  if (filtros?.subscription_id) q.set('subscription_id', filtros.subscription_id)
  if (filtros?.ativo != null) q.set('ativo', String(filtros.ativo))
  if (filtros?.criado_por) q.set('criado_por', filtros.criado_por)
  if (filtros?.data_inicio) q.set('data_inicio', filtros.data_inicio)
  if (filtros?.data_fim) q.set('data_fim', filtros.data_fim)
  const qs = q.toString()
  return apiFetch<{ total: number; recursos: AzureRecursoInventario[] }>('GET', '/azure-inventario/recursos' + (qs ? '?' + qs : '')).then((r) => ({
    ...r,
    recursos: r.recursos.map((rec) => ({ ...rec, custo_acumulado: Number(rec.custo_acumulado) })),
  }))
}

export interface AzureAuditoriaFiltros {
  data_inicio?: string
  data_fim?: string
  resource_id?: string
  acao?: string
  subscription_id?: string
}
export const getAzureAuditoriaEventos = (filtros?: AzureAuditoriaFiltros) => {
  const q = new URLSearchParams()
  if (filtros?.data_inicio) q.set('data_inicio', filtros.data_inicio)
  if (filtros?.data_fim) q.set('data_fim', filtros.data_fim)
  if (filtros?.resource_id) q.set('resource_id', filtros.resource_id)
  if (filtros?.acao) q.set('acao', filtros.acao)
  if (filtros?.subscription_id) q.set('subscription_id', filtros.subscription_id)
  const qs = q.toString()
  return apiFetch<{ periodo: { inicio: string; fim: string }; total: number; eventos: AzureAuditoriaEvento[] }>(
    'GET', '/azure-inventario/auditoria' + (qs ? '?' + qs : '')
  )
}

export const getAzureCrescimento = (data_inicio?: string, data_fim?: string, subscription_id?: string) => {
  const q = new URLSearchParams()
  if (data_inicio) q.set('data_inicio', data_inicio)
  if (data_fim) q.set('data_fim', data_fim)
  if (subscription_id) q.set('subscription_id', subscription_id)
  const qs = q.toString()
  return apiFetch<{ periodo: { inicio: string; fim: string }; dias: AzureCrescimentoDia[] }>(
    'GET', '/azure-inventario/crescimento' + (qs ? '?' + qs : '')
  ).then((r) => ({ ...r, dias: r.dias.map((d) => ({ ...d, recursos: Number(d.recursos) })) }))
}

const normalizeComparativoPeriodo = (p: AzureComparativoResposta['periodo_a']) => ({
  ...p,
  total_recursos: Number(p.total_recursos),
  custo_total: Number(p.custo_total),
  criados: Number(p.criados),
  atualizados: Number(p.atualizados),
  excluidos: Number(p.excluidos),
})

export interface AzureComparativoParams {
  a_inicio: string
  a_fim: string
  b_inicio: string
  b_fim: string
  subscription_id?: string
}
export const getAzureInventarioComparativo = (params: AzureComparativoParams) => {
  const q = new URLSearchParams({ a_inicio: params.a_inicio, a_fim: params.a_fim, b_inicio: params.b_inicio, b_fim: params.b_fim })
  if (params.subscription_id) q.set('subscription_id', params.subscription_id)
  return apiFetch<AzureComparativoResposta>('GET', '/azure-inventario/comparativo?' + q.toString()).then((r) => ({
    periodo_a: normalizeComparativoPeriodo(r.periodo_a),
    periodo_b: normalizeComparativoPeriodo(r.periodo_b),
  }))
}

export const getAzureRecursoDetalhe = (resourceId: string, subscriptionId: string) => {
  const q = new URLSearchParams({ resource_id: resourceId, subscription_id: subscriptionId })
  return apiFetch<AzureRecursoDetalheResposta>('GET', '/azure-inventario/recurso-detalhe?' + q.toString()).then((r) => ({
    recurso: { ...r.recurso, custo_acumulado: Number(r.recurso.custo_acumulado) },
    eventos: r.eventos,
    custo_diario: r.custo_diario.map((d) => ({ ...d, custo: Number(d.custo) })),
    custo_resource_group: Number(r.custo_resource_group),
    resource_group_recursos: Number(r.resource_group_recursos),
  }))
}
