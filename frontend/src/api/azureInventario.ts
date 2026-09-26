import { apiFetch, API_BASE, getToken } from './client'
import { numFields } from './normalize'
import type {
  AzureInventarioConfig, AzureInventarioConfigInput, AzureInventarioStatus,
  AzureInventarioColetaHistoricoItem, AzureRecursoInventario, AzureAuditoriaEvento,
  AzureCrescimentoDia, AzureCrescimentoLiquidoDia, AzureComparativoResposta, AzureRecursoDetalheResposta,
  AzureAnomaliaCrescimento, AzureOrcamentoInventario, AzureOrcamentoInventarioInput,
  AzureOrcamentoAlerta, AzureTagsFaltantesResposta, AzureAuditoriaPorTipo,
  AzureResumoPorAssinaturaResposta, AzureRecursoArmDetalhe, AzureAdvisorResposta,
  AzureRedeTopologiaResposta, AzurePropriedadeMudanca, AzureRelatorioDiario,
  AzureCrescimentoDetalheResposta, AzureTagChavesResposta, AzureAlocacaoResposta,
  AzureSerieMensalResposta, AzureCoberturaResposta, AzureDesperdicioResposta, AzureDesperdicioItem, AzureConformidadeResposta,
} from '../types/azureInventario'

export const getAzureInventarioConfig = () =>
  apiFetch<AzureInventarioConfig>('GET', '/azure-inventario/config').then((c) => numFields(c, ['retencao_dias', 'retencao_excluidos_dias']))

export const salvarAzureInventarioConfig = (input: AzureInventarioConfigInput) =>
  apiFetch<{ ok: boolean }>('POST', '/azure-inventario/config', input)

export interface RetencaoExcluidosPrevia {
  dias: number
  seriam_removidos: number
  total_excluidos: number
  total_ativos: number
}

export const getRetencaoExcluidosPrevia = (dias: number) =>
  apiFetch<RetencaoExcluidosPrevia>('GET', `/azure-inventario/retencao-excluidos/previa?dias=${dias}`)

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
  /** Ignora RG gerenciado (Databricks/AKS) — igual à contagem da anomalia de crescimento por assinatura. */
  excluir_gerenciados?: boolean
}
export const getAzureRecursosInventario = (filtros?: AzureRecursosFiltros) => {
  const q = new URLSearchParams()
  if (filtros?.excluir_gerenciados) q.set('excluir_gerenciados', 'true')
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

export interface AzurePropriedadeHistoricoFiltros {
  data_inicio?: string
  data_fim?: string
  resource_id?: string
  subscription_id?: string
}
export const getAzurePropriedadeHistorico = (filtros?: AzurePropriedadeHistoricoFiltros) => {
  const q = new URLSearchParams()
  if (filtros?.data_inicio) q.set('data_inicio', filtros.data_inicio)
  if (filtros?.data_fim) q.set('data_fim', filtros.data_fim)
  if (filtros?.resource_id) q.set('resource_id', filtros.resource_id)
  if (filtros?.subscription_id) q.set('subscription_id', filtros.subscription_id)
  const qs = q.toString()
  return apiFetch<{ periodo: { inicio: string; fim: string }; total: number; mudancas: AzurePropriedadeMudanca[] }>(
    'GET', '/azure-inventario/mudancas-propriedade' + (qs ? '?' + qs : '')
  )
}

export const getAzureRelatorioDiario = () =>
  apiFetch<AzureRelatorioDiario>('GET', '/azure-inventario/relatorio-diario')

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

// Crescimento líquido (2026-09-02) — ver AzureCrescimentoLiquidoDia.
export const getAzureCrescimentoLiquido = (data_inicio?: string, data_fim?: string) => {
  const q = new URLSearchParams()
  if (data_inicio) q.set('data_inicio', data_inicio)
  if (data_fim) q.set('data_fim', data_fim)
  const qs = q.toString()
  return apiFetch<{ periodo: { inicio: string; fim: string }; dias: AzureCrescimentoLiquidoDia[] }>(
    'GET', '/azure-inventario/crescimento-liquido' + (qs ? '?' + qs : '')
  ).then((r) => ({ ...r, dias: r.dias.map((d) => ({ ...d, ativos: Number(d.ativos) })) }))
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

// Detalhe do Crescimento Líquido (2026-09-04) — por Tipo/Resource Group + Top Criadores.
export const getAzureCrescimentoDetalhe = (data_inicio?: string, data_fim?: string) => {
  const q = new URLSearchParams()
  if (data_inicio) q.set('data_inicio', data_inicio)
  if (data_fim) q.set('data_fim', data_fim)
  const qs = q.toString()
  return apiFetch<AzureCrescimentoDetalheResposta>('GET', '/azure-inventario/crescimento-detalhe' + (qs ? '?' + qs : '')).then((r) => ({
    ...r,
    por_tipo: r.por_tipo.map((t) => numFields(t, ['inicio', 'fim', 'delta'])),
    por_resource_group: r.por_resource_group.map((t) => numFields(t, ['inicio', 'fim', 'delta'])),
    top_criadores: r.top_criadores.map((t) => numFields(t, ['total'])),
  }))
}

// Governança de crescimento — anomalias (Z-score), orçamentos/teto por escopo, tags obrigatórias.

export const getAzureAnomaliasCrescimento = () =>
  apiFetch<AzureAnomaliaCrescimento[]>('GET', '/azure-inventario/anomalias').then((rows) =>
    rows.map((r) => numFields(r, ['criacoes', 'custo', 'media_criacoes', 'desvio_criacoes', 'media_custo', 'desvio_custo', 'zscore_criacoes', 'zscore_custo']))
  )

// Crescimento de Recursos Persistentes (Phase 1, 2026-09-17)
// Rastreia apenas recursos criados há 7+ dias que continuam ativos
export const getAzureInventarioCrescimentoPersistente = () =>
  apiFetch<any[]>('GET', '/azure-inventario/crescimento-persistente').then((rows) =>
    rows.map((r) => numFields(r, ['recursos_persistentes', 'novos_persistentes', 'media', 'desvio', 'zscore']))
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

// ── Alocação de custo por tag (showback) ─────────────────────────────────────
export const getAzureTagChaves = (mesInicio?: string, mesFim?: string) => {
  const q = new URLSearchParams()
  if (mesInicio) q.set('mes_inicio', mesInicio)
  if (mesFim) q.set('mes_fim', mesFim)
  const qs = q.toString()
  return apiFetch<AzureTagChavesResposta>('GET', '/azure-costs/tag-chaves' + (qs ? '?' + qs : '')).then((r) => ({
    ...r,
    chaves: r.chaves.map((c) => numFields(c, ['valores_distintos', 'custo'])),
  }))
}

export interface AzureAlocacaoFiltros {
  chave: string
  mes_inicio?: string
  mes_fim?: string
  subscription_id?: string
}
export const getAzureAlocacaoTags = (f: AzureAlocacaoFiltros) => {
  const q = new URLSearchParams({ chave: f.chave })
  if (f.mes_inicio) q.set('mes_inicio', f.mes_inicio)
  if (f.mes_fim) q.set('mes_fim', f.mes_fim)
  if (f.subscription_id) q.set('subscription_id', f.subscription_id)
  // NUMERIC do Postgres volta como string via `pg` — normalizar na borda (armadilha já
  // documentada em api/normalize.ts).
  return apiFetch<AzureAlocacaoResposta>('GET', '/azure-costs/alocacao-tags?' + q.toString()).then((r) => ({
    ...numFields(r, ['total', 'alocado', 'nao_alocado', 'pct_alocado']),
    itens: r.itens.map((i) => numFields(i, ['custo', 'linhas', 'pct'])),
    por_mes: r.por_mes.map((m) => numFields(m, ['alocado', 'total', 'nao_alocado', 'pct_alocado'])),
  }))
}

export const getAzureSerieMensal = () =>
  apiFetch<AzureSerieMensalResposta>('GET', '/azure-costs/serie-mensal').then((r) => ({
    ...r,
    por_mes: r.por_mes.map((m) => numFields(m, ['custo'])),
  }))

export const getAzureCommitmentCobertura = (subscriptionId?: string) => {
  const q = subscriptionId ? '?subscription_id=' + encodeURIComponent(subscriptionId) : ''
  return apiFetch<AzureCoberturaResposta>('GET', '/azure-costs/commitment-cobertura' + q)
}

export const getAzureDesperdicio = (subscriptionId?: string, diasSnapshot?: number) => {
  const q = new URLSearchParams()
  if (subscriptionId) q.set('subscription_id', subscriptionId)
  if (diasSnapshot) q.set('dias_snapshot', String(diasSnapshot))
  const qs = q.toString()
  // Cache frio = ~5 consultas ao Resource Graph por assinatura (com 429): passa fácil de 30s.
  return apiFetch<AzureDesperdicioResposta>('GET', '/azure-inventario/desperdicio' + (qs ? '?' + qs : ''), undefined, 180000)
}

export const rebuildAzureAlocacaoTags = () =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/azure-costs/alocacao-tags/rebuild')

// Rebuild do cache materializado de tags por recurso (azure_recurso_tags). Responde 202 na
// hora — o build leva alguns minutos e roda em background no servidor.
export const rebuildAzureRecursoTags = () =>
  apiFetch<{ ok: boolean; message: string }>('POST', '/azure-inventario/recurso-tags/rebuild')

// Salva SÓ as tags obrigatórias — rota dedicada, não o POST /config (que grava todos os campos
// e sobrescreveria sp_id/subscription_ids se chamado de outra tela).
export const salvarTagsObrigatorias = (tags: string) =>
  apiFetch<{ ok: boolean; tags_obrigatorias: string | null }>('PUT', '/azure-inventario/tags-obrigatorias', { tags_obrigatorias: tags })

export const getAzureTagsFaltantes = (subscriptionId?: string) => {
  const q = subscriptionId ? '?subscription_id=' + encodeURIComponent(subscriptionId) : ''
  return apiFetch<AzureTagsFaltantesResposta>('GET', '/azure-inventario/tags-faltantes' + q)
}

// Resolve GUID→nome (criado_por/atualizado_por/autor) via Microsoft Graph — trigger manual,
// além da resolução automática ao final de toda coleta bem-sucedida. Falha (400) quando a
// permissão Directory.Read.All ainda não foi concedida à Service Principal no Entra ID.
export const resolverAutoresInventario = () =>
  apiFetch<{ resolvidos: number; pendentes: number }>('POST', '/azure-inventario/resolver-autores')

// ── Melhorias inspiradas no ARI (github.com/microsoft/ARI), 2026-09-02 ──────────────────

// Propriedades reais do recurso via Resource Graph — chamada ao vivo na Azure. 404 é normal
// pra recursos já excluídos (a maioria, ver comentário em server.js) — não tratado como erro
// fatal aqui, o componente decide o que mostrar.
export const getAzureRecursoArmDetalhe = (resourceId: string, subscriptionId: string) => {
  const q = new URLSearchParams({ resource_id: resourceId, subscription_id: subscriptionId })
  return apiFetch<AzureRecursoArmDetalhe>('GET', '/azure-inventario/recurso-arm-detalhe?' + q.toString())
}

// Recomendações do Azure Advisor — sem parâmetros, agrega todas as subscriptions
// configuradas pro Inventário. `category` filtra server-side.
export const getAzureAdvisor = (subscriptionId?: string, category?: string) => {
  const q = new URLSearchParams()
  if (subscriptionId) q.set('subscription_id', subscriptionId)
  if (category) q.set('category', category)
  const qs = q.toString()
  return apiFetch<AzureAdvisorResposta>('GET', '/azure-inventario/advisor' + (qs ? '?' + qs : ''))
}

// Topologia de rede (VNets/subnets/peerings) de uma assinatura.
export const getAzureRedeTopologia = (subscriptionId: string) =>
  apiFetch<AzureRedeTopologiaResposta>('GET', '/azure-inventario/rede-topologia?subscription_id=' + encodeURIComponent(subscriptionId))

// Conformidade de tags obrigatórias por subscription — apenas recursos persistentes (7+ dias)
// em RGs não-gerenciados.
export const getAzureConformidade = () =>
  apiFetch<AzureConformidadeResposta>('GET', '/azure-inventario/conformidade-por-subscription')

// Exportar Inventário pra Excel — download direto (não é JSON), mesmo padrão já usado pelo
// export de Ações legado (app.js `exportarExcel()`): fetch com Bearer token (apiFetch não
// serve aqui, ele sempre espera JSON) → blob → link temporário → clique → revoke.
// Excel de Desperdício no layout do Excel de Ações FinOps — envia os itens já filtrados na tela.
export async function baixarAzureDesperdicioExcel(itens: AzureDesperdicioItem[], filtrosDescricao: string) {
  const token = getToken()
  const resp = await fetch(API_BASE + '/azure-inventario/desperdicio/export/excel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
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
  a.download = 'FinOps_Desperdicio_' + new Date().toISOString().slice(0, 10) + '.xlsx'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export async function baixarAzureInventarioExcel(filtros?: { subscription_id?: string; ativo?: boolean }) {
  const q = new URLSearchParams()
  if (filtros?.subscription_id) q.set('subscription_id', filtros.subscription_id)
  if (filtros?.ativo != null) q.set('ativo', String(filtros.ativo))
  const qs = q.toString()
  const token = getToken()
  const resp = await fetch(API_BASE + '/azure-inventario/export/excel' + (qs ? '?' + qs : ''), {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'Erro desconhecido' }))
    throw new Error(err.error || 'Erro ao exportar')
  }
  const blob = await resp.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'inventario-azure-' + new Date().toISOString().slice(0, 10) + '.xlsx'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
