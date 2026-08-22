import type { DbTaxaInfo, EstimadoResult, RecursoBilling, TipoCusto } from '../types/calculadora'

// Porta fiel de _calcEstimado/_dbInfoParaRecurso/_dbComputeTaxas (calculadora.js)
// — fonte única do cálculo financeiro por recurso, usada pelos cards do
// overlay Configurar Estimativa e pelo Subtotal/Total. NÃO mudar a ordem ou
// a fórmula de nenhum passo aqui: qualquer divergência do legado produz um
// número de estimativa de custo errado (é uma calculadora financeira real).
// Não aplica "gordura" — cada chamador multiplica `estimado` pelo próprio
// fator de gordura (1 + pctGordura/100).

const TAXA_BRL_FALLBACK = 5.70

export function calcEstimado(r: RecursoBilling, horas: number, dbTaxaMap: Map<string, DbTaxaInfo>, taxaBrl = TAXA_BRL_FALLBACK): EstimadoResult {
  const isBRL = (r.moeda || 'BRL') === 'BRL'
  const uom = (r.unidade || '').toLowerCase()
  const tipo: TipoCusto = r.tipo_custo || (uom.includes('hour') || uom.includes('hora') ? 'hora' : 'periodo')
  const tcDB = Number(r.taxa_cambio) || 0
  const convR = !isBRL ? (tcDB > 1 ? tcDB : taxaBrl) : 1

  const choraRaw = Number(r.custo_hora_billing) || 0
  const taxaAmort = r.usa_amortizado && choraRaw === 0 ? Number(r.taxa_hora_rate) || 0 : 0
  const chora = (choraRaw > 0 ? choraRaw : taxaAmort) * convR
  const custoUomRaw = Number(r.custo_uom_billing) || 0
  const custoUomBrl = isBRL ? custoUomRaw : custoUomRaw * convR
  const diasAtiv = parseInt(String(r.dias_ativos ?? 1)) || 1
  const totalBill = Number(r.total_billing) || 0
  const mesRaw = Number(r.custo_mes_billing) || (totalBill / diasAtiv * 30)
  const mesBrl = mesRaw * convR
  const bill = totalBill * convR

  // RN-DB-001: Databricks cluster rate — billing_recurso / H_driver
  const dbInfo = tipo === 'hora' ? dbInfoParaRecurso(r, dbTaxaMap) : null
  const dbValida = !!(dbInfo && dbInfo.valida)
  const taxaEf = dbValida && dbInfo!.hDriver > 0 ? bill / dbInfo!.hDriver : chora

  // Estimado: pico do período quando disponível; senão billing
  const upqBrl = (Number(r.total_upq_brl) || 0) * convR
  const fallback = upqBrl > 0 ? (upqBrl / diasAtiv * 30) : mesBrl
  const picoRaw = Number(r.custo_hora_pico) || 0
  const picoBrl = picoRaw > 0 ? picoRaw * convR : 0
  const usaPico = picoBrl > 0 && tipo !== 'reserva' && tipo !== 'mes' && !dbValida
  const picoClusterRaw = Number(r.custo_hora_pico_cluster) || 0
  const picoClusterBrl = picoClusterRaw > 0 ? picoClusterRaw * convR : 0
  const usaPicoCluster = dbValida && picoClusterBrl > 0

  const estimado = (tipo === 'mes')
    ? mesBrl
    : usaPicoCluster
      ? picoClusterBrl * horas
      : usaPico
        ? picoBrl * horas
        : (tipo === 'periodo')
          ? fallback / 720 * horas
          : taxaEf * horas

  return {
    tipo, isBRL, convR, chora, custoUomBrl, diasAtiv, mesBrl, bill,
    dbInfo, dbValida, taxaEf, picoBrl, picoClusterBrl, usaPico, usaPicoCluster,
    estimado,
  }
}

function dbInfoParaRecurso(r: RecursoBilling, dbTaxaMap: Map<string, DbTaxaInfo>): DbTaxaInfo | null {
  const rg = (r.resource_group_name || '').toLowerCase()
  if (!rg.startsWith('databricks-rg-')) return null
  return dbTaxaMap.get(rg) || null
}

// Roda uma vez por busca (não a cada merge de pico) — igual ao legado, que
// não re-executa _dbComputeTaxas() após o merge de `?pico=1` (os campos que
// ele usa — total_billing/horas_reais/soma_h_driver — não mudam com o pico).
export function computeDbTaxas(recursos: RecursoBilling[], taxaBrl = TAXA_BRL_FALLBACK): Map<string, DbTaxaInfo> {
  interface Raw { totalBrl: number; totalHoras: number; maxHoras: number; somaHDriver: number; ids: Set<string> }
  const raw = new Map<string, Raw>()
  for (const r of recursos) {
    const rg = (r.resource_group_name || '').toLowerCase()
    if (!rg.startsWith('databricks-rg-')) continue
    if (r.tipo_custo !== 'hora') continue
    const horasReais = Number(r.horas_reais) || 0
    if (horasReais <= 0) continue
    const isBRL = (r.moeda || 'BRL') === 'BRL'
    const tcDB = Number(r.taxa_cambio) || 0
    const convR = !isBRL ? (tcDB > 1 ? tcDB : taxaBrl) : 1
    const billing = (Number(r.total_billing) || 0) * convR
    if (!raw.has(rg)) raw.set(rg, { totalBrl: 0, totalHoras: 0, maxHoras: 0, somaHDriver: 0, ids: new Set() })
    const e = raw.get(rg)!
    e.totalBrl += billing
    e.totalHoras += horasReais
    e.maxHoras = Math.max(e.maxHoras, horasReais)
    const shd = Number(r.soma_h_driver) || 0
    if (shd > e.somaHDriver) e.somaHDriver = shd
    e.ids.add(r.resource_id || rg + '_' + e.ids.size)
  }
  const dbTaxaMap = new Map<string, DbTaxaInfo>()
  raw.forEach((v, rg) => {
    const hDriver = v.somaHDriver > 0 ? v.somaHDriver : v.maxHoras
    const valida = hDriver >= 24 && v.ids.size >= 2
    const taxa = valida ? v.totalBrl / hDriver : 0
    dbTaxaMap.set(rg, { taxa, valida, totalBrl: v.totalBrl, hDriver: Math.round(hDriver), totalHoras: Math.round(v.totalHoras), recursos: v.ids.size })
  })
  return dbTaxaMap
}
