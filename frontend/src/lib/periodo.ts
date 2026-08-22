import type { HorarioLivre } from '../types/calculadora'

// Porta fiel de _calcHorasLivres/_calcHorasPeriodo (calculadora.js). Bug
// conhecido preservado de propósito (CLAUDE.md): conta dias parciais de
// início/fim como dias completos — pra períodos curtos pode subtrair mais
// horas do que o total. Não "consertar" — precisa bater com o legado.
export function calcHorasLivres(vIni: string, vFim: string, horarioLivre: HorarioLivre): number {
  if (!horarioLivre.ativo || !vIni || !vFim) return 0
  if (!horarioLivre.dias.length) return 0
  const j = (ini: string, f: string) => Math.max(0, parseInt((f || '18:00').split(':')[0]) - parseInt((ini || '09:00').split(':')[0]))
  const jUtil = j(horarioLivre.inicio, horarioLivre.fim)
  const jSab = j(horarioLivre.inicio_sab, horarioLivre.fim_sab)
  const jDom = j(horarioLivre.inicio_dom, horarioLivre.fim_dom)

  let livres = 0
  const inicio = new Date(vIni)
  const fim = new Date(vFim)
  const d = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate())
  const fimD = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate())
  while (d <= fimD) {
    const dow = d.getDay()
    if (horarioLivre.dias.includes(dow)) livres += dow === 6 ? jSab : dow === 0 ? jDom : jUtil
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
