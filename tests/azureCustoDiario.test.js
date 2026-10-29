const test = require('node:test')
const assert = require('node:assert/strict')
const {
  mesDaDataCusto,
  registrarMesCustoImportado,
  reconstruirMesCustoDiario,
  reconstruirMesesCustoDiario,
} = require('../azureCustoDiario')

test('mesDaDataCusto normaliza datas sem deslocar o mês', () => {
  assert.equal(mesDaDataCusto(new Date('2026-10-01T00:00:00.000Z')), '2026-10')
  assert.equal(mesDaDataCusto('2026-10-26'), '2026-10')
  assert.equal(mesDaDataCusto('2026-13-01'), null)
  assert.equal(mesDaDataCusto(null), null)
})

test('registrarMesCustoImportado registra mês histórico mesmo em linha já existente', () => {
  const meses = new Set()
  assert.equal(registrarMesCustoImportado(meses, '2025-02-14'), true)
  assert.equal(registrarMesCustoImportado(meses, new Date('2025-02-28T00:00:00.000Z')), true)
  assert.equal(registrarMesCustoImportado(meses, 'inválida'), false)
  assert.deepEqual([...meses], ['2025-02'])
})

test('reconstruirMesCustoDiario serializa e substitui um mês usando as linhas brutas', async () => {
  const chamadas = []
  const client = {
    query: async (sql, params) => {
      chamadas.push({ sql, params })
      return { rowCount: sql.startsWith('INSERT INTO azure_custo_diario') ? 12 : 0 }
    },
  }

  assert.equal(await reconstruirMesCustoDiario(client, '2026-10'), 12)
  assert.match(chamadas[0].sql, /pg_advisory_xact_lock/)
  assert.deepEqual(chamadas[0].params, ['azure_custo_diario:2026-10'])
  assert.match(chamadas[1].sql, /DELETE FROM azure_custo_diario/)
  assert.match(chamadas[2].sql, /FROM azure_costs/)
  assert.deepEqual(chamadas[1].params, ['2026-10-01'])
  assert.deepEqual(chamadas[2].params, ['2026-10-01'])
})

test('reconstruirMesesCustoDiario deduplica, ordena e faz rollback após erro', async () => {
  const chamadas = []
  const pool = {
    connect: async () => ({
      query: async (sql) => {
        chamadas.push(sql)
        if (sql.startsWith('INSERT INTO azure_custo_diario')) throw new Error('falha de teste')
        return { rowCount: 0 }
      },
      release: () => chamadas.push('RELEASE'),
    }),
  }

  await assert.rejects(
    reconstruirMesesCustoDiario(pool, ['2026-10', '2026-09', '2026-10']),
    /falha de teste/
  )
  assert.deepEqual(chamadas.slice(0, 2), ['BEGIN', 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))'])
  assert.ok(chamadas.includes('ROLLBACK'))
  assert.equal(chamadas.filter((sql) => sql === 'BEGIN').length, 1)
  assert.equal(chamadas.at(-1), 'RELEASE')
})