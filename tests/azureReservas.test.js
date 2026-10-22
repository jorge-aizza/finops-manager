'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mapReservation, mapSavingsPlan, mapReservationRelatorio } = require('../azureReservas');

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

// ── mapReservationRelatorio — relatório "Reservations" exportado pela Azure ────────
// Cabeçalho real enviado pelo usuário (2026-10-22): Name, Reservation Id, Reservation
// order Id, Status, Expiration date, Purchase date, Term, Scope, Scope subscription,
// Scope resource group, Type, Product name, Region, Quantity, Utilization % 1/7/30 Day,
// Deep link to reservation. Só o cabeçalho foi confirmado — valores de Status/Term/Scope
// são tratados por substring, não por igualdade, porque não há amostra de linha real.

test('relatório: linha completa, mesmo vocabulário do cadastro manual', () => {
  const row = {
    'Name': 'VM-Prod-Reserva',
    'Reservation Id': 'R1',
    'Reservation order Id': 'O1',
    'Status': 'Succeeded',
    'Expiration date': '1/10/2028',
    'Purchase date': '1/10/2025',
    'Term': '3 Years',
    'Scope': 'Single subscription',
    'Scope subscription': 'Produção',
    'Scope resource group': '',
    'Type': 'VirtualMachines',
    'Product name': 'Standard_D4s_v5',
    'Region': 'eastus',
    'Quantity': '3',
    'Utilization % 1 Day': '98.2',
    'Deep link to reservation': 'https://portal.azure.com/x',
  };
  const r = mapReservationRelatorio(row, HOJE);
  assert.equal(r.cloud, 'Azure');
  assert.equal(r.nome_reserva, 'VM-Prod-Reserva');
  assert.equal(r.tipo_escopo, 'Subscription');
  assert.equal(r.subscription_id, 'Produção');
  assert.equal(r.resource_group_name, null);
  assert.equal(r.tipo_recurso, 'Reserved VM Instances');
  assert.equal(r.instancia, 'Standard_D4s_v5');
  assert.equal(r.quantidade, 3);
  assert.equal(r.prazo, '3 anos');
  assert.equal(r.data_inicio, '2025-01-10');
  assert.equal(r.data_vencimento, '2028-01-10');
  assert.equal(r.status, 'Ativa');
  // Utilization/Region/link não são gravados — ver comentário no mapper.
  assert.equal('utilizacao' in r, false);
  assert.equal('region' in r, false);
});

test('relatório: azure_id reconstruído é IDÊNTICO ao da sincronização por SP (mesma reserva não duplica)', () => {
  const viaRelatorio = mapReservationRelatorio({
    'Name': 'x', 'Reservation Id': 'R1', 'Reservation order Id': 'O1',
    'Expiration date': '2028-01-10', 'Scope': 'Shared', 'Type': 'VirtualMachines',
  }, HOJE);
  const viaArm = mapReservation({
    id: '/providers/Microsoft.Capacity/reservationOrders/O1/reservations/R1',
    properties: { reservedResourceType: 'VirtualMachines', appliedScopeType: 'Shared', expiryDate: '2028-01-10' },
  }, null, HOJE);
  assert.equal(viaRelatorio.azure_id, viaArm.azure_id);
  assert.equal(viaRelatorio.azure_id, '/providers/microsoft.capacity/reservationorders/o1/reservations/r1');
});

test('relatório: sem Reservation order Id não finge saber o azure_id da ARM (prefixo próprio, não colide por engano)', () => {
  const r = mapReservationRelatorio({ 'Name': 'x', 'Reservation Id': 'R9', 'Expiration date': '2028-01-10' }, HOJE);
  assert.equal(r.azure_id, 'relatorio:r9');
  assert.ok(!r.azure_id.startsWith('/providers/'));
});

test('relatório: escopo Resource Group e Management Group por texto', () => {
  const rg = mapReservationRelatorio({
    'Name': 'x', 'Expiration date': '2028-01-10',
    'Scope': 'Single resource group', 'Scope subscription': 'sub-a', 'Scope resource group': 'rg-dados',
  }, HOJE);
  assert.equal(rg.tipo_escopo, 'Resource Group');
  assert.equal(rg.subscription_id, 'sub-a'); // RG também carrega subscription_id — mesmo comportamento de mapEscopo (ARM)
  assert.equal(rg.resource_group_name, 'rg-dados');

  const mg = mapReservationRelatorio({ 'Name': 'x', 'Expiration date': '2028-01-10', 'Scope': 'Management group' }, HOJE);
  assert.equal(mg.tipo_escopo, 'Management Group');
});

test('relatório: Status desconhecido cai para a data (mesmo fallback do caminho ARM)', () => {
  const futura = mapReservationRelatorio({ 'Name': 'x', 'Expiration date': '2099-01-01', 'Status': 'Processing' }, HOJE);
  assert.equal(futura.status, 'Ativa');
  const passada = mapReservationRelatorio({ 'Name': 'x', 'Expiration date': '2020-01-01', 'Status': 'Processing' }, HOJE);
  assert.equal(passada.status, 'Expirada');
});

test('relatório: Status com texto de cancelamento/falha vira Cancelada mesmo com vencimento futuro', () => {
  const r = mapReservationRelatorio({ 'Name': 'x', 'Expiration date': '2099-01-01', 'Status': 'Cancelled' }, HOJE);
  assert.equal(r.status, 'Cancelada');
});

test('relatório: Term em formato ISO (P1Y) também é aceito, não só texto', () => {
  assert.equal(mapReservationRelatorio({ 'Name': 'x', 'Expiration date': '2028-01-10', 'Term': 'P1Y' }, HOJE).prazo, '1 ano');
  assert.equal(mapReservationRelatorio({ 'Name': 'x', 'Expiration date': '2028-01-10', 'Term': 'P3Y' }, HOJE).prazo, '3 anos');
});

test('relatório: cabeçalho com capitalização/espaçamento diferente ainda casa (case/espaço-insensível)', () => {
  const r = mapReservationRelatorio({
    'name': 'x', 'EXPIRATION DATE': '2028-01-10', 'reservation id': 'R1', 'Reservation Order ID': 'O1',
  }, HOJE);
  assert.equal(r.nome_reserva, 'x');
  assert.equal(r.data_vencimento, '2028-01-10');
  assert.equal(r.azure_id, '/providers/microsoft.capacity/reservationorders/o1/reservations/r1');
});

test('relatório: sem nome ou sem vencimento, linha é ignorada (null)', () => {
  assert.equal(mapReservationRelatorio({ 'Reservation Id': 'R1', 'Expiration date': '2028-01-10' }, HOJE), null); // sem Name
  assert.equal(mapReservationRelatorio({ 'Name': 'x' }, HOJE), null); // sem Expiration date
});

test('relatório: tipo desconhecido preserva o texto bruto da coluna Type', () => {
  const r = mapReservationRelatorio({ 'Name': 'x', 'Expiration date': '2028-01-10', 'Type': 'AlgoNovo' }, HOJE);
  assert.equal(r.tipo_recurso, 'AlgoNovo');
});

test('relatório: Quantity ausente ou inválida vira 1 (nunca 0 nem NaN)', () => {
  assert.equal(mapReservationRelatorio({ 'Name': 'x', 'Expiration date': '2028-01-10' }, HOJE).quantidade, 1);
  assert.equal(mapReservationRelatorio({ 'Name': 'x', 'Expiration date': '2028-01-10', 'Quantity': '0' }, HOJE).quantidade, 1);
  assert.equal(mapReservationRelatorio({ 'Name': 'x', 'Expiration date': '2028-01-10', 'Quantity': 'n/a' }, HOJE).quantidade, 1);
});
