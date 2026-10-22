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

// ── Relatório "Reservations" exportado pela Azure (Cost Management → Exports, ou o
// botão Export da tela Reservations do portal) ──────────────────────────────────────
// Cabeçalho real (2026-10-22, enviado pelo usuário):
//   Name | Reservation Id | Reservation order Id | Status | Expiration date |
//   Purchase date | Term | Scope | Scope subscription | Scope resource group | Type |
//   Product name | Region | Quantity | Utilization % 1 Day | Utilization % 7 Day |
//   Utilization % 30 Day | Deep link to reservation
//
// Vocabulário DIFERENTE do retorno da API ARM (mapReservation acima): aqui "Status"/
// "Term"/"Scope" vêm como texto de tela, não os enums da API (provisioningState/P1Y/
// appliedScopeType). Casamento é por substring, nunca igualdade exata — não há amostra
// de VALORES reais (só o cabeçalho), então o texto exato de cada estado é incerto; a
// data de vencimento é a fonte de verdade para Ativa/Expirada (mesmo fallback de
// mapStatus), o texto da coluna Status só cobre os casos óbvios (cancelada/falha).
//
// SEM Savings Plans: este relatório é só a grade "Reservations" — Savings Plans têm
// tela e export próprios no portal, não cobertos aqui. Quem usa só a importação via
// Storage (sem sync por SP) não vê Savings Plans na tela até sincronizar também por SP.
//
// Utilization %, Region e o link ficam DE FORA do que é gravado: a tabela não tem essas
// colunas, e "observacoes" é campo de dono humano — a sincronização por SP nunca escreve
// nele (nem no UPDATE do ON CONFLICT), então a importação por Storage segue a mesma regra
// em vez de poluir um campo que é do usuário.
const _RSV_REL_TIPO_SLUG = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Mesmo lookup case/espaço-insensível que `_mapRowCSV` (server.js) já usa para o CSV de
// custo — cabeçalho pode variar capitalização/espaçamento entre exports sem quebrar.
function _relatorioCi(row) {
  const porSlug = Object.keys(row || {}).reduce((m, k) => {
    m[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = k;
    return m;
  }, {});
  return (...slugs) => {
    for (const s of slugs) {
      const k = porSlug[s];
      if (k != null) {
        const v = row[k];
        if (v != null && String(v).trim() !== '') return String(v).trim();
      }
    }
    return null;
  };
}

function mapStatusRelatorio(statusTexto, dataVencimento, hoje) {
  const s = String(statusTexto || '').toLowerCase();
  if (/cancel|fail|expired?.?by|merged|split/.test(s)) {
    return /expir/.test(s) ? 'Expirada' : 'Cancelada';
  }
  if (/expir/.test(s)) return 'Expirada';
  // "Succeeded"/"Active"/"Processing" ou qualquer texto não reconhecido: a data manda,
  // mesmo fallback de mapStatus() para o caminho ARM.
  return dataVencimento && dataVencimento < hoje ? 'Expirada' : 'Ativa';
}

function mapPrazoRelatorio(termoTexto) {
  if (!termoTexto) return null;
  const iso = /^P(\d+)Y$/i.exec(termoTexto.trim());
  if (iso) return iso[1] === '1' ? '1 ano' : iso[1] + ' anos';
  return /3/.test(termoTexto) ? '3 anos' : '1 ano';
}

function mapEscopoRelatorio(escopoTexto, subTexto, rgTexto) {
  const s = String(escopoTexto || '').toLowerCase();
  let tipo_escopo = 'Shared';
  if (/resource.?group/.test(s)) tipo_escopo = 'Resource Group';
  else if (/management/.test(s)) tipo_escopo = 'Management Group';
  else if (/subscription/.test(s)) tipo_escopo = 'Subscription';
  return {
    tipo_escopo,
    // "Scope subscription" no relatório é o NOME da assinatura (texto de tela), não o
    // GUID que a sincronização por SP grava em subscription_id — a tela já cai para
    // mostrar o valor cru quando não encontra o id na lista de assinaturas conhecidas
    // (ReservasView.tsx, subRgDisplay), então o campo funciona nos dois casos, só que
    // sem o link automático para o nome oficial da assinatura.
    subscription_id: tipo_escopo === 'Shared' ? null : (subTexto || null),
    resource_group_name: tipo_escopo === 'Resource Group' ? (rgTexto || null) : null,
  };
}

// Uma linha do relatório → mesmo formato de saída de mapReservation/mapSavingsPlan.
// `hoje` é injetável para teste determinístico (mesma convenção das funções ARM acima).
// Retorna null quando falta o mínimo pra identificar a reserva (nome ou vencimento).
function mapReservationRelatorio(row, hoje = new Date().toISOString().slice(0, 10)) {
  const ci = _relatorioCi(row);
  const nome = ci('name');
  const vencimento = toDate(ci('expirationdate', 'expiration'));
  if (!nome || !vencimento) return null;

  const reservationId = ci('reservationid');
  const orderId = ci('reservationorderid', 'reservationorderid');
  // Mesmo formato de azure_id que mapReservation() grava — reconstruído a partir dos
  // dois ids do relatório. Importante: faz a linha importada via Storage colidir (ON
  // CONFLICT) com a MESMA reserva trazida por sincronização via SP, em vez de duplicar.
  // Confirmado pela própria URL que o sync por SP usa pra listar reservas de uma ordem
  // (`${ordem.id}/reservations`, acima): o id de uma reserva é
  // `{id da ordem}/reservations/{id da reserva}`.
  const azure_id = (orderId && reservationId)
    ? `/providers/microsoft.capacity/reservationorders/${orderId.toLowerCase()}/reservations/${reservationId.toLowerCase()}`
    : (reservationId ? `relatorio:${reservationId.toLowerCase()}` : null);

  const tipoBruto = _RSV_REL_TIPO_SLUG(ci('type'));

  return {
    azure_id,
    cloud: 'Azure',
    nome_reserva: nome,
    ...mapEscopoRelatorio(ci('scope'), ci('scopesubscription'), ci('scoperesourcegroup')),
    tipo_recurso: TIPO_RECURSO[tipoBruto] || ci('type') || 'Reserved VM Instances',
    instancia: ci('productname'),
    quantidade: (() => { const n = parseInt(ci('quantity'), 10); return Number.isFinite(n) && n > 0 ? n : 1; })(),
    prazo: mapPrazoRelatorio(ci('term')),
    opcao_pagamento: null, // relatório não traz forma de pagamento
    custo_total: null,
    custo_mensal: null,
    data_inicio: toDate(ci('purchasedate')),
    data_vencimento: vencimento,
    status: mapStatusRelatorio(ci('status'), vencimento, hoje),
  };
}

module.exports = {
  mapReservation, mapSavingsPlan, mapEscopo, mapStatus, mapPrazo, mapPagamento,
  mapReservationRelatorio, mapStatusRelatorio, mapPrazoRelatorio, mapEscopoRelatorio,
};
