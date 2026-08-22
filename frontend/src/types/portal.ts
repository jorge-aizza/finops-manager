// Contrato de server.js (/api/public/calculadora/config e /identificar) —
// Fase A do Portal Público: só o "chrome" (cabeçalho, identificação, tema,
// hero, estados carregando/inativo). A calculadora em si continua 100%
// calculadora.js legado — Calculadora.init({apiBase, publico:true,
// defaultConfig}) é chamado depois que este componente resolve a config e a
// identificação, exatamente como _abrirCalculadora() fazia no portal.html
// legado.

import type { HorarioLivre } from './calculadora'

export interface PortalConfig {
  titulo: string | null
  descricao: string | null
  dominios_aceitos: string[]
  taxa_imposto: number
  taxa_cond: number
  taxa_gordura: number
  // Mesmo shape de HorarioLivre (calculadora.ts) — a config do portal
  // SEMPRE inclui inicio_sab/fim_sab/inicio_dom/fim_dom (admin configura
  // horário de fim de semana separado do de dias úteis; ver
  // #portal-cfg-hl-ini-sab/fim-sab em app.js).
  horario_livre: HorarioLivre
  solicitar_identificacao: boolean
  permitir_selecao_periodo: boolean
  permitir_selecao_recursos: boolean
}

export interface PortalIdentSessao {
  nome: string
  email: string
}
