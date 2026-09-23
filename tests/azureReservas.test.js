'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapReservation, mapSavingsPlan } = require('../azureReservas');

const HOJE = '2026-09-23';

test('reserva de VM em escopo Single/Subscription', () => {
  const r = mapReservation({
    id: '/providers/Microsoft.Capacity/reservationOrders/O1/reservations/R1',
    name: 'O1/R1',
    sku: { name: 'Standard_D4s_v5' },
    properties: {
      displayName: 'VM-Prod', reservedResourceType: 'VirtualMachines', quantity: 3,
      term: 'P3Y', billingPlan: 'Monthly', appliedScopeType: 'Single',
      appliedScopes: ['/subscriptions/aaaa-bbbb'],
      effectiveDateTime: '2025-01-10T00:00:00Z', expiryDate: '2028-01-10',
      provisioningState: 'Succeeded',
    },
  }, null, HOJE);
  assert.equal(r.azure_id, '/providers/microsoft.capacity/reservationorders/o1/reservations/r1');
  assert.equal(r.tipo_recurso, 'Reserved VM Instances');
  assert.equal(r.tipo_escopo, 'Subscription');
  assert.equal(r.subscription_id, 'aaaa-bbbb');
  assert.equal(r.instancia, 'Standard_D4s_v5');
  assert.equal(r.quantidade, 3);
  assert.equal(r.prazo, '3 anos');
  assert.equal(r.opcao_pagamento, 'Monthly');
  assert.equal(r.data_inicio, '2025-01-10');
  assert.equal(r.data_vencimento, '2028-01-10');
  assert.equal(r.status, 'Ativa');
});

test('escopo Shared, upfront e expirada por data', () => {
  const r = mapReservation({
    id: '/x/1',
    properties: {
      reservedResourceType: 'SqlDatabases', term: 'P1Y', billingPlan: 'Upfront',
      appliedScopeType: 'Shared', expiryDate: '2026-01-01', provisioningState: 'Succeeded',
    },
  }, null, HOJE);
  assert.equal(r.tipo_escopo, 'Shared');
  assert.equal(r.subscription_id, null);
  assert.equal(r.tipo_recurso, 'SQL Database');
  assert.equal(r.prazo, '1 ano');
  assert.equal(r.opcao_pagamento, 'All Upfront');
  assert.equal(r.status, 'Expirada');
});

test('escopo Resource Group', () => {
  const r = mapReservation({
    id: '/x/2',
    properties: {
      appliedScopeType: 'Single',
      appliedScopeProperties: { resourceGroupId: '/subscriptions/s1/resourceGroups/rg-dados' },
      expiryDate: '2030-01-01',
    },
  }, null, HOJE);
  assert.equal(r.tipo_escopo, 'Resource Group');
  assert.equal(r.subscription_id, 's1');
  assert.equal(r.resource_group_name, 'rg-dados');
});

test('estado cancelada/merged vira Cancelada; sem vencimento é ignorada', () => {
  const base = { id: '/x/3', properties: { expiryDate: '2030-01-01', provisioningState: 'Merged' } };
  assert.equal(mapReservation(base, null, HOJE).status, 'Cancelada');
  assert.equal(mapReservation({ id: '/x/4', properties: {} }, null, HOJE), null);
});

test('tipo desconhecido preserva o valor bruto', () => {
  const r = mapReservation({ id: '/x/5', properties: { reservedResourceType: 'NewThing', expiryDate: '2030-01-01' } }, null, HOJE);
  assert.equal(r.tipo_recurso, 'NewThing');
});

test('savings plan: compromisso horario em BRL vira custo mensal; USD nao', () => {
  const brl = mapSavingsPlan({
    id: '/providers/Microsoft.BillingBenefits/savingsPlans/SP1', name: 'SP1',
    properties: {
      displayName: 'Compute SP', term: 'P1Y', billingPlan: 'P1M', appliedScopeType: 'Shared',
      commitment: { grain: 'Hourly', amount: 2, currencyCode: 'BRL' },
      effectiveDateTime: '2026-02-01T00:00:00Z', expiryDateTime: '2027-02-01T00:00:00Z',
      provisioningState: 'Succeeded',
    },
  }, HOJE);
  assert.equal(brl.tipo_recurso, 'Azure Savings Plan (Compute)');
  assert.equal(brl.custo_mensal, 1460);
  assert.equal(brl.opcao_pagamento, 'Monthly');
  assert.equal(brl.status, 'Ativa');

  const usd = mapSavingsPlan({
    id: '/sp/2', properties: { commitment: { grain: 'Hourly', amount: 2, currencyCode: 'USD' }, expiryDateTime: '2027-02-01' },
  }, HOJE);
  assert.equal(usd.custo_mensal, null);
});
