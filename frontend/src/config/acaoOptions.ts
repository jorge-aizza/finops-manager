export const CLOUDS = ['AWS', 'Azure', 'GCP', 'Oracle', 'Multicloud'] as const

export const STATUS_OPTIONS = ['Planejado', 'Em Andamento', 'Concluído', 'Cancelado'] as const

export const TIPO_ACAO_OPTIONS = [
  'Rightsizing', 'Reserved Instances', 'Savings Plans', 'Spot Instances',
  'Eliminação de Recursos', 'Otimização de Storage', 'Otimização de Rede',
  'Governança', 'Outro',
]

export const STATUS_COLORS: Record<string, string> = {
  Planejado: '#4da6ff', 'Em Andamento': '#f59e0b', Concluído: '#22c55e', Cancelado: '#7b6a9e',
}

export interface MesInfo {
  abbrev: string // usado nos ids/inputs: jan, fev...
  label: string  // exibido no chip: Jan, Fev...
  key: string    // sufixo da coluna no banco: janeiro, fevereiro... (sem acento)
  full: string   // label completo do campo: Janeiro, Fevereiro...
}

export const MESES: MesInfo[] = [
  { abbrev: 'jan', label: 'Jan', key: 'janeiro', full: 'Janeiro' },
  { abbrev: 'fev', label: 'Fev', key: 'fevereiro', full: 'Fevereiro' },
  { abbrev: 'mar', label: 'Mar', key: 'marco', full: 'Março' },
  { abbrev: 'abr', label: 'Abr', key: 'abril', full: 'Abril' },
  { abbrev: 'mai', label: 'Mai', key: 'maio', full: 'Maio' },
  { abbrev: 'jun', label: 'Jun', key: 'junho', full: 'Junho' },
  { abbrev: 'jul', label: 'Jul', key: 'julho', full: 'Julho' },
  { abbrev: 'ago', label: 'Ago', key: 'agosto', full: 'Agosto' },
  { abbrev: 'set', label: 'Set', key: 'setembro', full: 'Setembro' },
  { abbrev: 'out', label: 'Out', key: 'outubro', full: 'Outubro' },
  { abbrev: 'nov', label: 'Nov', key: 'novembro', full: 'Novembro' },
  { abbrev: 'dez', label: 'Dez', key: 'dezembro', full: 'Dezembro' },
]
