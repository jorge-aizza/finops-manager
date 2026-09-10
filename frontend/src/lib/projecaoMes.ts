// Projeção do mês corrente por run-rate (2026-09-04) — separada de `forecastLinear.ts` de
// propósito.
//
// Por que o mês corrente NÃO pode entrar na regressão linear: `GET /api/azure-costs/resumo`
// devolve `por_mes` incluindo o mês em andamento com dado PARCIAL. No ambiente real, set/2026
// tinha R$373.430 (3 dias) contra R$3.708.475 de agosto — jogar isso em `forecastLinear`
// produziria uma reta despencando e uma "previsão" perto de zero, pior que não ter previsão.
// `DatabricksDashboardView` escapa disso só porque lá o período é escolhido pelo usuário.
//
// Aqui o mês corrente vira um número diferente: run-rate (média diária × dias do mês).

export interface MesCustoBruto {
  mes: string // 'YYYY-MM'
  custo: number
}

export interface ProjecaoMes {
  mes: string
  custo_mtd: number
  dias_decorridos: number
  dias_no_mes: number
  projecao: number
}

export function diasNoMes(mes: string): number {
  const [ano, m] = mes.split('-').map(Number)
  return new Date(ano, m, 0).getDate() // dia 0 do mês seguinte = último dia deste
}

/**
 * Meses COMPLETOS, os únicos que podem alimentar a regressão de tendência.
 * `dataFim` é o `MAX(cost_date)` do billing — nunca `new Date()`: o billing atrasa 2-3 dias, e
 * usar "hoje" classificaria como incompleto um mês que na verdade já fechou.
 */
export function mesesCompletos(porMes: MesCustoBruto[], dataFim: string): MesCustoBruto[] {
  const mesCorrente = dataFim.slice(0, 7)
  return porMes.filter((m) => m.mes < mesCorrente).sort((a, b) => a.mes.localeCompare(b.mes))
}

/**
 * Projeção do mês corrente por run-rate.
 *
 * O divisor é o dia de `dataFim` (último dia COM DADO), não o dia de hoje — dividir por dias que
 * ainda não têm billing publicado subestimaria o run-rate sistematicamente. Detalhe pequeno,
 * erro grande: com 3 dias de dado e 4 dias corridos, o erro seria de 25%.
 *
 * Retorna null quando não há mês corrente no conjunto (nada a projetar).
 */
export function projecaoMesCorrente(porMes: MesCustoBruto[], dataFim: string): ProjecaoMes | null {
  const mesCorrente = dataFim.slice(0, 7)
  const atual = porMes.find((m) => m.mes === mesCorrente)
  if (!atual) return null

  const diasDecorridos = Number(dataFim.slice(8, 10))
  if (!Number.isFinite(diasDecorridos) || diasDecorridos <= 0) return null

  const total = diasNoMes(mesCorrente)
  return {
    mes: mesCorrente,
    custo_mtd: atual.custo,
    dias_decorridos: diasDecorridos,
    dias_no_mes: total,
    projecao: (atual.custo / diasDecorridos) * total,
  }
}
