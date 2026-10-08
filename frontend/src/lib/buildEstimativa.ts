import { calcEstimado } from './calcEstimado'
import { recursoKey } from '../hooks/useCalculadora'
import { tipoRecurso } from './tipoRecurso'
import type { DbTaxaInfo, EstimativaCalculada, RecursoBilling, RecursoMesFixo, ResultadoEstimativa } from '../types/calculadora'

export interface TaxasEstimativa {
  pctImposto: number
  pctCond: number
  pctGordura: number
}

export interface ImpostoCategoria {
  ativo: boolean
  taxa: number
}

// Imposto por categoria (2026-09-29): Serviço Microsoft x Marketplace, a mesma taxa já
// refletida nos valores reais de coleta (Órfãos, alocação, alertas, Reconciliação — tudo
// exceto Databricks). Quando pelo menos uma categoria está ativa, substitui o imposto único
// (`taxas.pctImposto`) por essa classificação por `publisher_type`, resource a resource — o
// mesmo campo que `azure_costs`/`RecursoBilling.publisher_type` já carrega. Sem nenhuma
// categoria ativa, cai no comportamento antigo (flat `pctImposto`), pra nunca ficar sem
// imposto nenhum só porque o admin não configurou o split ainda.
export interface ImpostoSplit {
  microsoft: ImpostoCategoria
  marketplace: ImpostoCategoria
}

// Porta fiel do bloco final de _atualizarEstimativa() (calculadora.js) que
// monta `_estimativa` — Subtotal/Total e o payload do invoice vêm exatamente
// desta mesma conta, pra nunca divergir entre a tela e o PDF gerado depois.
export function buildEstimativa(
  recursos: RecursoBilling[],
  selecionados: Record<string, number>,
  dbTaxaMap: Map<string, DbTaxaInfo>,
  taxas: TaxasEstimativa,
  taxaBrl: number,
  chGlobal: number,
  impostoSplit?: ImpostoSplit,
): EstimativaCalculada {
  const rMap = new Map(recursos.map((r) => [recursoKey(r), r]))
  const sel = Object.keys(selecionados)

  let totalCobrado = 0
  let totalGeral = 0
  let totalGeralMicrosoft = 0
  let totalGeralMarketplace = 0
  let totalGeralComImposto = 0
  let totalFixoMes = 0
  const recursosMes: RecursoMesFixo[] = []
  const resultados: ResultadoEstimativa[] = []

  // gordFator/splitAtivo não dependem de nenhum total acumulado no loop — computar antes pra
  // poder embutir imposto por recurso (Microsoft/Marketplace, conforme `publisher_type` de cada
  // um) já na hora de montar `estimado_brl`, em vez de só no agregado final.
  const gordFator = 1 + taxas.pctGordura / 100
  const usaSplitImposto = impostoSplit !== undefined
  const taxaImpostoDoRecurso = (r: RecursoBilling): number => usaSplitImposto
    ? (r.publisher_type === 'Marketplace'
      ? (impostoSplit!.marketplace.ativo ? impostoSplit!.marketplace.taxa : 0)
      : (impostoSplit!.microsoft.ativo ? impostoSplit!.microsoft.taxa : 0))
    : taxas.pctImposto

  for (const rid of sel) {
    const r = rMap.get(rid)
    if (!r) continue
    const isBRL = (r.moeda || 'BRL') === 'BRL'
    const tcDB = Number(r.taxa_cambio) || 0
    const convR = !isBRL ? (tcDB > 1 ? tcDB : taxaBrl) : 1
    totalCobrado += (Number(r.total_billing) || 0) * convR

    const horas = selecionados[rid] || 720
    const calc = calcEstimado(r, horas, dbTaxaMap, taxaBrl)
    const nome = r.nome_recurso || rid.split('/').filter(Boolean).pop() || rid.slice(0, 50)

    if (calc.tipo === 'mes') {
      totalFixoMes += calc.mesBrl
      recursosMes.push({ nome, uom: r.unidade || '—', valor: calc.mesBrl, tipo: tipoRecurso(r), svc: r.consumed_service || '—', cat: r.categoria || '—' })
      resultados.push({
        resource_id: rid, nome, sku: r.meter_categories || '', categoria: r.categoria || '',
        consumed_service: r.consumed_service || '', resource_group: r.resource_group_name || '', uom: r.unidade || '',
        tipo_custo: 'mes', fixo_mensal: true, isHora: false, horas: 0, custo_hora: 0, fonte_estimado: 'billing',
        custo_mes: calc.mesBrl, dias_ativos: calc.diasAtiv, total_cobrado: calc.bill,
        estimado_brl: calc.mesBrl, // gordura aplicada abaixo, junto com totalFixoMes
        moeda: r.moeda || 'BRL',
      })
      continue
    }

    totalGeral += calc.estimado
    if (r.publisher_type === 'Marketplace') totalGeralMarketplace += calc.estimado
    else totalGeralMicrosoft += calc.estimado
    // Cada linha já sai com gordura + imposto embutidos (taxa da própria categoria do recurso,
    // Microsoft ou Marketplace) — alinhado com o resto do sistema (Recursos Órfãos, Log
    // Analytics etc.), onde o custo por recurso já vem com imposto, não como um total à parte.
    const estimadoComImposto = calc.estimado * gordFator * (1 + taxaImpostoDoRecurso(r) / 100)
    totalGeralComImposto += estimadoComImposto
    resultados.push({
      resource_id: rid, nome, sku: r.meter_categories || '', categoria: r.categoria || '',
      consumed_service: r.consumed_service || '', resource_group: r.resource_group_name || '', uom: r.unidade || '',
      tipo_custo: calc.tipo, fixo_mensal: false, isHora: calc.tipo === 'hora' || calc.tipo === 'dia', horas,
      custo_hora: calc.chora, fonte_estimado: 'billing', custo_mes: calc.mesBrl, dias_ativos: calc.diasAtiv,
      total_cobrado: calc.bill, estimado_brl: estimadoComImposto,
      moeda: r.moeda || 'BRL', databricks_valida: calc.dbValida, databricks_taxa: calc.taxaEf,
    })
  }

  totalGeral *= gordFator
  totalGeralMicrosoft *= gordFator
  totalGeralMarketplace *= gordFator
  totalFixoMes *= gordFator
  for (const item of resultados) { if (item.fixo_mensal) item.estimado_brl *= gordFator }

  const vlImposto = usaSplitImposto
    ? totalGeralMicrosoft * (impostoSplit!.microsoft.ativo ? impostoSplit!.microsoft.taxa / 100 : 0)
      + totalGeralMarketplace * (impostoSplit!.marketplace.ativo ? impostoSplit!.marketplace.taxa / 100 : 0)
    : totalGeral * taxas.pctImposto / 100
  // Taxa "efetiva" só pra exibição (ex: "+ Imposto (18,7%)") — com o split, a taxa varia
  // conforme a mistura Microsoft/Marketplace de cada seleção, então mostra a média ponderada
  // real em vez do número fixo de uma categoria só.
  const pctImpostoExibido = usaSplitImposto
    ? (totalGeral > 0 ? Math.round((vlImposto / totalGeral) * 10000) / 100 : 0)
    : taxas.pctImposto
  // Condomínio continua incidindo sobre o valor SEM imposto (totalGeral) — igual a hoje — pra
  // não compor imposto-sobre-imposto; isso mantém `total_final` numericamente idêntico a antes
  // dessa mudança (totalGeralComImposto já é totalGeral + vlImposto, só embutido por recurso).
  const vlCond = totalGeral * taxas.pctCond / 100
  const totalFinal = totalGeralComImposto + vlCond
  const vlGordura = gordFator > 1 ? Math.round((totalGeral - totalGeral / gordFator) * 100) / 100 : 0

  return {
    total_cobrado: totalCobrado,
    total_brl: totalGeralComImposto,
    total_fixo_mes: totalFixoMes,
    recursos_mes: recursosMes,
    total_final: totalFinal,
    pct_imposto: pctImpostoExibido,
    vl_imposto: vlImposto,
    pct_cond: taxas.pctCond,
    vl_cond: vlCond,
    pct_gordura: taxas.pctGordura,
    vl_gordura: vlGordura,
    horas: chGlobal,
    resultados,
  }
}
