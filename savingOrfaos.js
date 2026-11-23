'use strict';

function diasOrfaoNaExclusao(registro) {
  const desde = registro.desde_orfao_em || registro.primeira_deteccao_em;
  if (!desde || !registro.excluido_em) return null;

  const dias = Math.floor((new Date(registro.excluido_em).getTime() - new Date(desde).getTime()) / 86400000);
  return Number.isFinite(dias) ? Math.max(0, dias) : null;
}

function filtrarOrfaosPublicos(itens, { subscriptionIds = [], categories = [], resourceGroups = [] } = {}, categoriasSemCusto = new Set()) {
  const subsPermitidas = new Set([...subscriptionIds].map((id) => String(id).toLowerCase()));
  const categoriasPermitidas = new Set(categories);
  const rgsPermitidos = new Set([...resourceGroups].map((rg) => String(rg).toUpperCase()));

  return itens.filter((item) =>
    subsPermitidas.has(String(item.subscription_id || '').toLowerCase())
    && categoriasPermitidas.has(item.categoria)
    && (!rgsPermitidos.size || (item.resource_group && rgsPermitidos.has(String(item.resource_group).toUpperCase())))
    && !item.motivo_validacao
    && !categoriasSemCusto.has(item.categoria));
}

module.exports = { diasOrfaoNaExclusao, filtrarOrfaosPublicos };
