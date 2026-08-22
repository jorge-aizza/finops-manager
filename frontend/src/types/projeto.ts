// Contrato exato de server.js (tabela `projetos`, rotas /api/projetos).
export interface Projeto {
  id: number
  nome: string
  diretoria: string | null
  descricao: string | null
  status: string
  criado_em: string
  atualizado_em: string
}

export interface ProjetoInput {
  nome: string
  diretoria: string
  descricao: string
}
