// Contrato de server.js — Inventário + Auditoria de Recursos Azure (2026-08-30, pedido do
// usuário: "ontem tinha X recursos, hoje tenho X+1 — quem criou, quando, quanto custa").
// Fonte: Azure Activity Log. Ver seção "INVENTÁRIO + AUDITORIA DE RECURSOS AZURE" em
// server.js.

export interface AzureInventarioConfig {
  id: number
  ativo: boolean
  retencao_dias: number
  sp_id: number | null
  subscription_ids: string | null
  ultimo_evento_em: string | null
  criado_em: string
  atualizado_em: string
}

export interface AzureInventarioConfigInput {
  ativo: boolean
  retencao_dias: number
  sp_id: number | null
  subscription_ids: string | null
}

export interface AzureInventarioStatus {
  em_execucao: boolean
  iniciada_em: string | null
  progresso: {
    fase: string
    sub_atual: string
    sub_idx: number
    sub_total: number
    eventos: number
    novos: number
    atualizados: number
    excluidos: number
    log: { ts: string; msg: string }[]
  }
}

export interface AzureInventarioColetaHistoricoItem {
  id: number
  iniciado_em: string
  concluido_em: string | null
  status: string
  origem: string | null
  periodo_inicio: string | null
  periodo_fim: string | null
  eventos_processados: number
  recursos_novos: number
  recursos_atualizados: number
  recursos_excluidos: number
  mensagem: string | null
}

// Permanente — nunca afetado pela retenção configurável (só o log de auditoria é).
export interface AzureRecursoInventario {
  id: number
  subscription_id: string
  resource_id: string
  resource_type: string | null
  resource_group: string | null
  nome: string | null
  criado_por: string | null
  criado_em: string | null
  atualizado_por: string | null
  atualizado_em: string | null
  excluido_por: string | null
  excluido_em: string | null
  ativo: boolean
  detectado_em: string
  custo_acumulado: number
}

export type AzureAuditoriaAcao = 'CRIACAO' | 'ATUALIZACAO' | 'EXCLUSAO'

// Log bruto — sujeito ao período de retenção configurável.
export interface AzureAuditoriaEvento {
  id: number
  subscription_id: string
  resource_id: string
  resource_type: string | null
  resource_group: string | null
  acao: AzureAuditoriaAcao
  autor: string | null
  quando: string
  operation_name: string | null
  correlation_id: string | null
  criado_em: string
}

// Crescimento — contagem diária de resource_id distintos, derivada de azure_costs (zero
// coleta nova) — funciona mesmo sem o Inventário/Auditoria configurado.
export interface AzureCrescimentoDia {
  cost_date: string
  recursos: number
}
