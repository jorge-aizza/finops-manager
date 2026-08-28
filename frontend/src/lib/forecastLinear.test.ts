import { describe, expect, it } from 'vitest'
import { forecastLinear, proximoMes } from './forecastLinear'

describe('proximoMes', () => {
  it('avança dentro do mesmo ano', () => {
    expect(proximoMes('2026-06')).toBe('2026-07')
  })
  it('vira o ano em dezembro', () => {
    expect(proximoMes('2026-12')).toBe('2027-01')
  })
})

describe('forecastLinear', () => {
  it('sem dados suficientes (<2 meses) não gera previsão', () => {
    const r = forecastLinear([{ mes: '2026-08', custo: 100 }])
    expect(r).toEqual([{ mes: '2026-08', custo: 100, previsto: false }])
  })

  it('lista vazia retorna vazia', () => {
    expect(forecastLinear([])).toEqual([])
  })

  it('tendência de alta projeta valores crescentes, meses sequenciais', () => {
    const dados = [
      { mes: '2026-05', custo: 100 },
      { mes: '2026-06', custo: 200 },
      { mes: '2026-07', custo: 300 },
      { mes: '2026-08', custo: 400 },
    ]
    const r = forecastLinear(dados, 3)
    expect(r).toHaveLength(7)
    const previstos = r.slice(4)
    expect(previstos.map((p) => p.mes)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(previstos.every((p) => p.previsto)).toBe(true)
    expect(previstos[0].custo).toBeCloseTo(500, 5)
    expect(previstos[1].custo).toBeCloseTo(600, 5)
    expect(previstos[2].custo).toBeCloseTo(700, 5)
    expect(r.slice(0, 4).every((p) => !p.previsto)).toBe(true)
  })

  it('tendência de queda forte nunca produz custo previsto negativo', () => {
    const dados = [
      { mes: '2026-06', custo: 300 },
      { mes: '2026-07', custo: 100 },
      { mes: '2026-08', custo: 0 },
    ]
    const r = forecastLinear(dados, 3)
    const previstos = r.slice(3)
    for (const p of previstos) expect(p.custo).toBeGreaterThanOrEqual(0)
  })

  it('tendência plana projeta o mesmo valor', () => {
    const dados = [
      { mes: '2026-06', custo: 150 },
      { mes: '2026-07', custo: 150 },
      { mes: '2026-08', custo: 150 },
    ]
    const r = forecastLinear(dados, 2)
    const previstos = r.slice(3)
    expect(previstos[0].custo).toBeCloseTo(150, 5)
    expect(previstos[1].custo).toBeCloseTo(150, 5)
  })

  it('mesesPrever=0 não adiciona nada', () => {
    const dados = [
      { mes: '2026-07', custo: 100 },
      { mes: '2026-08', custo: 200 },
    ]
    expect(forecastLinear(dados, 0)).toEqual(dados.map((d) => ({ ...d, previsto: false })))
  })
})
