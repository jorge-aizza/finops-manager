'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCbFetch, familiaDeUrl, mapLimit, mapLimitSettled } = require('../azureThrottle');

const ADVISOR = 'https://management.azure.com/subscriptions/s/providers/Microsoft.Advisor/recommendations?api-version=2023-01-01';
const CUSTO = 'https://management.azure.com/subscriptions/s/providers/Microsoft.CostManagement/generateCostDetailsReport?api-version=2023-08-01';
const BLOB = 'https://conta.blob.core.windows.net/container/arquivo.csv?sig=x';

function resp(status, retryAfter) {
  return { status, ok: status < 400, headers: { get: (h) => (h === 'Retry-After' && retryAfter != null ? String(retryAfter) : null) } };
}

// Relógio virtual: sleep avança o tempo em vez de esperar de verdade.
function ambiente(respostas) {
  const clock = { t: 0 };
  const chamadas = [];
  const fila = { ...respostas };
  const fetch = async (url) => {
    chamadas.push({ url, t: clock.t });
    const lista = fila[url] || [resp(200)];
    return lista.length > 1 ? lista.shift() : lista[0];
  };
  const logs = [];
  const api = createCbFetch({
    fetch, now: () => clock.t, sleep: async (ms) => { clock.t += ms; }, random: () => 0,
    log: (m) => logs.push(m),
  });
  return { api, clock, chamadas, logs };
}

test('familiaDeUrl separa as APIs', () => {
  assert.equal(familiaDeUrl(ADVISOR), 'advisor');
  assert.equal(familiaDeUrl(CUSTO), 'custo');
  assert.equal(familiaDeUrl('https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01'), 'resourcegraph');
  assert.equal(familiaDeUrl('https://management.azure.com/providers/Microsoft.Capacity/reservationOrders?x=1'), 'reservas');
  assert.equal(familiaDeUrl('https://management.azure.com/providers/Microsoft.Billing/billingAccounts/a/billingProfiles/b/subscriptions'), 'custo');
  assert.equal(familiaDeUrl(BLOB), 'blob');
  assert.equal(familiaDeUrl('https://login.microsoftonline.com/t/oauth2/v2.0/token'), 'identidade');
  assert.equal(familiaDeUrl('https://management.azure.com/subscriptions?api-version=2022-12-01'), 'arm');
});

test('429 seguido de 200: espera o Retry-After e não conta falha no breaker', async () => {
  const { api, clock, chamadas } = ambiente({ [ADVISOR]: [resp(429, 4), resp(200)] });
  const r = await api.cbFetch(ADVISOR);
  assert.equal(r.status, 200);
  assert.equal(chamadas.length, 2);
  assert.ok(chamadas[1].t - chamadas[0].t >= 4000, 'segunda chamada deve respeitar o Retry-After');
  assert.equal(api.estado().advisor.failures, 0);
  assert.ok(clock.t >= 4000);
});

test('429 esgotado lança erro com status 429 e NÃO abre o breaker', async () => {
  const { api } = ambiente({ [ADVISOR]: [resp(429, 1)] });
  for (let i = 0; i < 10; i++) {
    await assert.rejects(api.cbFetch(ADVISOR, {}, { maxRetries: 1 }), (e) => e.status === 429);
  }
  const s = api.estado().advisor;
  assert.equal(s.state, 'CLOSED');
  assert.equal(s.failures, 0);
});

test('a pausa é compartilhada: chamadas concorrentes da mesma família aguardam juntas', async () => {
  const { api, chamadas } = ambiente({ [ADVISOR]: [resp(429, 3), resp(429, 3), resp(200)] });
  await Promise.all([api.cbFetch(ADVISOR), api.cbFetch(ADVISOR)]);
  const primeiras = chamadas.slice(0, 2);
  const retentativas = chamadas.slice(2);
  assert.ok(retentativas.length >= 2);
  for (const c of retentativas) {
    assert.ok(c.t - primeiras[0].t >= 3000, 'nenhuma retentativa antes do fim da pausa');
  }
});

test('5xx abre só a família afetada; as outras continuam liberadas', async () => {
  const { api } = ambiente({ [ADVISOR]: [resp(503)], [CUSTO]: [resp(200)], [BLOB]: [resp(200)] });
  for (let i = 0; i < 3; i++) await api.cbFetch(ADVISOR);
  assert.equal(api.estado().advisor.state, 'OPEN');
  await assert.rejects(api.cbFetch(ADVISOR), /Circuit Breaker OPEN.*advisor/);
  assert.equal((await api.cbFetch(CUSTO)).status, 200);
  assert.equal((await api.cbFetch(BLOB)).status, 200);
  assert.equal(api.resumo().familia, 'advisor');
});

test('depois da janela vai a HALF_OPEN e um sucesso fecha o breaker', async () => {
  const { api, clock } = ambiente({ [ADVISOR]: [resp(503), resp(503), resp(503), resp(200)] });
  for (let i = 0; i < 3; i++) await api.cbFetch(ADVISOR);
  assert.equal(api.estado().advisor.state, 'OPEN');
  clock.t += 5 * 60 * 1000 + 1;
  assert.equal((await api.cbFetch(ADVISOR)).status, 200);
  assert.equal(api.estado().advisor.state, 'CLOSED');
});

test('countCbFailure:false não conta 5xx (downloads via SAS)', async () => {
  const { api } = ambiente({ [BLOB]: [resp(503)] });
  for (let i = 0; i < 5; i++) await api.cbFetch(BLOB, {}, { countCbFailure: false });
  assert.equal(api.estado().blob.state, 'CLOSED');
});

test('mapLimit respeita o limite, preserva a ordem e propaga erro', async () => {
  let emVoo = 0, pico = 0;
  const r = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    emVoo++; pico = Math.max(pico, emVoo);
    await new Promise((res) => setTimeout(res, 5));
    emVoo--; return n * 2;
  });
  assert.deepEqual(r, [2, 4, 6, 8, 10, 12, 14, 16]);
  assert.equal(pico, 3);
  await assert.rejects(mapLimit([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error('x'); return n; }), /x/);
});

test('mapLimitSettled devolve fulfilled/rejected sem lançar', async () => {
  const r = await mapLimitSettled([1, 2, 3], 2, async (n) => { if (n === 2) throw new Error('falha'); return n; });
  assert.deepEqual(r.map((x) => x.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.equal(r[1].reason.message, 'falha');
});
