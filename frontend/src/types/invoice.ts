import type { Periodo, ResultadoEstimativa } from './calculadora'

// Porta de _buildPDFHtml(p) (calculadora.js) — shape exata do objeto que
// monta o documento de estimativa/invoice em HTML. Usado por dois call
// sites: o fluxo "Visualizar Estimativa" da Calculadora (CalculadoraView) e
// o botão "Gerar PDF" de uma estimativa já salva (EstimativasView) — os dois
// chamam a MESMA função pura, pra nunca divergir visualmente entre si.
export interface PdfInvoiceInput {
  invoiceNum: string
  // Define o rótulo institucional usado no nome sugerido ao salvar o PDF (ex:
  // "Portal de Serviço — EST-123456 — ..." vs "FinOps Manager — EST-123456 — ...").
  // Ausente = 'app' (autenticado).
  origem?: 'app' | 'portal'
  dataFmt: string
  dataValid: string
  nomeProjeto: string
  titulo: string
  resp: string
  email: string
  obs: string
  itens: ResultadoEstimativa[]
  // Só presente no fluxo "ao vivo" da Calculadora — estimativas salvas não
  // guardam horas (não é coluna do banco), então a linha "⏱ horas
  // estimadas" do cabeçalho fica omitida pra PDFs recarregados. Comportamento
  // legado preservado, não um bug a corrigir.
  horas?: number
  total_brl: number
  total_fixo_mes: number
  total_final: number
  pct_imposto: number
  vl_imposto: number
  pct_cond: number
  vl_cond: number
  // Só presente no fluxo "ao vivo" — _periodos nunca é persistido no banco,
  // então PDFs de estimativas salvas/recarregadas nunca mostram o bloco de
  // períodos, mesmo que a estimativa original tenha sido feita por datas.
  periodos?: Periodo[] | null
}
