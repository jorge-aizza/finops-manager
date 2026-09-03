import { describe, expect, it } from 'vitest'
import { calcularImpactoCusto } from './RecursoDetalheModal'

// Impacto de custo (2026-09-03) — testa a função pura isoladamente, sem montar o componente
// inteiro (que exige React Query + APIs mockadas). Datas em UTC (`Txx:00:00Z`) pra não depender
// do fuso horário de quem roda o teste.

describe('calcularImpactoCusto', () => {
  it('calcula a média diária dos 7 dias antes e depois da mudança', () => {
    const custoDiario = [
      { cost_date: '2026-08-20', custo: 10 },
      { cost_date: '2026-08-21', custo: 10 },
      { cost_date: '2026-08-22', custo: 10 },
      { cost_date: '2026-08-26', custo: 20 },
      { cost_date: '2026-08-27', custo: 20 },
      { cost_date: '2026-08-28', custo: 20 },
    ]
    const r = calcularImpactoCusto(custoDiario, '2026-08-25T00:00:00Z')
    expect(r.antes).toBeCloseTo(10)
    expect(r.depois).toBeCloseTo(20)
  })

  it('retorna null quando há menos de 2 dias de dado de um dos lados', () => {
    const custoDiario = [
      { cost_date: '2026-08-24', custo: 10 },
      { cost_date: '2026-08-26', custo: 20 },
      { cost_date: '2026-08-27', custo: 20 },
    ]
    const r = calcularImpactoCusto(custoDiario, '2026-08-25T00:00:00Z')
    expect(r.antes).toBeNull()
    expect(r.depois).toBeCloseTo(20)
  })

  it('retorna null pros dois lados quando não há custo_diario nenhum', () => {
    const r = calcularImpactoCusto([], '2026-08-25T00:00:00Z')
    expect(r.antes).toBeNull()
    expect(r.depois).toBeNull()
  })

  it('ignora dias fora da janela de 7 dias', () => {
    const custoDiario = [
      { cost_date: '2026-08-01', custo: 999 }, // bem antes, fora da janela
      { cost_date: '2026-08-24', custo: 10 },
      { cost_date: '2026-08-23', custo: 10 },
      { cost_date: '2026-09-15', custo: 999 }, // bem depois, fora da janela
    ]
    const r = calcularImpactoCusto(custoDiario, '2026-08-25T00:00:00Z')
    expect(r.antes).toBeCloseTo(10)
    expect(r.depois).toBeNull()
  })
})
