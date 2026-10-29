// Mailing de Comunicados — contrato de /api/mailing/* e /api/public/mailing/* (server.js).
// Módulo deliberadamente isolado do sistema de Alertas (ver banner "MAILING DE
// COMUNICADOS" em server.js): relay SMTP anônimo próprio, sem credencial — por isso
// nenhum tipo aqui tem campo de senha.

export type MailingContatoStatus = 'ativo' | 'opt_out'

export interface MailingContato {
  id: number
  email: string
  nome: string | null
  status: MailingContatoStatus
  origem: 'manual' | 'import'
  grupos?: string[]
  criado_em: string
  atualizado_em: string
}

export interface MailingGrupo {
  id: number
  nome: string
  descricao: string | null
  total_contatos: number
  contato_ids: number[]
  criado_em: string
  atualizado_em: string
}

export interface MailingGrupoInput {
  nome: string
  descricao?: string | null
  contato_ids: number[]
}

export interface MailingGrupoImportResultado {
  ok: boolean
  grupo_id: number
  arquivo_nome: string
  total_linhas: number
  novos: number
  atualizados: number
  associados: number
  invalidos: number
  invalidos_detalhe: string[]
}

export interface MailingSelecaoDestinatarios {
  grupo_ids: number[]
  contato_ids: number[]
  emails?: string[]
  todos_ativos?: boolean
}

export interface MailingImportLote {
  id: number
  arquivo_nome: string
  total_linhas: number
  novos: number
  atualizados: number
  invalidos: number
  invalidos_detalhe: string[]
  importado_por: string | null
  importado_em: string
}

export type MailingCampanhaStatus = 'rascunho' | 'enviando' | 'concluida'

export interface MailingCampanha {
  id: number
  assunto: string
  corpo_html: string
  remetente_email: string | null
  remetente_nome: string | null
  status: MailingCampanhaStatus
  criado_por: string | null
  criado_em: string
  atualizado_em: string
  iniciado_em: string | null
  concluido_em: string | null
  destinatarios?: MailingSelecaoDestinatarios | null
  // Só presentes na listagem (GET /campanhas), não no detalhe de uma campanha
  total_destinatarios?: number
  total_enviados?: number
  total_falhas?: number
}

export interface MailingCampanhaInput {
  assunto: string
  corpo_html: string
  remetente_email?: string | null
  remetente_nome?: string | null
  destinatarios?: MailingSelecaoDestinatarios
}

export type MailingEnvioStatus = 'pendente' | 'enviado' | 'falha'

export interface MailingEnvio {
  id: number
  campanha_id: number
  contato_id: number
  email: string
  nome: string | null
  status: MailingEnvioStatus
  enviado_em: string | null
  erro: string | null
}

export interface MailingCampanhaProgresso {
  em_execucao: boolean
  progresso: { total: number; enviados: number; falhas: number; pendentes?: number } | null
}

// Biblioteca de modelos — "Salvar como modelo" / "Usar modelo" no composer.
export interface MailingTemplate {
  id: number
  nome: string
  corpo_html: string
  remetente_nome: string | null
  remetente_email: string | null
  criado_por: string | null
  criado_em: string
  atualizado_em: string
}

export interface MailingTemplateInput {
  nome: string
  corpo_html: string
  remetente_nome?: string | null
  remetente_email?: string | null
}
