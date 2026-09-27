// Contrato de server.js (/api/public/calculadora/config e /identificar).
// PortalApp.tsx (Fase A) resolve config/identificação e monta o "chrome"
// (cabeçalho, tema, hero, estados carregando/inativo); a calculadora em si
// (Fase B) é PublicCalculadoraView.tsx — calculadora.js legado não é mais
// carregado em portal.html.

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
  // Visão de recursos órfãos (interruptor do admin). As listas de assinaturas/RGs/tipos
  // permitidos ficam só no servidor — o cliente nunca as recebe.
  orfaos_ativo?: boolean
  // Interruptor da calculadora (ausente = ativa, como em servidores/configs anteriores).
  calculadora_ativa?: boolean
}

export interface PortalIdentSessao {
  nome: string
  email: string
}
