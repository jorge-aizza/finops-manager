import type { HorarioLivre } from '../types/calculadora'

// Calcula horas livres via intersecção com o período real do usuário
export function calcHorasLivres(vIni: string, vFim: string, horarioLivre: HorarioLivre): number {
  if (!horarioLivre.ativo || !vIni || !vFim) return 0
  if (!horarioLivre.dias.length) return 0

  const inicio = new Date(vIni)
  const fim = new Date(vFim)

  // Helper para converter "HH:MM" para minutos desde meia-noite
  const timeToMinutes = (time: string): number => {
    const [h, m] = (time || '00:00').split(':').map(Number)
    return h * 60 + (m || 0)
  }

  const hlUtilStart = timeToMinutes(horarioLivre.inicio)
  const hlUtilEnd = timeToMinutes(horarioLivre.fim)
  const hlSabStart = timeToMinutes(horarioLivre.inicio_sab)
  const hlSabEnd = timeToMinutes(horarioLivre.fim_sab)
  const hlDomStart = timeToMinutes(horarioLivre.inicio_dom)
  const hlDomEnd = timeToMinutes(horarioLivre.fim_dom)

  let livres = 0
  const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate())
  const fimDate = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate())

  while (d <= fimDate) {
    const dow = d.getDay()
    if (!horarioLivre.dias.includes(dow)) {
      d.setDate(d.getDate() + 1)
      continue
    }

    // Determina horário livre para este dia
    const hlStart = dow === 6 ? hlSabStart : dow === 0 ? hlDomStart : hlUtilStart
    const hlEnd = dow === 6 ? hlSabEnd : dow === 0 ? hlDomEnd : hlUtilEnd

    // Calcula intersecção entre horário livre e o período do usuário neste dia
    const dayStart = new Date(d)
    const dayEnd = new Date(d)
    dayEnd.setDate(dayEnd.getDate() + 1)

    const periodStart = Math.max(dayStart.getTime(), inicio.getTime())
    const periodEnd = Math.min(dayEnd.getTime(), fim.getTime())

    if (periodEnd > periodStart) {
      const periodStartMinutes = ((periodStart - dayStart.getTime()) / 60000)
      const periodEndMinutes = ((periodEnd - dayStart.getTime()) / 60000)

      // Intersecção entre [hlStart, hlEnd] e [periodStartMinutes, periodEndMinutes]
      const intersectStart = Math.max(hlStart, periodStartMinutes)
      const intersectEnd = Math.min(hlEnd, periodEndMinutes)

      if (intersectEnd > intersectStart) {
        livres += (intersectEnd - intersectStart) / 60
      }
    }

    d.setDate(d.getDate() + 1)
  }

  return livres
}

export interface HorasPeriodoResult {
  horas: number
  horasLivres: number
  horasCobradas: number
  valido: boolean
  erro?: string
}

export function calcHorasPeriodo(vIni: string, vFim: string, horarioLivre: HorarioLivre): HorasPeriodoResult {
  if (!vIni || !vFim) return { horas: 0, horasLivres: 0, horasCobradas: 0, valido: false }
  const diff = new Date(vFim).getTime() - new Date(vIni).getTime()
  if (diff <= 0) {
    return { horas: 0, horasLivres: 0, horasCobradas: 0, valido: false, erro: 'Hora fim deve ser posterior à hora início' }
  }
  const horas = Math.round(diff / 3600000)
  const horasLivres = calcHorasLivres(vIni, vFim, horarioLivre)
  const horasCobradas = Math.max(1, horas - horasLivres)
  return { horas, horasLivres, horasCobradas, valido: true }
}

export function defaultHorarioLivre(): HorarioLivre {
  return {
    ativo: false, inicio: '09:00', fim: '18:00',
    dias: [1, 2, 3, 4, 5],
    inicio_sab: '09:00', fim_sab: '18:00', inicio_dom: '09:00', fim_dom: '18:00',
  }
}
