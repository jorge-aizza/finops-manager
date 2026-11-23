const test = require('node:test');
const assert = require('node:assert/strict');
const { azureSpServiceEnabled } = require('../azureSpCapabilities');

test('preserves service access for legacy SP rows without explicit flags', () => {
  const sp = { id: 1 };
  for (const service of ['billingApi', 'inventory', 'storage', 'reservationsApi']) {
    assert.equal(azureSpServiceEnabled(sp, service), true);
  }
});

test('disables only the selected service capability', () => {
  const sp = { coletar_billing_api: false, coletar_inventario: true, coletar_storage: true, coletar_reservas_api: true };
  assert.equal(azureSpServiceEnabled(sp, 'billingApi'), false);
  assert.equal(azureSpServiceEnabled(sp, 'inventory'), true);
  assert.equal(azureSpServiceEnabled(sp, 'storage'), true);
  assert.equal(azureSpServiceEnabled(sp, 'reservationsApi'), true);
});

test('rejects unknown capability names', () => {
  assert.throws(() => azureSpServiceEnabled({}, 'unknown'), /Serviço de SP desconhecido/);
});