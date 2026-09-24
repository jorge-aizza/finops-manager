'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planejarDesativacao } = require('../inventarioReconcile');

const INICIO = '2026-09-23T12:00:00Z';
const antigo = '2026-09-20T00:00:00Z';
const tipos = new Set(['microsoft.compute/disks', 'microsoft.compute/virtualmachines']);
const linha = (id, resource_id, type = 'microsoft.compute/disks', ref_em = antigo) => ({ id, resource_id, resource_type: type, ref_em });

test('desativa ativo que sumiu do Azure, ignorando diferença de caixa', () => {
  const p = planejarDesativacao({
    ativosNoBanco: [linha(1, '/Subscriptions/S/Disks/A'), linha(2, '/Subscriptions/S/Disks/B')],
    idsNoAzure: new Set(['/subscriptions/s/disks/a']),
    tiposNoAzure: tipos, inicioSnapshot: INICIO,
  });
  assert.deepEqual(p.desativar, [2]);
  assert.equal(p.bloqueado, false);
});

test('snapshot vazio bloqueia', () => {
  const p = planejarDesativacao({ ativosNoBanco: [linha(1, '/x')], idsNoAzure: new Set(), tiposNoAzure: tipos, inicioSnapshot: INICIO });
  assert.equal(p.bloqueado, true);
  assert.deepEqual(p.desativar, []);
});

test('tipo ausente do snapshot não é tocado', () => {
  const p = planejarDesativacao({
    ativosNoBanco: [linha(1, '/x/insight', 'microsoft.insights/whatever')],
    idsNoAzure: new Set(['/outro']), tiposNoAzure: tipos, inicioSnapshot: INICIO,
  });
  assert.deepEqual(p.desativar, []);
  assert.equal(p.ignoradosTipo, 1);
});

test('recurso recente (depois do início do snapshot - margem) é preservado', () => {
  const p = planejarDesativacao({
    ativosNoBanco: [linha(1, '/novo', 'microsoft.compute/disks', '2026-09-23T11:30:00Z'), linha(2, '/velho')],
    idsNoAzure: new Set(['/outro']), tiposNoAzure: tipos, inicioSnapshot: INICIO,
  });
  assert.deepEqual(p.desativar, [2]);
  assert.equal(p.protegidosRecentes, 1);
});

test('desativar mais de 50% (base >= 20) bloqueia por snapshot suspeito', () => {
  const ativos = Array.from({ length: 30 }, (_, i) => linha(i + 1, '/r' + i));
  const p = planejarDesativacao({
    ativosNoBanco: ativos, idsNoAzure: new Set(['/r0', '/r1']), tiposNoAzure: tipos, inicioSnapshot: INICIO,
  });
  assert.equal(p.bloqueado, true);
  assert.deepEqual(p.desativar, []);
});

test('base pequena não dispara a trava de fração', () => {
  const p = planejarDesativacao({
    ativosNoBanco: [linha(1, '/a'), linha(2, '/b')], idsNoAzure: new Set(['/z']), tiposNoAzure: tipos, inicioSnapshot: INICIO,
  });
  assert.equal(p.bloqueado, false);
  assert.deepEqual(p.desativar, [1, 2]);
});
