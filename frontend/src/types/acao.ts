// Contrato exato de server.js (tabela `acoes_finops`, rotas /api/acoes).
// 24 colunas numéricas individuais pros meses (não é JSON nem tabela filha) —
// nomes completos em português sem acento (marco, nao marco).
export interface Acao {
  id: number
  id_finops: string
  projeto_id: number | null
  projeto_nome?: string | null
  acao: string
  cloud: string | null
  responsavel: string | null
  tipo_acao: string | null
  impacto_atual_mes: number
  status: string
  data_inicio: string | null
  data_conclusao: string | null
  retorno_ano_atual: number
  retorno_proximo_ano: number
  atual_janeiro: number
  atual_fevereiro: number
  atual_marco: number
  atual_abril: number
  atual_maio: number
  atual_junho: number
  atual_julho: number
  atual_agosto: number
  atual_setembro: number
  atual_outubro: number
  atual_novembro: number
  atual_dezembro: number
  proximo_janeiro: number
  proximo_fevereiro: number
  proximo_marco: number
  proximo_abril: number
  proximo_maio: number
  proximo_junho: number
  proximo_julho: number
  proximo_agosto: number
  proximo_setembro: number
  proximo_outubro: number
  proximo_novembro: number
  proximo_dezembro: number
  criado_em: string
  atualizado_em: string
}

// Corpo enviado ao POST/PUT — server.js (buildAcaoFields) confia nesses
// valores como estão, incluindo os totais (retorno_ano_atual/proximo), que
// portanto precisam ser somados no cliente antes de cada save.
export type AcaoInput = Omit<Acao, 'id' | 'projeto_nome' | 'criado_em' | 'atualizado_em'>

export interface Usuario {
  id: number
  nome: string
  email: string
  ativo: boolean
}
