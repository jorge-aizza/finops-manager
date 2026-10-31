export interface WikiNode {
  type: string
  text?: string
  attrs?: Record<string, string | number | boolean | null>
  marks?: Array<{ type: string; attrs?: Record<string, string> }>
  content?: WikiNode[]
}

export interface WikiDocument {
  type: 'doc'
  content: WikiNode[]
}

export type WikiStatus = 'rascunho' | 'publicado' | 'arquivado'

export interface WikiPageSummary {
  id: number
  slug: string
  titulo: string
  categoria: string
  resumo: string | null
  status: WikiStatus
  atualizado_por: string
  atualizado_em: string
  relevancia?: number
}

export interface WikiPage extends WikiPageSummary {
  conteudo: WikiDocument
  criado_por: string
  criado_em: string
}

export interface WikiCategory {
  categoria: string
  total: number
}

export interface WikiRevision {
  id: number
  versao: number
  titulo: string
  categoria: string
  resumo: string | null
  status: WikiStatus
  alterado_por: string
  alterado_em: string
}

export interface WikiPageInput {
  titulo: string
  categoria: string
  resumo?: string | null
  conteudo: WikiDocument
}

export interface WikiImportedDocument {
  titulo: string
  categoria: string
  resumo: string
  conteudo: WikiDocument
  avisos: string[]
}