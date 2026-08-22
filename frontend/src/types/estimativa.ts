// Contrato de server.js (rotas /api/estimativas). A tela EstimativasView é
// read/manage-only — não existe criação por aqui: estimativas nascem só via
// "Visualizar Estimativa" na Calculadora (CalculadoraView/InvoiceModal), que
// faz POST /api/estimativas fire-and-forget (ver createEstimativa em api/estimativas.ts).

export type EstimativaStatus = 'Pendente' | 'Aprovado' | 'Nao Aprovado'

// Item de recursos[] (JSONB) — construído em calculadora.js, armazenado
// verbatim. Itens com tipo_custo === 'mes' são custo fixo mensal e ficam
// FORA da soma de total_brl/total_final (regra de negócio, não bug).
export interface RecursoEstimativa {
  resource_id: string
  nome: string
  sku: string
  categoria: string
  consumed_service: string
  resource_group: string
  uom: string
  tipo_custo: 'hora' | 'dia' | 'periodo' | 'mes' | 'reserva'
  fixo_mensal: boolean
  isHora: boolean
  horas: number
  custo_hora: number
  fonte_estimado: string
  custo_mes: number
  dias_ativos: number
  total_cobrado: number
  estimado_brl: number
  moeda: string
  databricks_valida?: boolean
  databricks_taxa?: number
}

// Shape de GET /api/estimativas (lista) — SEM `recursos` (JSONB grande,
// só vem no detalhe) mas COM `projeto_nome_atual` (via LEFT JOIN projetos,
// nome ao vivo — a tela legada só usa o snapshot `projeto_nome`).
export interface EstimativaResumo {
  id: number
  projeto_id: number | null
  projeto_nome: string | null
  numero: string
  titulo: string
  responsavel: string | null
  validade_dias: number
  data_estimativa: string | null
  horas: number | null
  pct_imposto: number
  pct_cond: number
  vl_imposto: number
  vl_cond: number
  total_brl: number
  total_final: number
  observacoes: string | null
  status: EstimativaStatus
  criado_em: string
  atualizado_em: string
  projeto_nome_atual: string | null
}

// Shape de GET /api/estimativas/:id (SELECT * — inclui `recursos`, não
// inclui `projeto_nome_atual` que só existe no JOIN da lista).
export interface Estimativa extends Omit<EstimativaResumo, 'projeto_nome_atual'> {
  recursos: RecursoEstimativa[]
  email?: string
}

// Corpo de POST /api/estimativas — fire-and-forget, resultado ignorado pelo
// chamador (mesmo comportamento do calculadora.js legado: o preview do PDF
// não depende do save ter funcionado).
export interface EstimativaInput {
  projeto_id: number | null
  projeto_nome: string
  numero: string
  titulo: string
  responsavel: string
  validade_dias: number
  data_estimativa: string
  horas: number | null
  pct_imposto: number
  pct_cond: number
  vl_imposto: number
  vl_cond: number
  total_brl: number
  total_final: number
  observacoes: string
  recursos: RecursoEstimativa[]
}
