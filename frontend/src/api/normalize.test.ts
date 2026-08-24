import { describe, expect, it } from 'vitest'
import { numFields } from './normalize'

describe('numFields', () => {
  it('converte string numérica (formato Postgres NUMERIC via pg) em number', () => {
    const row = { id: 1, custo_total: '2400.00' }
    expect(numFields(row, ['custo_total']).custo_total).toBe(2400)
  })

  it('preserva null sem tentar converter', () => {
    const row = { id: 1, custo_total: null as unknown as string }
    expect(numFields(row, ['custo_total']).custo_total).toBeNull()
  })

  it('preserva undefined sem tentar converter', () => {
    const row = { id: 1, custo_total: undefined as unknown as string }
    expect(numFields(row, ['custo_total']).custo_total).toBeUndefined()
  })

  it('preserva string vazia sem virar 0', () => {
    const row = { id: 1, custo_total: '' }
    expect(numFields(row, ['custo_total']).custo_total).toBe('')
  })

  it('não quebra se o valor já for number', () => {
    const row = { id: 1, custo_total: 2400 as unknown as string }
    expect(numFields(row, ['custo_total']).custo_total).toBe(2400)
  })

  it('normaliza múltiplos campos ao mesmo tempo, sem afetar campos não listados', () => {
    const row = { id: 1, custo_total: '100.50', custo_mensal: '50.25', nome: 'Reserva X' }
    const r = numFields(row, ['custo_total', 'custo_mensal'])
    expect(r.custo_total).toBe(100.5)
    expect(r.custo_mensal).toBe(50.25)
    expect(r.nome).toBe('Reserva X')
  })

  it('não muta o objeto original', () => {
    const row = { id: 1, custo_total: '100.50' }
    numFields(row, ['custo_total'])
    expect(row.custo_total).toBe('100.50')
  })
})
