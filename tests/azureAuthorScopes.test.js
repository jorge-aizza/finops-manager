const test = require('node:test');
const assert = require('node:assert/strict');
const { groupAuthorIdsBySp, prioritizeGraphSpCandidates } = require('../azureAuthorScopes');

test('groups GUIDs by the SP that owns each subscription', () => {
  const owners = new Map([['sub-ti', 5], ['sub-4p', 6]]);
  const result = groupAuthorIdsBySp([
    { subscription_id: 'SUB-TI', autor: 'guid-1' },
    { subscription_id: 'sub-4p', autor: 'guid-2' },
    { subscription_id: 'sub-4p', autor: 'guid-2' },
  ], owners);

  assert.deepEqual([...result.grouped].map(([sp, ids]) => [sp, [...ids]]), [[5, ['guid-1']], [6, ['guid-2']]]);
  assert.equal(result.unassigned.size, 0);
});

test('uses an explicitly configured Graph SP when supplied', () => {
  const result = groupAuthorIdsBySp([{ subscription_id: 'sub-4p', autor: 'guid-1' }], new Map([['sub-4p', 6]]), 5);
  assert.deepEqual([...result.grouped].map(([sp, ids]) => [sp, [...ids]]), [[5, ['guid-1']]]);
});

test('reports authors with no resolved subscription owner', () => {
  const result = groupAuthorIdsBySp([{ subscription_id: 'sub-unknown', autor: 'guid-1' }], new Map());
  assert.equal(result.grouped.size, 0);
  assert.deepEqual([...result.unassigned], ['guid-1']);
});

test('tries every active inventory SP and prioritizes the configured Graph SP', () => {
  const candidates = [
    { id: 5, nome: 'TI', is_padrao: true },
    { id: 6, nome: '4P', is_padrao: false },
    { id: 7, nome: 'Outra', is_padrao: false },
  ];

  assert.deepEqual(prioritizeGraphSpCandidates(candidates, '6').map((sp) => sp.id), [6, 5, 7]);
  assert.deepEqual(prioritizeGraphSpCandidates(candidates).map((sp) => sp.id), [5, 6, 7]);
});