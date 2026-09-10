import { describe, expect, it } from 'vitest'
import { diasNoMes, mesesCompletos, projecaoMesCorrente } from './projecaoMes'

describe('diasNoMes', () => {
  it('conta os dias de meses de tamanhos diferentes, inclusive fevereiro bissexto', () => {
    expect(diasNoMes('2026-01')).toBe(31)
    expect(diasNoMes('2026-04')).toBe(30)
    expect(diasNoMes('2026-02')).toBe(28)
    expect(diasNoMes('2024-02')).toBe(29)
  })
})

describe('mesesCompletos', () => {
  // O caso que motivou a lib: set/2026 tinha 3 dias de dado contra meses cheios de jul/ago.
  it('exclui o mês corrente (parcial) da série de tendência', () => {
    const porMes = [
      { mes: '2026-09', custo: 373430 },
      { mes: '2026-08', custo: 3708475 },
      { mes: '2026-07', custo: 2995341 },
    ]
    const r = mesesCompletos(porMes, '2026-09-03')
    expect(r.map((m) => m.mes)).toEqual(['2026-07', '2026-08'])
  })

  it('devolve ordenado por mês, independente da ordem de entrada', () => {
    const porMes = [
      { mes: '2026-08', custo: 2 },
      { mes: '2026-06', custo: 1 },
      { mes: '2026-07', custo: 3 },
    ]
    expect(mesesCompletos(porMes, '2026-09-01').map((m) => m.mes)).toEqual(['2026-06', '2026-07', '2026-08'])
  })
})

describe('projecaoMesCorrente', () => {
  it('projeta o mês corrente pelo run-rate dos dias COM DADO', () => {
    const r = projecaoMesCorrente(
      [{ mes: '2026-09', custo: 373430 }, { mes: '2026-08', custo: 3708475 }],
      '2026-09-03',
    )
    expect(r).not.toBeNull()
    expect(r!.dias_decorridos).toBe(3)
    expect(r!.dias_no_mes).toBe(30)
    // 373430 / 3 * 30
    expect(r!.projecao).toBeCloseTo(3734300, 0)
  })

  // O erro que essa escolha evita: dividir por "hoje" em vez do último dia com dado.
  it('usa o dia de dataFim como divisor, não a data de hoje', () => {
    const porMes = [{ mes: '2026-09', custo: 1000 }]
    const comAtraso = projecaoMesCorrente(porMes, '2026-09-05')
    expect(comAtraso!.dias_decorridos).toBe(5)
    expect(comAtraso!.projecao).toBeCloseTo(6000, 5) // 1000/5*30
  })

  it('retorna null quando o mês corrente não está na série', () => {
    expect(projecaoMesCorrente([{ mes: '2026-07', custo: 10 }], '2026-09-03')).toBeNull()
  })
})
