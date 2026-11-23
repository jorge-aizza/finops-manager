const test = require('node:test')
const assert = require('node:assert/strict')
const { createGenieCotasCache } = require('../genieCotasCache')

function criarCacheFake(clock, collect, options = {}) {
  const rows = new Map()
  const pool = {
    async query(sql, params) {
      if (sql.includes('SELECT payload')) {
        const row = rows.get(params[0])
        return { rows: row ? [{ ...row }] : [] }
      }
      const row = { payload: params[1], coletado_em: new Date(clock.value) }
      rows.set(params[0], row)
      return { rows: [{ ...row }] }
    },
  }
  return {
    ...createGenieCotasCache({ getPool: () => pool, collect, now: () => clock.value, ...options }),
    rows,
  }
}

test('cache frio coleta e persiste o snapshot antes de responder', async () => {
  const clock = { value: Date.parse('2026-11-18T12:00:00Z') }
  const payload = { periodo: 'month', workspaces: [{ workspace_id: '10' }], usuarios: [] }
  let chamadas = 0
  const cache = criarCacheFake(clock, async () => { chamadas++; return payload })

  const resultado = await cache.get('month')

  assert.deepEqual(resultado, {
    payload,
    atualizado_em: new Date(clock.value),
    desatualizado: false,
    atualizando: false,
  })
  assert.equal(chamadas, 1)
})

test('cache fresco é reutilizado sem iniciar outra consulta', async () => {
  const clock = { value: Date.parse('2026-11-18T12:00:00Z') }
  let chamadas = 0
  const cache = criarCacheFake(clock, async () => ({ versao: ++chamadas }))

  await cache.get('month')
  const resultado = await cache.get('month')

  assert.equal(chamadas, 1)
  assert.deepEqual(resultado.payload, { versao: 1 })
  assert.equal(resultado.atualizando, false)
})

test('cache padrão só expira depois de uma hora', async () => {
  const clock = { value: Date.parse('2026-11-18T12:00:00Z') }
  let chamadas = 0
  const cache = criarCacheFake(clock, async () => ({ versao: ++chamadas }))

  await cache.get('month')
  clock.value += 59 * 60 * 1000
  const fresco = await cache.get('month')

  assert.equal(fresco.desatualizado, false)
  assert.equal(chamadas, 1)

  clock.value += 60 * 1000
  const vencido = await cache.get('month')
  assert.equal(vencido.desatualizado, true)
  assert.equal(chamadas, 2)
})

test('TTL pode variar por período: month em seis horas e today em uma hora', async () => {
  const clock = { value: Date.parse('2026-11-18T12:00:00Z') }
  let chamadas = 0
  const cache = criarCacheFake(clock, async () => ({ versao: ++chamadas }), {
    ttlMs: (period) => period === 'month' ? 6 * 60 * 60 * 1000 : 60 * 60 * 1000,
  })

  await cache.get('month')
  await cache.get('today')
  clock.value += 2 * 60 * 60 * 1000

  const month = await cache.get('month')
  const today = await cache.get('today')
  assert.equal(month.desatualizado, false)
  assert.equal(today.desatualizado, true)
})

test('cache vencido responde com snapshot e atualiza em segundo plano', async () => {
  const clock = { value: Date.parse('2026-11-18T12:00:00Z') }
  let chamadas = 0
  let concluirAtualizacao
  const cache = criarCacheFake(clock, async () => {
    chamadas++
    if (chamadas === 1) return { versao: 1 }
    return new Promise((resolve) => { concluirAtualizacao = resolve })
  }, { ttlMs: 1000 })

  await cache.get('month')
  clock.value += 1001
  const vencido = await cache.get('month')

  assert.deepEqual(vencido.payload, { versao: 1 })
  assert.equal(vencido.desatualizado, true)
  assert.equal(vencido.atualizando, true)
  assert.equal(chamadas, 2)

  concluirAtualizacao({ versao: 2 })
  const atualizado = await cache.refresh('month')
  assert.deepEqual(atualizado.payload, { versao: 2 })
})

test('falha na coleta mantém o último snapshot válido no banco', async () => {
  const clock = { value: Date.parse('2026-11-18T12:00:00Z') }
  let chamadas = 0
  const cache = criarCacheFake(clock, async () => {
    chamadas++
    if (chamadas === 1) return { versao: 1 }
    throw new Error('Databricks indisponível')
  }, { ttlMs: 1000, onRefreshError: () => {} })

  await cache.get('month')
  clock.value += 1001
  const vencido = await cache.get('month')
  await assert.rejects(cache.refresh('month'), /Databricks indisponível/)

  assert.deepEqual(vencido.payload, { versao: 1 })
  assert.deepEqual(cache.rows.get('month').payload, { versao: 1 })
})