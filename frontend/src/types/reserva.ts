// Contrato exato de server.js (tabela `reservas_cloud`, rotas /api/reservas).
export interface Reserva {
  id: number
  cloud: string
  nome_reserva: string
  tipo_escopo: string
  subscription_id: string | null
  resource_group_name: string | null
  tipo_recurso: string
  instancia: string | null
  quantidade: number
  prazo: string | null
  opcao_pagamento: string | null
  custo_total: number | null
  custo_mensal: number | null
  data_inicio: string | null
  data_vencimento: string
  status: string
  observacoes: string | null
  criado_por: number | null
  criado_por_nome?: string | null
  criado_em: string
  atualizado_em: string
}

export interface ReservaInput {
  cloud: string
  nome_reserva: string
  tipo_escopo: string
  subscription_id: string | null
  resource_group_name: string | null
  tipo_recurso: string
  instancia: string
  quantidade: number
  prazo: string
  opcao_pagamento: string
  custo_total: number | null
  custo_mensal: number | null
  data_inicio: string
  data_vencimento: string
  status: string
  observacoes: string
}

export interface AzureSubscription {
  subscription_id: string
  subscription_name: string | null
}

export interface AzureResourceGroup {
  resource_group_name: string
  managed_type?: string | null
  managed_label?: string | null
}
