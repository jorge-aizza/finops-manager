import { calcEstimado } from './calcEstimado'
import { recursoKey } from '../hooks/useCalculadora'
import { tipoRecurso } from './tipoRecurso'
import type { DbTaxaInfo, EstimativaCalculada, RecursoBilling, RecursoMesFixo, ResultadoEstimativa } from '../types/calculadora'

export interface TaxasEstimativa {
  pctImposto: number
  pctCond: number
  pctGordura: number
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
): EstimativaCalculada {
  const rMap = new Map(recursos.map((r) => [recursoKey(r), r]))
  const sel = Object.keys(selecionados)

  let totalCobrado = 0
  let totalGeral = 0
  let totalFixoMes = 0
  const recursosMes: RecursoMesFixo[] = []
  const resultados: ResultadoEstimativa[] = []

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
    resultados.push({
      resource_id: rid, nome, sku: r.meter_categories || '', categoria: r.categoria || '',
      consumed_service: r.consumed_service || '', resource_group: r.resource_group_name || '', uom: r.unidade || '',
      tipo_custo: calc.tipo, fixo_mensal: false, isHora: calc.tipo === 'hora' || calc.tipo === 'dia', horas,
      custo_hora: calc.chora, fonte_estimado: 'billing', custo_mes: calc.mesBrl, dias_ativos: calc.diasAtiv,
      total_cobrado: calc.bill, estimado_brl: calc.estimado, // gordFator aplicado abaixo
      moeda: r.moeda || 'BRL', databricks_valida: calc.dbValida, databricks_taxa: calc.taxaEf,
    })
  }

  const gordFator = 1 + taxas.pctGordura / 100
  totalGeral *= gordFator
  totalFixoMes *= gordFator
  for (const item of resultados) item.estimado_brl *= gordFator

  const vlImposto = totalGeral * taxas.pctImposto / 100
  const vlCond = totalGeral * taxas.pctCond / 100
  const totalFinal = totalGeral + vlImposto + vlCond
  const vlGordura = gordFator > 1 ? Math.round((totalGeral - totalGeral / gordFator) * 100) / 100 : 0

  return {
    total_cobrado: totalCobrado,
    total_brl: totalGeral,
    total_fixo_mes: totalFixoMes,
    recursos_mes: recursosMes,
    total_final: totalFinal,
    pct_imposto: taxas.pctImposto,
    vl_imposto: vlImposto,
    pct_cond: taxas.pctCond,
    vl_cond: vlCond,
    pct_gordura: taxas.pctGordura,
    vl_gordura: vlGordura,
    horas: chGlobal,
    resultados,
  }
}
