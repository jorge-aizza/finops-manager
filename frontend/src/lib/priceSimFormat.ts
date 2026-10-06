// Formatação de preço do Simulador — compartilhada entre a busca manual e o assistente guiado.
// Muitos meters da Azure são cobrados por hora e por GiB (ex.: "Premium LRS Provisioned
// Capacity", 1 GiB/Hour, US$ 0,000208 ≈ R$ 0,0012): com 2 casas decimais fixas eles apareciam
// como "R$ 0,00", parecendo preço faltando quando o dado estava correto. Daí duas coisas aqui:
// casas decimais conforme a magnitude, e a projeção mensal, que é o número que a calculadora
// pública da Azure mostra e o único jeito de um preço por GiB/hora ficar legível.

// 730 h ≈ 1 mês (8760 h / 12) — mesma convenção da calculadora pública da Azure.
export const HORAS_MES = 730
// Alguns meters são cobrados por DIA (ex.: DTU do SQL Database, unidade "1/Day").
export const DIAS_MES = 365 / 12
// E alguns por SEGUNDO (ex.: "Standard Windows Software Duration" do Container Instances).
export const SEGUNDOS_MES = HORAS_MES * 3600

export function fmtBRL(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const casas = v === 0 || abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })
}

// Converte um preço horário na estimativa mensal equivalente (730 h ≈ 1 mês), mantendo a base
// da unidade: "1 GiB/Hour" vira "por GB/mês", "1/Hour" vira apenas "/mês". Devolve null para
// unidades que já são mensais ou que não são por hora (ex.: "1/Month", "10K", "1 TB").
export function projecaoMensal(preco: number, unidade: string | null | undefined): string | null {
  if (!preco || !unidade) return null
  const base = baseCobranca(unidade)
  if (base === 'hora') {
    const porGB = /gi?b/i.test(unidade)
    return `≈ ${fmtBRL(preco * HORAS_MES)}${porGB ? ' por GB/mês' : '/mês'} (${HORAS_MES} h)`
  }
  if (base === 'segundo') return `≈ ${fmtBRL(preco * SEGUNDOS_MES)}/mês (${HORAS_MES} h)`
  if (base === 'dia') return `≈ ${fmtBRL(preco * DIAS_MES)}/mês (${DIAS_MES.toFixed(1)} dias)`
  return null
}

// Base de cobrança do meter, lida da unidade do catálogo:
//   'hora'    → "1 Hour", "1 GiB/Hour"  (multiplicar pelas horas de uso no mês)
//   'dia'     → "1/Day"                 (multiplicar pelos dias do mês — DTU do SQL Database)
//   'mes'     → "1/Month", "1 GB/Month" (preço já é mensal)
//   'unidade' → "1 TB", "10K", "1"      (cobrança pontual, por evento/volume)
export type BaseCobranca = 'hora' | 'segundo' | 'dia' | 'mes' | 'unidade'

export function baseCobranca(unidade: string | null | undefined): BaseCobranca {
  if (!unidade) return 'unidade'
  // Hora primeiro: "1 GB Hour" é horário, e nenhuma unidade por segundo contém "hour".
  if (/hour|hora/i.test(unidade)) return 'hora'
  if (/second|segundo/i.test(unidade)) return 'segundo'
  if (/\bday\b|\bdia\b/i.test(unidade)) return 'dia'
  if (/month|m[êe]s/i.test(unidade)) return 'mes'
  return 'unidade'
}

// O que o número da quantidade significa NESTE meter. Sem isso o campo fica ambíguo: num
// meter "1 GB/Month" ele é volume de dados armazenado, num "1 Hour" é número de instâncias,
// num "10K" é bloco de operações. A unidade do catálogo é a única fonte dessa informação.
export interface DimensaoMeter {
  base: BaseCobranca
  rotuloQtd: string
  // true quando a quantidade é consumo medido (GB, TB, operações) em vez de contagem de
  // recursos — nesses casos faz sentido o usuário digitar um volume, não "1".
  volume: boolean
}

export function dimensaoMeter(unidade: string | null | undefined): DimensaoMeter {
  const base = baseCobranca(unidade)
  const u = (unidade || '').trim()
  // Volume primeiro: "1 GiB/Hour" tem GB e Hour, e o que o usuário informa é o GB.
  const vol = u.match(/\b(GiB|GB|TiB|TB|MiB|MB)\b/i)
  if (vol) return { base, rotuloQtd: vol[1].toUpperCase().replace('I', ''), volume: true }
  if (/10K/i.test(u)) return { base, rotuloQtd: '× 10 mil operações', volume: true }
  if (/\b1M\b/i.test(u)) return { base, rotuloQtd: 'milhões de operações', volume: true }
  // "1K" é a unidade de token dos modelos de IA (Azure OpenAI).
  if (/\b1K\b/i.test(u)) return { base, rotuloQtd: '× mil tokens', volume: true }
  if (/Mbps/i.test(u)) return { base, rotuloQtd: 'Mbps', volume: true }
  if (base === 'hora') return { base, rotuloQtd: 'instâncias', volume: false }
  return { base, rotuloQtd: 'unidades', volume: false }
}

// Custo mensal de um item da simulação, na MESMA base para todos — sem isso o total somava
// R$/hora com R$/mês e não significava nada. Meters horários são multiplicados pelas horas de
// uso no mês, diários pelos dias do mês; mensais e pontuais entram pelo valor cheio.
export function custoMensal(preco: number, unidade: string | null | undefined, quantidade: number, horasMes: number): number {
  const base = baseCobranca(unidade)
  const fator = base === 'hora' ? horasMes
    : base === 'segundo' ? horasMes * 3600
    : base === 'dia' ? DIAS_MES
    : 1
  return preco * quantidade * fator
}
