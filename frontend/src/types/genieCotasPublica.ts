import type { GenieActionType } from './genieBudgets'

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
  custo: number
  limite_local: number | null
  quota_nativa: number | null
  acao_nativa: GenieActionType | null
  dias: GenieCotaPublicaDia[]
}

export interface GenieCotasPublicaResposta {
  ativo: true
  nome: string
  workspaces: GenieCotaPublicaWorkspace[]
}
