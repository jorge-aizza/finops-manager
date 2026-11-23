const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveInventorySubscriptionOwners } = require('../azureInventoryScope');

const ti = { id: 5, nome: 'TI', is_padrao: true, subscription_ids: 'sub-ti,sub-4p' };
const fourP = { id: 6, nome: '4p', is_padrao: false, subscription_ids: 'sub-4p' };

test('duplicate subscription goes to the SP with RBAC, not the default SP', () => {
  const result = resolveInventorySubscriptionOwners([ti, fourP], new Map([
    [5, new Set(['sub-ti'])],
    [6, new Set(['sub-4p'])],
  ]));

  assert.deepEqual(result.scopes.map((scope) => [scope.subscriptionId, scope.sp.nome]), [
    ['sub-ti', 'TI'],
    ['sub-4p', '4p'],
  ]);
  assert.equal(result.scopes.every((scope) => scope.accessVerified), true);
});

test('default SP breaks ties only when both credentials can access the subscription', () => {
  const result = resolveInventorySubscriptionOwners([ti, fourP], new Map([
    [5, new Set(['sub-ti', 'sub-4p'])],
    [6, new Set(['sub-4p'])],
  ]));

  assert.equal(result.scopes.find((scope) => scope.subscriptionId === 'sub-4p').sp.nome, 'TI');
});

test('falls back to the default candidate only when access checks failed', () => {
  const result = resolveInventorySubscriptionOwners([ti, fourP], new Map([[5, null]]));

  assert.equal(result.scopes.find((scope) => scope.subscriptionId === 'sub-4p').sp.nome, 'TI');
  assert.equal(result.scopes.find((scope) => scope.subscriptionId === 'sub-4p').accessVerified, false);
});

test('does not assign a subscription to a credential that is confirmed not to have it', () => {
  const result = resolveInventorySubscriptionOwners([ti, fourP], new Map([
    [5, new Set(['sub-ti'])],
    [6, new Set()],
  ]));

  assert.deepEqual(result.unowned, ['sub-4p']);
  assert.deepEqual(result.scopes.map((scope) => scope.subscriptionId), ['sub-ti']);
});