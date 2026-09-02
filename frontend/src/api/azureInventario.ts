import { apiFetch } from './client'
import { numFields } from './normalize'
import type {
  AzureInventarioConfig, AzureInventarioConfigInput, AzureInventarioStatus,
  AzureInventarioColetaHistoricoItem, AzureRecursoInventario, AzureAuditoriaEvento,
  AzureCrescimentoDia, AzureComparativoResposta, AzureRecursoDetalheResposta,
  AzureAnomaliaCrescimento, AzureOrcamentoInventario, AzureOrcamentoInventarioInput,
  AzureOrcamentoAlerta, AzureTagsFaltantesResposta, AzureAuditoriaPorTipo,
  AzureResumoPorAssinaturaResposta,
} from '../types/azureInventario'

export const getAzureInventarioConfig = () =>
  apiFetch<AzureInventarioConfig>('GET', '/azure-inventario/config').then((c) => numFields(c, ['retencao_dias']))

export const salvarAzureInventarioConfig = (input: AzureInventarioConfigInput) =>
  apiFetch<{ ok: boolean }>('POST', '/azure-inventario/config', input)

export const coletarAzureInventario = () =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/azure-inventario/coletar')

// Reconciliação via Resource Graph (2026-09-02) — backfill de recursos que existem mas nunca
// geraram evento no Activity Log desde a ativação do Inventário (ver server.js,
// _reconciliarInventarioResourceGraph). Mesma flag/monitor de progresso da coleta normal.
export const reconciliarAzureInventario = () =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/azure-inventario/reconciliar')

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
  resource_group?: string
  ativo?: boolean
  criado_por?: string
  data_inicio?: string
  data_fim?: string
}
export const getAzureRecursosInventario = (filtros?: AzureRecursosFiltros) => {
  const q = new URLSearchParams()
  if (filtros?.subscription_id) q.set('subscription_id', filtros.subscription_id)
  if (filtros?.resource_group) q.set('resource_group', filtros.resource_group)
  if (filtros?.ativo != null) q.set('ativo', String(filtros.ativo))
  if (filtros?.criado_por) q.set('criado_por', filtros.criado_por)
  if (filtros?.data_inicio) q.set('data_inicio', filtros.data_inicio)
  if (filtros?.data_fim) q.set('data_fim', filtros.data_fim)
  const qs = q.toString()
  return apiFetch<{ total: number; recursos: AzureRecursoInventario[] }>('GET', '/azure-inventario/recursos' + (qs ? '?' + qs : '')).then((r) => ({
    ...r,
    recursos: r.recursos.map((rec) => ({ ...rec, custo_acumulado: Number(rec.custo_acumulado), custo_resource_group: Number(rec.custo_resource_group) })),
  }))
}

export interface AzureAuditoriaFiltros {
  data_inicio?: string
  data_fim?: string
  resource_id?: string
  acao?: string
  subscription_id?: string
  resource_type?: string
}
export const getAzureAuditoriaEventos = (filtros?: AzureAuditoriaFiltros) => {
  const q = new URLSearchParams()
  if (filtros?.data_inicio) q.set('data_inicio', filtros.data_inicio)
  if (filtros?.data_fim) q.set('data_fim', filtros.data_fim)
  if (filtros?.resource_id) q.set('resource_id', filtros.resource_id)
  if (filtros?.acao) q.set('acao', filtros.acao)
  if (filtros?.subscription_id) q.set('subscription_id', filtros.subscription_id)
  if (filtros?.resource_type) q.set('resource_type', filtros.resource_type)
  const qs = q.toString()
  return apiFetch<{ periodo: { inicio: string; fim: string }; total: number; eventos: AzureAuditoriaEvento[]; por_tipo: AzureAuditoriaPorTipo[] }>(
    'GET', '/azure-inventario/auditoria' + (qs ? '?' + qs : '')
  ).then((r) => ({ ...r, por_tipo: r.por_tipo.map((t) => ({ ...t, total: Number(t.total) })) }))
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
    billing_detalhe: r.billing_detalhe,
  }))
}

// Hierarquia Assinatura → Resource Group (ver AzureResumoPorAssinaturaResposta) — sem
// subscriptionId, nível 1 (por assinatura); com subscriptionId, nível 2 (por Resource Group
// dentro dela). O 3º nível (recursos) reaproveita getAzureRecursosInventario direto.
export const getAzureResumoPorAssinatura = (subscriptionId?: string) => {
  const q = subscriptionId ? '?subscription_id=' + encodeURIComponent(subscriptionId) : ''
  return apiFetch<AzureResumoPorAssinaturaResposta>('GET', '/azure-inventario/resumo-por-assinatura' + q).then((r) => ({
    ...r,
    itens: r.itens.map((it) => ({ ...it, total: Number(it.total), por_tipo: it.por_tipo.map((t) => ({ ...t, total: Number(t.total) })) })),
  }))
}

// Governança de crescimento — anomalias (Z-score), orçamentos/teto por escopo, tags obrigatórias.

export const getAzureAnomaliasCrescimento = () =>
  apiFetch<AzureAnomaliaCrescimento[]>('GET', '/azure-inventario/anomalias').then((rows) =>
    rows.map((r) => numFields(r, ['criacoes', 'custo', 'media_criacoes', 'desvio_criacoes', 'media_custo', 'desvio_custo', 'zscore_criacoes', 'zscore_custo']))
  )

export const getAzureOrcamentosInventario = () =>
  apiFetch<AzureOrcamentoInventario[]>('GET', '/azure-inventario/orcamentos').then((rows) =>
    rows.map((r) => numFields(r, ['limite_valor', 'threshold_atencao', 'threshold_critico']))
  )

export const criarAzureOrcamentoInventario = (input: AzureOrcamentoInventarioInput) =>
  apiFetch<AzureOrcamentoInventario>('POST', '/azure-inventario/orcamentos', input)

export const atualizarAzureOrcamentoInventario = (id: number, input: AzureOrcamentoInventarioInput) =>
  apiFetch<AzureOrcamentoInventario>('PUT', `/azure-inventario/orcamentos/${id}`, input)

export const excluirAzureOrcamentoInventario = (id: number) =>
  apiFetch<{ ok: boolean }>('DELETE', `/azure-inventario/orcamentos/${id}`)

export const getAzureOrcamentosInventarioAlertas = () =>
  apiFetch<AzureOrcamentoAlerta[]>('GET', '/azure-inventario/orcamentos/alertas').then((rows) =>
    rows.map((r) => ({
      ...r,
      orcamento: numFields(r.orcamento, ['limite_valor', 'threshold_atencao', 'threshold_critico']),
      valor_atual: Number(r.valor_atual),
      pct: Number(r.pct),
    }))
  )

export const getAzureTagsFaltantes = (subscriptionId?: string) => {
  const q = subscriptionId ? '?subscription_id=' + encodeURIComponent(subscriptionId) : ''
  return apiFetch<AzureTagsFaltantesResposta>('GET', '/azure-inventario/tags-faltantes' + q)
}

// Resolve GUID→nome (criado_por/atualizado_por/autor) via Microsoft Graph — trigger manual,
// além da resolução automática ao final de toda coleta bem-sucedida. Falha (400) quando a
// permissão Directory.Read.All ainda não foi concedida à Service Principal no Entra ID.
export const resolverAutoresInventario = () =>
  apiFetch<{ resolvidos: number; pendentes: number }>('POST', '/azure-inventario/resolver-autores')
