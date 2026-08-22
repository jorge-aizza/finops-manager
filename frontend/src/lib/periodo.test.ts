import { describe, expect, it } from 'vitest'
import { calcHorasLivres, calcHorasPeriodo, defaultHorarioLivre } from './periodo'

describe('calcHorasPeriodo', () => {
  it('calcula horas corridas entre início e fim', () => {
    const r = calcHorasPeriodo('2026-08-01T00:00', '2026-08-02T00:00', defaultHorarioLivre())
    expect(r.valido).toBe(true)
    expect(r.horas).toBe(24)
    expect(r.horasCobradas).toBe(24)
  })

  it('inválido quando fim <= início', () => {
    const r = calcHorasPeriodo('2026-08-02T00:00', '2026-08-01T00:00', defaultHorarioLivre())
    expect(r.valido).toBe(false)
    expect(r.erro).toBeTruthy()
  })

  it('inválido quando datas estão vazias', () => {
    expect(calcHorasPeriodo('', '2026-08-01T00:00', defaultHorarioLivre()).valido).toBe(false)
    expect(calcHorasPeriodo('2026-08-01T00:00', '', defaultHorarioLivre()).valido).toBe(false)
  })

  it('subtrai horas livres quando o horário livre está ativo', () => {
    const hl = { ...defaultHorarioLivre(), ativo: true, dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00' }
    // segunda 2026-08-03 00:00 até terça 2026-08-04 00:00 — 1 dia útil completo dentro da janela
    const r = calcHorasPeriodo('2026-08-03T00:00', '2026-08-04T00:00', hl)
    expect(r.horas).toBe(24)
    expect(r.horasLivres).toBeGreaterThan(0)
    expect(r.horasCobradas).toBe(r.horas - r.horasLivres)
  })

  it('nunca retorna horasCobradas <= 0 (piso de 1h)', () => {
    const hl = { ...defaultHorarioLivre(), ativo: true, dias: [0, 1, 2, 3, 4, 5, 6], inicio: '00:00', fim: '23:00' }
    const r = calcHorasPeriodo('2026-08-03T00:00', '2026-08-03T02:00', hl)
    expect(r.horasCobradas).toBeGreaterThanOrEqual(1)
  })
})

describe('calcHorasLivres', () => {
  it('retorna 0 quando horário livre está desativado', () => {
    const hl = { ...defaultHorarioLivre(), ativo: false }
    expect(calcHorasLivres('2026-08-03T00:00', '2026-08-10T00:00', hl)).toBe(0)
  })

  it('retorna 0 quando nenhum dia da semana está marcado', () => {
    const hl = { ...defaultHorarioLivre(), ativo: true, dias: [] }
    expect(calcHorasLivres('2026-08-03T00:00', '2026-08-10T00:00', hl)).toBe(0)
  })

  it('soma a janela livre por cada dia da semana marcado no intervalo', () => {
    // 2026-08-03 é segunda-feira — 5 dias úteis (seg a sex) na semana, janela 9h (09:00-18:00)
    const hl = { ...defaultHorarioLivre(), ativo: true, dias: [1, 2, 3, 4, 5], inicio: '09:00', fim: '18:00' }
    const livres = calcHorasLivres('2026-08-03T00:00', '2026-08-07T23:59', hl)
    expect(livres).toBe(5 * 9)
  })

  it('usa janelas separadas pra sábado e domingo', () => {
    const hl = { ...defaultHorarioLivre(), ativo: true, dias: [6, 0], inicio_sab: '10:00', fim_sab: '14:00', inicio_dom: '10:00', fim_dom: '12:00' }
    // 2026-08-08 é sábado, 2026-08-09 é domingo
    const livres = calcHorasLivres('2026-08-08T00:00', '2026-08-09T23:59', hl)
    expect(livres).toBe(4 + 2) // sáb 4h + dom 2h
  })
})
