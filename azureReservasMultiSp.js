'use strict';

async function sincronizarReservasMultiSp(configs, sincronizarUmaSp) {
  const itensPorAzureId = new Map();
  const porSp = [];

  for (const config of configs) {
    try {
      const resultado = await sincronizarUmaSp(config);
      const itens = Array.isArray(resultado.itens) ? resultado.itens : [];
      for (const item of itens) {
        const id = String(item.azure_id || '').trim().toLowerCase();
        const chave = id || JSON.stringify(item);
        if (!itensPorAzureId.has(chave)) itensPorAzureId.set(chave, { ...item, _sync_sp_id: config.id });
      }
      porSp.push({
        sp: config.nome,
        total: itens.length,
        ok: resultado.ok !== false,
        avisos: resultado.avisos || [],
      });
    } catch (error) {
      porSp.push({ sp: config.nome, total: 0, ok: false, avisos: [error.message] });
    }
  }

  return { itens: [...itensPorAzureId.values()], por_sp: porSp };
}

module.exports = { sincronizarReservasMultiSp };