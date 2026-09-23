'use strict';
// Mapeamento puro (sem I/O) das Reservas e Savings Plans do Azure para o formato da
// tabela `reservas_cloud`. Os valores de saída usam o mesmo vocabulário do cadastro
// manual (frontend/src/config/reservaScopes.ts), para que registros importados e
// manuais convivam na mesma tela.

const TIPO_RECURSO = {
  virtualmachines: 'Reserved VM Instances',
  sqldatabases: 'SQL Database',
  sqlmanagedinstances: 'SQL Database',
  sqldatawarehouse: 'SQL Database',
  cosmosdb: 'Cosmos DB',
  appservice: 'App Service Plan',
  databricks: 'Azure Databricks',
  rediscache: 'Redis Cache',
  postgresql: 'PostgreSQL Flexible',
  mysql: 'MySQL Flexible',
};

const HORAS_MES = 730;

function toDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function mapPrazo(term) {
  const m = /^P(\d+)Y$/i.exec(term || '');
  if (!m) return null;
  return m[1] === '1' ? '1 ano' : m[1] + ' anos';
}

function mapPagamento(billingPlan) {
  const p = String(billingPlan || '').toLowerCase();
  if (p === 'upfront') return 'All Upfront';
  if (p === 'monthly' || p === 'p1m') return 'Monthly';
  return null;
}

function lastSegment(id) {
  return String(id || '').split('/').filter(Boolean).pop() || null;
}

function mapEscopo(props) {
  const tipo = String(props.appliedScopeType || '').toLowerCase();
  const scopes = Array.isArray(props.appliedScopes) ? props.appliedScopes : [];
  const sp = props.appliedScopeProperties || {};
  const subMatch = /\/subscriptions\/([^/]+)/i.exec(sp.subscriptionId || sp.resourceGroupId || scopes[0] || '');
  const subId = subMatch ? subMatch[1] : null;

  if (tipo === 'shared') return { tipo_escopo: 'Shared', subscription_id: null, resource_group_name: null };
  if (tipo === 'managementgroup') {
    return {
      tipo_escopo: 'Management Group',
      subscription_id: lastSegment(sp.managementGroupId || scopes[0]),
      resource_group_name: null,
    };
  }
  if (sp.resourceGroupId) {
    return { tipo_escopo: 'Resource Group', subscription_id: subId, resource_group_name: lastSegment(sp.resourceGroupId) };
  }
  return { tipo_escopo: 'Subscription', subscription_id: subId, resource_group_name: null };
}

function mapStatus(provisioningState, dataVencimento, hoje) {
  const s = String(provisioningState || '').toLowerCase();
  if (s === 'cancelled' || s === 'canceled' || s === 'merged' || s === 'split' || s === 'failed') return 'Cancelada';
  if (s === 'expired') return 'Expirada';
  return dataVencimento < hoje ? 'Expirada' : 'Ativa';
}

function moedaBRL(currencyCode) {
  return String(currencyCode || '').toUpperCase() === 'BRL';
}

// Uma reserva (Microsoft.Capacity/reservationOrders/{o}/reservations/{r}).
// `order` é opcional e só complementa campos ausentes na reserva.
function mapReservation(res, order, hoje = new Date().toISOString().slice(0, 10)) {
  const p = res.properties || {};
  const o = (order && order.properties) || {};
  const vencimento = toDate(p.expiryDate || p.expiryDateTime || o.expiryDate);
  if (!res.id || !vencimento) return null;

  const tipoBruto = String(p.reservedResourceType || '');
  const nome = p.displayName || res.name || lastSegment(res.id);

  return {
    azure_id: res.id.toLowerCase(),
    cloud: 'Azure',
    nome_reserva: nome,
    ...mapEscopo(p),
    tipo_recurso: TIPO_RECURSO[tipoBruto.toLowerCase()] || tipoBruto || 'Reserved VM Instances',
    instancia: (res.sku && res.sku.name) || null,
    quantidade: Number.isFinite(p.quantity) ? p.quantity : 1,
    prazo: mapPrazo(p.term || o.term),
    opcao_pagamento: mapPagamento(p.billingPlan || o.billingPlan),
    custo_total: null,
    custo_mensal: null,
    data_inicio: toDate(p.effectiveDateTime || p.purchaseDate || p.benefitStartTime || o.createdDateTime),
    data_vencimento: vencimento,
    status: mapStatus(p.provisioningState, vencimento, hoje),
  };
}

// Um Savings Plan (Microsoft.BillingBenefits/savingsPlans). O compromisso é por hora
// (grain Hourly); o custo mensal só é preenchido quando a moeda é BRL, para não misturar
// USD com R$ na tela.
function mapSavingsPlan(sp, hoje = new Date().toISOString().slice(0, 10)) {
  const p = sp.properties || {};
  const vencimento = toDate(p.expiryDateTime || p.expiryDate);
  if (!sp.id || !vencimento) return null;

  const c = p.commitment || {};
  let mensal = null;
  if (moedaBRL(c.currencyCode) && Number.isFinite(c.amount)) {
    const fator = String(c.grain || 'Hourly').toLowerCase() === 'hourly' ? HORAS_MES : 1;
    mensal = Math.round(c.amount * fator * 100) / 100;
  }

  return {
    azure_id: sp.id.toLowerCase(),
    cloud: 'Azure',
    nome_reserva: p.displayName || sp.name || lastSegment(sp.id),
    ...mapEscopo(p),
    tipo_recurso: 'Azure Savings Plan (Compute)',
    instancia: null,
    quantidade: 1,
    prazo: mapPrazo(p.term),
    opcao_pagamento: mapPagamento(p.billingPlan),
    custo_total: null,
    custo_mensal: mensal,
    data_inicio: toDate(p.effectiveDateTime || p.purchaseDateTime || p.benefitStartTime),
    data_vencimento: vencimento,
    status: mapStatus(p.provisioningState, vencimento, hoje),
  };
}

module.exports = { mapReservation, mapSavingsPlan, mapEscopo, mapStatus, mapPrazo, mapPagamento };
