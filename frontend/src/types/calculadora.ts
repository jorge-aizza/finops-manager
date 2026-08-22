// Contrato de server.js (rotas /api/calculadora) — Fase A: fluxo de consulta
// completo (seleção sub/RG, busca de recursos, filtros, 3 visões, Configurar
// Estimativa). PDF/Invoice, Purge, Diagnóstico, Reconciliação (modal) e Portal
// Público ficam no calculadora.js legado via bridge — não portados aqui.

export interface SubscriptionOption {
  subscription_id: string
  subscription_name: string | null
  periodo_inicio: string | null
  periodo_fim: string | null
  moeda: string | null
}

export interface ResourceGroupOption {
  resource_group_name: string
  moeda: string | null
  managed_type: 'databricks' | 'aks' | null
  managed_label: string | null
  managed_region?: string | null
  parent_rg: string | null
}

export type TipoCusto = 'reserva' | 'hora' | 'dia' | 'mes' | 'periodo'

// Uma linha por (resource_id × meter) — o mesmo resource_id pode repetir
// pra meters diferentes (recurso "multi-meter"); `_key` desambigua.
export interface RecursoBilling {
  resource_id: string
  resource_group_name: string
  nome_recurso: string
  categoria: string | null
  meter_categories: string | null
  subcategoria: string | null
  produto: string | null
  consumed_service: string | null
  charge_type: string | null
  pricing_model: string | null
  publisher_type: string | null
  publisher_name: string | null
  regiao: string | null
  location: string | null
  moeda: string
  unidade: string
  tipo_custo: TipoCusto
  taxa_cambio: number
  custo_hora_billing: number
  usa_amortizado: boolean
  taxa_hora_rate: number
  custo_uom_billing: number
  custo_uom_usd: number
  dias_ativos: number
  total_billing: number
  total_usd: number
  total_qty: number
  custo_mes_billing: number
  custo_dia_billing: number
  custo_dia_usd: number
  custo_hora_usd: number
  total_upq_brl: number
  total_upq_usd: number
  horas_reais: number
  soma_h_driver: number
  usa_30d: boolean
  // Só vêm preenchidos quando a busca é refeita com `pico=1` (lazy, ao abrir
  // o overlay Configurar Estimativa) — 0/null antes disso.
  custo_hora_pico?: number
  custo_hora_pico_cluster?: number
  pico_custo_rg?: number
  pico_h_driver?: number
  pico_custo_dia?: number
  pico_horas_dia?: number
}

export interface RecursosQuery {
  subscription_id: string[]
  resource_group: string[]
  data_inicio: string
  data_fim: string
  pico?: boolean
}

export interface ReconciliacaoPorTipo {
  charge_type: string
  linhas: number
  total: number
  excluido: boolean
}

export interface Reconciliacao {
  por_tipo: ReconciliacaoPorTipo[]
  por_moeda: { moeda: string; total: number }[]
  total_bruto: number
  total_excluido: number
  total_sistema: number
}

export interface DetalheDiarioRow {
  cost_date: string
  subscription_id: string
  resource_id: string
  consumed_service: string | null
  meter_name: string | null
  cost: number
}

export interface PorServicoRow {
  consumed_service: string
  qtd_recursos: number
  qtd_rgs: number
  total_brl: number
}

// ── Estado derivado de _calcEstimado (calculadora.js) ──────────────────
// Fonte única do cálculo financeiro por recurso — usada pelos cards do
// overlay, pelo Subtotal/Total e pelo builder do invoice (via bridge). Os
// três nunca podem divergir entre si.
export interface EstimadoResult {
  tipo: TipoCusto
  isBRL: boolean
  convR: number
  chora: number
  custoUomBrl: number
  diasAtiv: number
  mesBrl: number
  bill: number
  dbInfo: DbTaxaInfo | null
  dbValida: boolean
  taxaEf: number
  picoBrl: number
  picoClusterBrl: number
  usaPico: boolean
  usaPicoCluster: boolean
  estimado: number
}

// RN-DB-001 — taxa de cluster Databricks por resource_group (workspace).
export interface DbTaxaInfo {
  taxa: number
  valida: boolean
  totalBrl: number
  hDriver: number
  totalHoras: number
  recursos: number
}

// Item de `resultados[]` — mesmo shape de RecursoEstimativa (types/estimativa.ts),
// já que é o que fica salvo verbatim em `estimativas.recursos` (JSONB) quando
// o invoice é gerado. Duplicado aqui de propósito (não importa de
// types/estimativa.ts) pra manter os dois domínios (Calculadora "ao vivo" vs
// Estimativa salva) desacoplados — só por coincidência têm o mesmo shape hoje.
export interface ResultadoEstimativa {
  resource_id: string
  nome: string
  sku: string
  categoria: string
  consumed_service: string
  resource_group: string
  uom: string
  tipo_custo: TipoCusto
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

export interface RecursoMesFixo {
  nome: string
  uom: string
  valor: number
  tipo: string
  svc: string
  cat: string
}

// Porta de _estimativa (calculadora.js) — objeto passado pro InvoiceModal
// (frontend/src/views/InvoiceModal.tsx) quando o usuário clica "Visualizar
// Estimativa" no overlay Configurar Estimativa. NÃO é o mesmo shape de uma
// estimativa já salva no banco (Estimativa, em types/estimativa.ts) — vira
// isso só depois que o usuário preenche o formulário de invoice
// (projeto/responsável/e-mail) e o InvoiceModal faz o POST /api/estimativas.
export interface EstimativaCalculada {
  total_cobrado: number
  total_brl: number
  total_fixo_mes: number
  recursos_mes: RecursoMesFixo[]
  total_final: number
  pct_imposto: number
  vl_imposto: number
  pct_cond: number
  vl_cond: number
  pct_gordura: number
  vl_gordura: number
  horas: number
  resultados: ResultadoEstimativa[]
}

export interface Periodo {
  inicio: string
  fim: string
  horas: number
  horasTotal: number
  horasLivres: number
}

export interface HorarioLivre {
  ativo: boolean
  inicio: string
  fim: string
  dias: number[] // 0=Dom 1=Seg…6=Sab
  inicio_sab: string
  fim_sab: string
  inicio_dom: string
  fim_dom: string
}
