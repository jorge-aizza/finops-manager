import { describe, expect, it } from 'vitest'
import { buildEstimativa } from './buildEstimativa'
import { recursoKey } from '../hooks/useCalculadora'
import type { RecursoBilling } from '../types/calculadora'

function makeRecurso(overrides: Partial<RecursoBilling>): RecursoBilling {
  return {
    resource_id: 'r1', resource_group_name: 'RG-PROD', nome_recurso: 'vm1',
    categoria: 'Virtual Machines', meter_categories: 'D4s v3', subcategoria: null,
    produto: null, consumed_service: 'Microsoft.Compute', charge_type: 'Usage',
    pricing_model: 'OnDemand', publisher_type: null, publisher_name: null,
    regiao: null, location: null, moeda: 'BRL', unidade: '1 Hour', tipo_custo: 'hora',
    taxa_cambio: 0, custo_hora_billing: 2, usa_amortizado: false, taxa_hora_rate: 0,
    custo_uom_billing: 0, custo_uom_usd: 0, dias_ativos: 30, total_billing: 1440,
    total_usd: 0, total_qty: 720, custo_mes_billing: 1440, custo_dia_billing: 48,
    custo_dia_usd: 0, custo_hora_usd: 0, total_upq_brl: 0, total_upq_usd: 0,
    horas_reais: 720, soma_h_driver: 0, usa_30d: false,
    ...overrides,
  }
}

describe('buildEstimativa', () => {
  it('soma estimado de cada recurso selecionado em total_brl, aplicando gordura', () => {
    const r1 = makeRecurso({ resource_id: 'a' })
    const r2 = makeRecurso({ resource_id: 'b', custo_hora_billing: 4 })
    const selecionados = { [recursoKey(r1)]: 10, [recursoKey(r2)]: 10 }
    const est = buildEstimativa([r1, r2], selecionados, new Map(), { pctImposto: 0, pctCond: 0, pctGordura: 0 }, 5.7, 10)
    // r1: 2*10=20, r2: 4*10=40 -> total 60
    expect(est.total_brl).toBeCloseTo(60, 6)
    expect(est.total_final).toBeCloseTo(60, 6)
    expect(est.resultados).toHaveLength(2)
  })

  it('aplica gordura multiplicando total_brl E cada resultado individual', () => {
    const r1 = makeRecurso({ resource_id: 'a' })
    const selecionados = { [recursoKey(r1)]: 10 }
    const est = buildEstimativa([r1], selecionados, new Map(), { pctImposto: 0, pctCond: 0, pctGordura: 10 }, 5.7, 10)
    // base 20, gordFator 1.1 -> 22
    expect(est.total_brl).toBeCloseTo(22, 6)
    expect(est.resultados[0].estimado_brl).toBeCloseTo(22, 6)
  })

  it('imposto e condomínio incidem sobre total_brl (já com gordura), não sobre total_final', () => {
    const r1 = makeRecurso({ resource_id: 'a' })
    const selecionados = { [recursoKey(r1)]: 10 }
    const est = buildEstimativa([r1], selecionados, new Map(), { pctImposto: 10, pctCond: 5, pctGordura: 0 }, 5.7, 10)
    // total_brl = 20; vlImposto = 2; vlCond = 1; total_final = 23
    expect(est.vl_imposto).toBeCloseTo(2, 6)
    expect(est.vl_cond).toBeCloseTo(1, 6)
    expect(est.total_final).toBeCloseTo(23, 6)
  })

  it('recursos tipo=mes ficam FORA de total_brl/total_final — vão pra total_fixo_mes', () => {
    const rHora = makeRecurso({ resource_id: 'a' })
    const rMes = makeRecurso({ resource_id: 'b', tipo_custo: 'mes', custo_mes_billing: 500 })
    const selecionados = { [recursoKey(rHora)]: 10, [recursoKey(rMes)]: 10 }
    const est = buildEstimativa([rHora, rMes], selecionados, new Map(), { pctImposto: 0, pctCond: 0, pctGordura: 0 }, 5.7, 10)
    expect(est.total_brl).toBeCloseTo(20, 6) // só o recurso hora
    expect(est.total_fixo_mes).toBeCloseTo(500, 6)
    expect(est.recursos_mes).toHaveLength(1)
    expect(est.total_final).toBeCloseTo(20, 6) // fixo_mes não entra no final
  })

  it('total_cobrado soma total_billing de TODOS os selecionados, incluindo tipo=mes, sem gordura', () => {
    const rHora = makeRecurso({ resource_id: 'a', total_billing: 100 })
    const rMes = makeRecurso({ resource_id: 'b', tipo_custo: 'mes', total_billing: 50 })
    const selecionados = { [recursoKey(rHora)]: 10, [recursoKey(rMes)]: 10 }
    const est = buildEstimativa([rHora, rMes], selecionados, new Map(), { pctImposto: 0, pctCond: 0, pctGordura: 50 }, 5.7, 10)
    // total_cobrado não é afetado pela gordura (é billing real, não estimativa)
    expect(est.total_cobrado).toBeCloseTo(150, 6)
  })

  it('ignora ids selecionados que não existem mais em recursos (busca refeita)', () => {
    const r1 = makeRecurso({ resource_id: 'a' })
    const selecionados = { [recursoKey(r1)]: 10, 'chave-orfa-inexistente': 10 }
    const est = buildEstimativa([r1], selecionados, new Map(), { pctImposto: 0, pctCond: 0, pctGordura: 0 }, 5.7, 10)
    expect(est.resultados).toHaveLength(1)
  })

  it('usa o horas global (chGlobal) no campo `horas` do resultado, não a hora do primeiro selecionado', () => {
    const r1 = makeRecurso({ resource_id: 'a' })
    const selecionados = { [recursoKey(r1)]: 999 }
    const est = buildEstimativa([r1], selecionados, new Map(), { pctImposto: 0, pctCond: 0, pctGordura: 0 }, 5.7, 42)
    expect(est.horas).toBe(42)
  })
})
