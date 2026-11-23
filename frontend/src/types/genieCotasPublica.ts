// Contrato de GET /api/public/genie-cotas — visão PESSOAL (nunca traz outro usuário/workspace
// além do que pertence a quem está logado; o servidor filtra pelo e-mail do token Entra ID).
export interface GenieCotaPublicaDia {
  dia: string
  custo: number
  dbus: number
  dbus_free: number
}

export interface GenieCotaPublicaWorkspace {
  workspace_id: string
  workspace_nome: string
  custo: number
  dbus: number
  quota_nativa: number | null
  limite_per_user: number | null
  status: string | null
  status_usuario?: string | null
  nome_budget_ws?: string | null
  nome_budget_per_user?: string | null
  tipo_acao_budget?: string | null
  dbus_free?: number
  dias: GenieCotaPublicaDia[]
  detalhes: {
    dia: string
    produto: string
    sku: string
    endpoint: string
    dbus: number
    custo: number
  }[]
}

export interface GenieCotasPublicaResposta {
  ativo: true
  nome: string
  periodo: 'today' | 'month' | 'all'
  workspaces: GenieCotaPublicaWorkspace[]
  cache?: {
    atualizado_em: string
    desatualizado: boolean
    atualizando: boolean
  }
}

export type GenieCotasPeriodoPublico = GenieCotasPublicaResposta['periodo']
