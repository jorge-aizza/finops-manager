import type { DbTaxaInfo, EstimadoResult, RecursoBilling, ResourceGroupOption, TipoCusto } from '../types/calculadora'

// Porta fiel de _calcEstimado/_dbInfoParaRecurso/_dbComputeTaxas (calculadora.js)
// — fonte única do cálculo financeiro por recurso, usada pelos cards do
// overlay Configurar Estimativa e pelo Subtotal/Total. NÃO mudar a ordem ou
// a fórmula de nenhum passo aqui: qualquer divergência do legado produz um
// número de estimativa de custo errado (é uma calculadora financeira real).
// Não aplica "gordura" — cada chamador multiplica `estimado` pelo próprio
// fator de gordura (1 + pctGordura/100).

const TAXA_BRL_FALLBACK = 5.70

export function calcEstimado(r: RecursoBilling, horas: number, rgTaxaMap: Map<string, DbTaxaInfo>, taxaBrl = TAXA_BRL_FALLBACK): EstimadoResult {
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

  const rgInfo = rgInfoParaRecurso(r, rgTaxaMap)
  const rgValida = !!(rgInfo && rgInfo.valida && rgInfo.hDriver > 0)
  const dbInfo = tipo === 'hora' && isDatabricksRg((r.resource_group_name || '').toLowerCase()) ? rgInfo : null
  const dbValida = !!(dbInfo && dbInfo.valida)
  const taxaEf = rgValida && tipo !== 'mes' && tipo !== 'reserva' ? bill / rgInfo!.hDriver : chora

  // Estimado: pico do período quando disponível; senão billing
  const upqBrl = (Number(r.total_upq_brl) || 0) * convR
  const fallback = upqBrl > 0 ? (upqBrl / diasAtiv * 30) : mesBrl
  const picoRaw = Number(r.custo_hora_pico) || 0
  const picoBrl = picoRaw > 0 ? picoRaw * convR : 0
  const usaPico = false
  const picoClusterRaw = Number(r.custo_hora_pico_cluster) || 0
  const picoClusterBrl = picoClusterRaw > 0 ? picoClusterRaw * convR : 0
  const usaPicoCluster = false
  const usaMediaRg = rgValida && tipo !== 'mes' && tipo !== 'reserva'

  const estimado = (tipo === 'mes')
    ? mesBrl
    : usaMediaRg
      ? taxaEf * horas
      : (tipo === 'periodo')
        ? fallback / 720 * horas
        : taxaEf * horas

  return {
    tipo, isBRL, convR, chora, custoUomBrl, diasAtiv, mesBrl, bill,
    dbInfo, dbValida, rgInfo, rgValida, taxaEf, picoBrl, picoClusterBrl, usaPico, usaPicoCluster,
    estimado,
  }
}

// Mesmos 3 padrões de RG gerenciado por Databricks que _detectManagedRg() (server.js)
// reconhece — DATABRICKS-RG-*, MANAGED-RG-ADBX-* e o genérico MANAGED-RG-* (ex:
// MANAGED-RG-DBW-*, que a Vivo usa em produção). 'managed-rg-adbx-' já é coberto pelo
// prefixo mais amplo 'managed-rg-'. Bug real corrigido: antes só 'databricks-rg-' era
// reconhecido aqui — RGs com o padrão genérico ficavam com o badge correto na UI
// (via _detectManagedRg), mas caíam no fallback de billing médio por VM em vez da
// taxa de cluster da RN-DB-001, subestimando o custo/h de clusters paralelos.
function isDatabricksRg(rgLower: string): boolean {
  return rgLower.startsWith('databricks-rg-') || rgLower.startsWith('managed-rg-')
}

function rgInfoParaRecurso(r: RecursoBilling, rgTaxaMap: Map<string, DbTaxaInfo>): DbTaxaInfo | null {
  const rg = (r.resource_group_name || '').toUpperCase()
  return rgTaxaMap.get(rg) || rgTaxaMap.get(rg.toLowerCase()) || null
}

export function computeRgTaxas(recursos: RecursoBilling[], rgOptions: ResourceGroupOption[]): Map<string, DbTaxaInfo> {
  interface Raw { totalBrl: number; driverHours: number; vmHours: number; anchors: Set<string>; aliases: Set<string> }
  const parentByRg = new Map<string, string>()
  for (const rg of rgOptions) {
    if (rg.parent_rg) parentByRg.set(rg.resource_group_name.toUpperCase(), rg.parent_rg.toUpperCase())
  }

  const raw = new Map<string, Raw>()
  for (const r of recursos) {
    const rg = (r.resource_group_name || '').toUpperCase()
    if (!rg) continue
    const group = parentByRg.get(rg) || rg
    if (!raw.has(group)) raw.set(group, { totalBrl: 0, driverHours: 0, vmHours: 0, anchors: new Set(), aliases: new Set() })
    const entry = raw.get(group)!
    entry.aliases.add(rg)

    if (r.tipo_custo !== 'mes' && r.tipo_custo !== 'reserva') {
      const rate = Number(r.taxa_cambio) || 0
      const conversion = (r.moeda || 'BRL') === 'BRL' ? 1 : (rate > 1 ? rate : TAXA_BRL_FALLBACK)
      entry.totalBrl += (Number(r.total_billing) || 0) * conversion
    }

    if (r.tipo_custo === 'hora') {
      const driverHours = Number(r.soma_h_driver) || 0
      const vmHours = Number(r.horas_reais) || 0
      const isVm = (r.consumed_service || '').toLowerCase() === 'microsoft.compute'
        || (r.categoria || '').toLowerCase().includes('virtual machine')
      if (driverHours > 0) {
        entry.driverHours = Math.max(entry.driverHours, driverHours)
        entry.anchors.add(r.resource_id || rg)
      } else if (isVm && vmHours > 0) {
        entry.vmHours = Math.max(entry.vmHours, vmHours)
        entry.anchors.add(r.resource_id || rg)
      }
    }
  }

  const result = new Map<string, DbTaxaInfo>()
  for (const entry of raw.values()) {
    const hDriver = entry.driverHours || entry.vmHours
    const valid = hDriver >= 24 && entry.anchors.size > 0
    const info = {
      taxa: valid ? entry.totalBrl / hDriver : 0,
      valida: valid,
      totalBrl: entry.totalBrl,
      hDriver,
      totalHoras: Math.round(hDriver),
      recursos: entry.anchors.size,
    }
    for (const alias of entry.aliases) {
      result.set(alias, info)
      result.set(alias.toLowerCase(), info)
    }
  }
  return result
}

// Roda uma vez por busca (não a cada merge de pico) — igual ao legado, que
// não re-executa _dbComputeTaxas() após o merge de `?pico=1` (os campos que
// ele usa — total_billing/horas_reais/soma_h_driver — não mudam com o pico).
export function computeDbTaxas(recursos: RecursoBilling[], taxaBrl = TAXA_BRL_FALLBACK): Map<string, DbTaxaInfo> {
  interface Raw { totalBrl: number; totalHoras: number; maxHoras: number; somaHDriver: number; ids: Set<string> }
  const raw = new Map<string, Raw>()
  for (const r of recursos) {
    const rg = (r.resource_group_name || '').toLowerCase()
    if (!isDatabricksRg(rg)) continue
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
