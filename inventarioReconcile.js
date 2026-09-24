'use strict';
// Decide quais recursos "ativos" do Inventário devem ser desativados por não existirem mais
// no snapshot do Resource Graph (fonte de verdade do que existe AGORA). Função pura.
//
// Travas contra desativar por engano:
//  1. Snapshot vazio => bloqueia (provável falha/permissão, não "tudo foi apagado").
//  2. Só considera tipos que aparecem no snapshot — o Resource Graph não cobre todo tipo que o
//     Change Analysis reporta, e desativar esses geraria vai-e-volta a cada coleta.
//  3. Recursos vistos/alterados depois do início da consulta (menos a margem) são preservados —
//     podem ter nascido depois que o snapshot foi tirado.
//  4. Se o plano desativar mais que `maxFracao` dos ativos do escopo (com base mínima de
//     `minAtivos`), bloqueia — sinal de snapshot incompleto.

function planejarDesativacao({
  ativosNoBanco,
  idsNoAzure,
  tiposNoAzure,
  inicioSnapshot,
  margemMs = 2 * 60 * 60 * 1000,
  maxFracao = 0.5,
  minAtivos = 20,
}) {
  if (!idsNoAzure || idsNoAzure.size === 0) {
    return { desativar: [], protegidosRecentes: 0, ignoradosTipo: 0, bloqueado: true, motivo: 'Resource Graph retornou 0 recursos' };
  }
  const corte = new Date(inicioSnapshot).getTime() - margemMs;
  const desativar = [];
  let protegidosRecentes = 0;
  let ignoradosTipo = 0;

  for (const r of ativosNoBanco) {
    if (idsNoAzure.has(String(r.resource_id).toLowerCase())) continue;
    if (!r.resource_type || !tiposNoAzure.has(String(r.resource_type).toLowerCase())) { ignoradosTipo++; continue; }
    const ref = r.ref_em ? new Date(r.ref_em).getTime() : null;
    if (ref !== null && ref > corte) { protegidosRecentes++; continue; }
    desativar.push(r.id);
  }

  if (ativosNoBanco.length >= minAtivos && desativar.length / ativosNoBanco.length > maxFracao) {
    return {
      desativar: [], protegidosRecentes, ignoradosTipo, bloqueado: true,
      motivo: `Desativaria ${desativar.length} de ${ativosNoBanco.length} ativos (> ${Math.round(maxFracao * 100)}%) — snapshot suspeito`,
    };
  }
  return { desativar, protegidosRecentes, ignoradosTipo, bloqueado: false, motivo: null };
}

module.exports = { planejarDesativacao };
