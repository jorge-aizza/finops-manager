'use strict';

function diasOrfaoNaExclusao(registro) {
  const desde = registro.desde_orfao_em || registro.primeira_deteccao_em;
  if (!desde || !registro.excluido_em) return null;

  const dias = Math.floor((new Date(registro.excluido_em).getTime() - new Date(desde).getTime()) / 86400000);
  return Number.isFinite(dias) ? Math.max(0, dias) : null;
}

module.exports = { diasOrfaoNaExclusao };
