// Previsão de tendência mensal (Dashboard Databricks) — regressão linear simples
// (mínimos quadrados) sobre o histórico de custo mensal. Puro/testável, mesmo padrão
// dos outros módulos de frontend/src/lib/*.

export interface MesCusto {
  mes: string // 'YYYY-MM'
  custo: number
}

export interface MesCustoPrevisto extends MesCusto {
  previsto: boolean
}

export function proximoMes(mes: string): string {
  const [ano, m] = mes.split('-').map(Number)
  const d = new Date(ano, m, 1) // m já é 1-based aqui (mês seguinte)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// Regressão linear (y = slope*x + intercept, x = índice do mês) sobre o histórico
// real, projetando `mesesPrever` meses à frente. Com menos de 2 meses de histórico
// não há tendência calculável — retorna só o histórico, sem previsão. Custo previsto
// nunca é negativo (clamp em 0) — uma tendência de queda forte não vira "custo negativo".
export function forecastLinear(dados: MesCusto[], mesesPrever = 3): MesCustoPrevisto[] {
  const historico: MesCustoPrevisto[] = dados.map((d) => ({ ...d, previsto: false }))
  if (dados.length < 2 || mesesPrever <= 0) return historico

  const n = dados.length
  const xs = dados.map((_, i) => i)
  const ys = dados.map((d) => d.custo)
  const somaX = xs.reduce((a, b) => a + b, 0)
  const somaY = ys.reduce((a, b) => a + b, 0)
  const somaXY = xs.reduce((a, x, i) => a + x * ys[i], 0)
  const somaX2 = xs.reduce((a, x) => a + x * x, 0)
  const denominador = n * somaX2 - somaX * somaX
  if (denominador === 0) return historico // todos os x iguais — não deveria acontecer (índices únicos), guarda defensiva

  const slope = (n * somaXY - somaX * somaY) / denominador
  const intercept = (somaY - slope * somaX) / n

  const previstos: MesCustoPrevisto[] = []
  let mesAtual = dados[dados.length - 1].mes
  for (let i = 0; i < mesesPrever; i++) {
    mesAtual = proximoMes(mesAtual)
    const x = n + i
    const custo = Math.max(0, slope * x + intercept)
    previstos.push({ mes: mesAtual, custo, previsto: true })
  }
  return [...historico, ...previstos]
}
