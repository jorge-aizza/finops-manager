'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sincronizarReservasMultiSp } = require('../azureReservasMultiSp');

test('continua com as outras SPs após uma falha e deduplica reservas pelo azure_id', async () => {
  const chamadas = [];
  const resultado = await sincronizarReservasMultiSp([
    { id: 1, nome: 'SP sem permissão' },
    { id: 2, nome: 'SP proprietária' },
    { id: 3, nome: 'SP com visibilidade compartilhada' },
  ], async (config) => {
    chamadas.push(config.id);
    if (config.id === 1) throw new Error('Reservations Reader ausente');
    return {
      itens: config.id === 2
        ? [{ azure_id: '/reservas/r1' }, { azure_id: '/reservas/r2' }]
        : [{ azure_id: '/RESERVAS/R1' }],
      avisos: [],
    };
  });

  assert.deepEqual(chamadas, [1, 2, 3]);
  assert.deepEqual(resultado.itens.map((item) => item.azure_id), ['/reservas/r1', '/reservas/r2']);
  assert.deepEqual(resultado.itens.map((item) => item._sync_sp_id), [2, 2]);
  assert.deepEqual(resultado.por_sp.map(({ sp, total, ok }) => ({ sp, total, ok })), [
    { sp: 'SP sem permissão', total: 0, ok: false },
    { sp: 'SP proprietária', total: 2, ok: true },
    { sp: 'SP com visibilidade compartilhada', total: 1, ok: true },
  ]);
  assert.deepEqual(resultado.por_sp[0].avisos, ['Reservations Reader ausente']);
});