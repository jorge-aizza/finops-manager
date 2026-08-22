import { describe, expect, it } from 'vitest'
import { calcEstimado, computeDbTaxas } from './calcEstimado'
import type { RecursoBilling } from '../types/calculadora'

function makeRecurso(overrides: Partial<RecursoBilling>): RecursoBilling {
  return {
    resource_id: 'r1', resource_group_name: 'RG-PROD', nome_recurso: 'vm1',
    categoria: 'Virtual Machines', meter_categories: 'D4s v3', subcategoria: null,
    produto: null, consumed_service: 'Microsoft.Compute', charge_type: 'Usage',
    pricing_model: 'OnDemand', publisher_type: null, publisher_name: null,
    regiao: null, location: null, moeda: 'BRL', unidade: '1 Hour', tipo_custo: 'hora',
    taxa_cambio: 0, custo_hora_billing: 2.5, usa_amortizado: false, taxa_hora_rate: 0,
    custo_uom_billing: 0, custo_uom_usd: 0, dias_ativos: 30, total_billing: 1800,
    total_usd: 0, total_qty: 720, custo_mes_billing: 1800, custo_dia_billing: 60,
    custo_dia_usd: 0, custo_hora_usd: 0, total_upq_brl: 0, total_upq_usd: 0,
    horas_reais: 720, soma_h_driver: 0, usa_30d: false,
    ...overrides,
  }
}

describe('calcEstimado — tipo hora (caso normal)', () => {
  it('estimado = chora * horas', () => {
    const r = makeRecurso({})
    const dbMap = new Map()
    const c = calcEstimado(r, 100, dbMap)
    expect(c.tipo).toBe('hora')
    expect(c.chora).toBeCloseTo(2.5, 6)
    expect(c.estimado).toBeCloseTo(250, 6)
  })
})

describe('calcEstimado — RN-007 RI/SP amortizado', () => {
  it('usa taxa_hora_rate quando custo_hora_billing é 0 e usa_amortizado é true', () => {
    const r = makeRecurso({ custo_hora_billing: 0, usa_amortizado: true, taxa_hora_rate: 1.8 })
    const c = calcEstimado(r, 10, new Map())
    expect(c.chora).toBeCloseTo(1.8, 6)
    expect(c.estimado).toBeCloseTo(18, 6)
  })

  it('não usa fallback amortizado quando custo_hora_billing > 0', () => {
    const r = makeRecurso({ custo_hora_billing: 2.5, usa_amortizado: true, taxa_hora_rate: 99 })
    const c = calcEstimado(r, 10, new Map())
    expect(c.chora).toBeCloseTo(2.5, 6)
  })
})

describe('calcEstimado — RN-DB-001 Databricks cluster rate', () => {
  it('usa taxa proporcional do cluster (bill / hDriver) quando o workspace é válido', () => {
    const r = makeRecurso({ resource_group_name: 'databricks-rg-ws1', total_billing: 500 })
    const dbMap = new Map([['databricks-rg-ws1', { taxa: 5, valida: true, totalBrl: 1000, hDriver: 100, totalHoras: 200, recursos: 3 }]])
    const c = calcEstimado(r, 10, dbMap)
    expect(c.dbValida).toBe(true)
    // taxaEf = bill / hDriver = 500 / 100 = 5
    expect(c.taxaEf).toBeCloseTo(5, 6)
    expect(c.estimado).toBeCloseTo(50, 6)
  })

  it('ignora dbInfo inválido (hDriver < 24h ou < 2 recursos) e cai no chora normal', () => {
    const r = makeRecurso({ resource_group_name: 'databricks-rg-ws1' })
    const dbMap = new Map([['databricks-rg-ws1', { taxa: 0, valida: false, totalBrl: 0, hDriver: 0, totalHoras: 0, recursos: 1 }]])
    const c = calcEstimado(r, 10, dbMap)
    expect(c.dbValida).toBe(false)
    expect(c.taxaEf).toBeCloseTo(2.5, 6)
  })

  it('só considera dbInfo pra tipo=hora — RGs Databricks com tipo=periodo (DBU) não usam cluster rate', () => {
    const r = makeRecurso({ resource_group_name: 'databricks-rg-ws1', tipo_custo: 'periodo', unidade: '1 DBU' })
    const dbMap = new Map([['databricks-rg-ws1', { taxa: 5, valida: true, totalBrl: 1000, hDriver: 100, totalHoras: 200, recursos: 3 }]])
    const c = calcEstimado(r, 10, dbMap)
    expect(c.dbInfo).toBeNull()
    expect(c.dbValida).toBe(false)
  })
})

describe('calcEstimado — pico (peak)', () => {
  it('usaPico substitui a taxa média quando custo_hora_pico > 0 (tipo hora)', () => {
    const r = makeRecurso({ custo_hora_pico: 4 })
    const c = calcEstimado(r, 10, new Map())
    expect(c.usaPico).toBe(true)
    expect(c.picoBrl).toBeCloseTo(4, 6)
    expect(c.estimado).toBeCloseTo(40, 6)
  })

  it('pico NUNCA se aplica a tipo=reserva ou tipo=mes mesmo com custo_hora_pico > 0', () => {
    const rReserva = makeRecurso({ tipo_custo: 'reserva', custo_hora_pico: 4 })
    expect(calcEstimado(rReserva, 10, new Map()).usaPico).toBe(false)
    const rMes = makeRecurso({ tipo_custo: 'mes', custo_hora_pico: 4 })
    expect(calcEstimado(rMes, 10, new Map()).usaPico).toBe(false)
  })

  it('usaPicoCluster tem prioridade sobre usaPico quando o recurso é Databricks válido', () => {
    const r = makeRecurso({ resource_group_name: 'databricks-rg-ws1', custo_hora_pico: 4, custo_hora_pico_cluster: 9 })
    const dbMap = new Map([['databricks-rg-ws1', { taxa: 5, valida: true, totalBrl: 1000, hDriver: 100, totalHoras: 200, recursos: 3 }]])
    const c = calcEstimado(r, 10, dbMap)
    expect(c.usaPico).toBe(false) // dbValida exclui usaPico
    expect(c.usaPicoCluster).toBe(true)
    expect(c.estimado).toBeCloseTo(90, 6)
  })
})

describe('calcEstimado — tipo mes (fixo)', () => {
  it('estimado = mesBrl, independente de horas', () => {
    const r = makeRecurso({ tipo_custo: 'mes', custo_mes_billing: 300 })
    const c1 = calcEstimado(r, 10, new Map())
    const c2 = calcEstimado(r, 999, new Map())
    expect(c1.estimado).toBeCloseTo(300, 6)
    expect(c2.estimado).toBeCloseTo(300, 6)
  })
})

describe('calcEstimado — tipo periodo (fallback proporcional)', () => {
  it('estimado = (fallback / 720) * horas, usando custo_mes_billing quando total_upq_brl é 0', () => {
    const r = makeRecurso({ tipo_custo: 'periodo', custo_mes_billing: 720, total_upq_brl: 0 })
    const c = calcEstimado(r, 100, new Map())
    // fallback = mesBrl = 720; estimado = 720/720*100 = 100
    expect(c.estimado).toBeCloseTo(100, 6)
  })

  it('usa total_upq_brl como fallback quando > 0, em vez de custo_mes_billing', () => {
    const r = makeRecurso({ tipo_custo: 'periodo', custo_mes_billing: 720, total_upq_brl: 100, dias_ativos: 10 })
    const c = calcEstimado(r, 720, new Map())
    // upqBrl=100 -> fallback = 100/10*30 = 300; estimado = 300/720*720 = 300
    expect(c.estimado).toBeCloseTo(300, 6)
  })
})

describe('calcEstimado — tipo reserva (amortizado pelo term)', () => {
  it('estimado = chora * horas (mesma fórmula de hora, sem pico)', () => {
    const r = makeRecurso({ tipo_custo: 'reserva', custo_hora_billing: 1.2 })
    const c = calcEstimado(r, 50, new Map())
    expect(c.estimado).toBeCloseTo(60, 6)
  })
})

describe('calcEstimado — conversão de moeda (RN-005)', () => {
  it('aplica taxa_cambio da Azure quando > 1', () => {
    const r = makeRecurso({ moeda: 'USD', taxa_cambio: 5.2, custo_hora_billing: 1 })
    const c = calcEstimado(r, 10, new Map())
    expect(c.convR).toBeCloseTo(5.2, 6)
    expect(c.chora).toBeCloseTo(5.2, 6)
  })

  it('usa taxaBrl manual como fallback quando taxa_cambio <= 1', () => {
    const r = makeRecurso({ moeda: 'USD', taxa_cambio: 0, custo_hora_billing: 1 })
    const c = calcEstimado(r, 10, new Map(), 6.0)
    expect(c.convR).toBeCloseTo(6.0, 6)
  })
})

describe('computeDbTaxas — RN-DB-001', () => {
  it('calcula taxa proporcional = totalBrl / hDriver quando válido (hDriver>=24h e >=2 recursos)', () => {
    const recursos = [
      makeRecurso({ resource_id: 'vm-a', resource_group_name: 'databricks-rg-ws1', total_billing: 100, horas_reais: 50, soma_h_driver: 50 }),
      makeRecurso({ resource_id: 'vm-b', resource_group_name: 'databricks-rg-ws1', total_billing: 200, horas_reais: 50, soma_h_driver: 50 }),
    ]
    const map = computeDbTaxas(recursos)
    const info = map.get('databricks-rg-ws1')
    expect(info?.valida).toBe(true)
    expect(info?.totalBrl).toBeCloseTo(300, 6)
    expect(info?.hDriver).toBe(50)
    expect(info?.taxa).toBeCloseTo(6, 6) // 300/50
    expect(info?.recursos).toBe(2)
  })

  it('marca inválido quando só há 1 resource_id distinto', () => {
    const recursos = [
      makeRecurso({ resource_id: 'vm-a', resource_group_name: 'databricks-rg-ws1', horas_reais: 100, soma_h_driver: 100 }),
    ]
    const map = computeDbTaxas(recursos)
    expect(map.get('databricks-rg-ws1')?.valida).toBe(false)
  })

  it('ignora resource groups fora do padrão databricks-rg-*', () => {
    const recursos = [makeRecurso({ resource_group_name: 'RG-PROD' })]
    const map = computeDbTaxas(recursos)
    expect(map.size).toBe(0)
  })

  it('usa maxHoras como fallback quando soma_h_driver não está disponível', () => {
    const recursos = [
      makeRecurso({ resource_id: 'vm-a', resource_group_name: 'databricks-rg-ws1', horas_reais: 30, soma_h_driver: 0 }),
      makeRecurso({ resource_id: 'vm-b', resource_group_name: 'databricks-rg-ws1', horas_reais: 40, soma_h_driver: 0 }),
    ]
    const map = computeDbTaxas(recursos)
    expect(map.get('databricks-rg-ws1')?.hDriver).toBe(40) // maxHoras
  })
})
