// Contrato de server.js (/api/public/calculadora/config e /identificar) —
// Fase A do Portal Público: só o "chrome" (cabeçalho, identificação, tema,
// hero, estados carregando/inativo). A calculadora em si continua 100%
// calculadora.js legado — Calculadora.init({apiBase, publico:true,
// defaultConfig}) é chamado depois que este componente resolve a config e a
// identificação, exatamente como _abrirCalculadora() fazia no portal.html
// legado.

export interface HorarioLivreConfig {
  ativo: boolean
  inicio: string
  fim: string
  dias: number[]
}

export interface PortalConfig {
  titulo: string | null
  descricao: string | null
  dominios_aceitos: string[]
  taxa_imposto: number
  taxa_cond: number
  taxa_gordura: number
  horario_livre: HorarioLivreConfig
  solicitar_identificacao: boolean
  permitir_selecao_periodo: boolean
  permitir_selecao_recursos: boolean
}

export interface PortalIdentSessao {
  nome: string
  email: string
}
