const test = require('node:test');
const assert = require('node:assert/strict');
const { auxiliaresVencidas, normalizarIntervaloAuxiliar, proximaColetaAuxiliar, createSerialColetaQueue } = require('../databricksColetaAgenda');

test('auxiliares vencem sem data ou quando a próxima coleta já passou', () => {
  const now = Date.parse('2026-11-19T12:00:00Z');
  assert.equal(auxiliaresVencidas(null, now), true);
  assert.equal(auxiliaresVencidas('2026-11-19T11:59:59Z', now), true);
  assert.equal(auxiliaresVencidas('2026-11-19T12:00:01Z', now), false);
});

test('intervalo auxiliar é limitado entre um e trinta dias', () => {
  assert.equal(normalizarIntervaloAuxiliar(0), 1);
  assert.equal(normalizarIntervaloAuxiliar(7), 7);
  assert.equal(normalizarIntervaloAuxiliar(90), 30);
  assert.equal(normalizarIntervaloAuxiliar('inválido'), 1);
});

test('próxima coleta auxiliar usa o intervalo configurado', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  assert.equal(proximaColetaAuxiliar(now, 7).toISOString(), '2026-11-26T12:00:00.000Z');
});

test('fila Databricks serializa conexões, rejeita duplicata e continua após erro', async () => {
  const queue = createSerialColetaQueue();
  const eventos = [];
  let liberarPrimeira;
  const bloqueio = new Promise((resolve) => { liberarPrimeira = resolve; });
  const primeira = queue.enqueue(1, async () => {
    eventos.push('início-1');
    await bloqueio;
    eventos.push('fim-1');
  });
  const duplicada = queue.enqueue(1, async () => eventos.push('duplicada'));
  const segunda = queue.enqueue(2, async () => { eventos.push('início-2'); throw new Error('falha simulada'); });
  const terceira = queue.enqueue(3, async () => eventos.push('início-3'));

  assert.equal(duplicada.accepted, false);
  assert.deepEqual(queue.pendingKeys(), ['1', '2', '3']);
  await Promise.resolve();
  assert.deepEqual(eventos, ['início-1']);
  liberarPrimeira();
  await primeira.promise;
  await assert.rejects(segunda.promise, /falha simulada/);
  await terceira.promise;
  assert.deepEqual(eventos, ['início-1', 'fim-1', 'início-2', 'início-3']);
  assert.equal(queue.size, 0);
});