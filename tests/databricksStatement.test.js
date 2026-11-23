const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')
const queryStart = serverSource.indexOf('async function _databricksRunQuery(')
const queryEnd = serverSource.indexOf('\n// Converte a resposta da Statement Execution API', queryStart)
if (queryStart < 0 || queryEnd < 0) throw new Error('Não foi possível localizar _databricksRunQuery em server.js')

function loadQuery(dbxFetch) {
  const source = `${serverSource.slice(queryStart, queryEnd)}; return _databricksRunQuery`
  return new Function('_dbxFetch', '_safeRespJson', '_DBX_POLL_TIMEOUT_MS', '_DBX_POLL_INTERVAL_MS', 'setTimeout', 'clearTimeout', source)(
    dbxFetch,
    async (response) => response.json(),
    300000,
    3000,
    setTimeout,
    clearTimeout,
  )
}

test('billing baixa todos os chunks externos sem enviar bearer para URLs assinadas', async () => {
  const calls = []
  const responses = [
    {
      status: { state: 'SUCCEEDED' },
      statement_id: 'stmt-1',
      manifest: { total_chunk_count: 2, truncated: false },
      result: { external_links: [{ chunk_index: 0, external_link: 'https://storage.invalid/chunk-0' }] },
    },
    { external_links: [{ chunk_index: 1, external_link: 'https://storage.invalid/chunk-1' }] },
  ]
  const query = loadQuery(async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/statements')) return { ok: true, json: async () => responses.shift() }
    if (url.endsWith('/chunks/1')) return { ok: true, json: async () => responses.shift() }
    const data = url.endsWith('chunk-0') ? [['a'], ['b']] : [['c']]
    return { ok: true, json: async () => data }
  })

  const result = await query('https://workspace.invalid/', 'warehouse', 'secret-token', 'SELECT 1', [], 'EXTERNAL_LINKS')

  assert.deepEqual(result.result.data_array, [['a'], ['b'], ['c']])
  const request = JSON.parse(calls[0].options.body)
  assert.equal(request.disposition, 'EXTERNAL_LINKS')
  assert.equal(request.format, 'JSON_ARRAY')
  const signedDownloads = calls.filter((call) => call.url.startsWith('https://storage.invalid/'))
  assert.equal(signedDownloads.length, 2)
  assert.ok(signedDownloads.every((call) => !call.options.headers?.Authorization))
})

test('billing rejeita resultado externo truncado antes de retornar linhas', async () => {
  const query = loadQuery(async () => ({
    ok: true,
    json: async () => ({ status: { state: 'SUCCEEDED' }, manifest: { truncated: true, total_chunk_count: 0 } }),
  }))

  await assert.rejects(query('https://workspace.invalid', 'warehouse', 'token', 'SELECT 1', [], 'EXTERNAL_LINKS'), /truncado/)
})

test('download externo informa o erro HTTP sem expor URL ou assinatura', async () => {
  const query = loadQuery(async (url) => {
    if (url.endsWith('/statements')) {
      return {
        ok: true,
        json: async () => ({
          status: { state: 'SUCCEEDED' },
          statement_id: 'stmt-1',
          manifest: { total_chunk_count: 1, truncated: false },
          result: { external_links: [{ chunk_index: 0, external_link: 'https://storage.invalid/blob?sig=private' }] },
        }),
      }
    }
    return {
      ok: false,
      status: 403,
      text: async () => '<Error><Code>AuthorizationFailure</Code><Message>https://storage.invalid/path?sig=private</Message></Error>',
    }
  })

  await assert.rejects(
    query('https://workspace.invalid', 'warehouse', 'token', 'SELECT 1', [], 'EXTERNAL_LINKS'),
    (error) => {
      assert.match(error.message, /403/)
      assert.match(error.message, /AuthorizationFailure/)
      assert.doesNotMatch(error.message, /storage\.invalid|private/)
      return true
    },
  )
})

test('billing inline busca os chunks restantes antes de devolver o resultado', async () => {
  const calls = []
  const query = loadQuery(async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/statements')) {
      return {
        ok: true,
        json: async () => ({
          status: { state: 'SUCCEEDED' },
          statement_id: 'stmt-inline',
          manifest: { total_chunk_count: 2, truncated: false },
          result: { data_array: [['row-0']] },
        }),
      }
    }
    return { ok: true, json: async () => ({ data_array: [['row-1']] }) }
  })

  const result = await query('https://workspace.invalid', 'warehouse', 'secret-token', 'SELECT 1')

  assert.deepEqual(result.result.data_array, [['row-0'], ['row-1']])
  assert.equal(calls[1].url, 'https://workspace.invalid/api/2.0/sql/statements/stmt-inline/result/chunks/1')
  assert.equal(calls[1].options.headers.Authorization, 'Bearer secret-token')
})

test('renova o token OAuth uma vez e repete a consulta após 403 Invalid Token', async () => {
  const calls = []
  const refreshes = []
  const tokenProvider = async (forceRefresh = false) => {
    refreshes.push(forceRefresh)
    return forceRefresh ? 'fresh-token' : 'expired-token'
  }
  const query = loadQuery(async (url, options = {}) => {
    calls.push({ url, options })
    if (calls.length === 1) {
      const error = 'Invalid Token'
      return {
        ok: false,
        status: 403,
        clone: () => ({ text: async () => error }),
        text: async () => error,
      }
    }
    return {
      ok: true,
      json: async () => ({ status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: [] } }, result: { data_array: [] } }),
    }
  })

  await query('https://workspace.invalid', 'warehouse', tokenProvider, 'SELECT 1')

  assert.deepEqual(refreshes, [false, true])
  assert.equal(calls.length, 2)
  assert.equal(calls[0].options.headers.Authorization, 'Bearer expired-token')
  assert.equal(calls[1].options.headers.Authorization, 'Bearer fresh-token')
})

test('consultas auxiliares usam INLINE e persistem em partições diárias', async () => {
  const helperStart = serverSource.indexOf('async function _coletarDatabricksPorDia(')
  const helperEnd = serverSource.indexOf('\n}\n', helperStart)
  assert.ok(helperStart >= 0 && helperEnd > helperStart, 'particionador diário localizado')
  const helperSource = serverSource.slice(helperStart, helperEnd + 2)
  const nomes = [
    '_coletarJobRunsDatabricks',
    '_coletarUtilizacaoDatabricks',
    '_coletarQueryHistoryDatabricks',
    '_coletarAiGatewayDatabricks',
    '_coletarStorageOtimizacaoDatabricks',
  ]
  const dispositions = []
  const parameters = []

  for (const nome of nomes) {
    const inicio = serverSource.indexOf(`async function ${nome}(`)
    const fim = serverSource.indexOf('\n}\n', inicio)
    assert.ok(inicio >= 0 && fim > inicio, `função ${nome} localizada`)
    const collector = new Function(
      'pool', '_databricksRunQuery', '_parseDatabricksResult',
      `${helperSource}\n${serverSource.slice(inicio, fim + 2)}; return ${nome}`
    )(
      { query: async () => ({ rows: [] }) },
      async (...args) => { dispositions.push(args.at(-1)); parameters.push(args[4]); return {} },
      () => []
    )

    await collector({ workspace_host: 'https://workspace.invalid', warehouse_id: 'warehouse' }, 'token', '2026-07-01', '2026-07-02', 1)
  }

  assert.deepEqual(dispositions, Array(nomes.length * 2).fill('INLINE'))
  for (let i = 0; i < parameters.length; i++) {
    const dia = i % 2 === 0 ? '2026-07-01' : '2026-07-02'
    assert.deepEqual(parameters[i], [
      { name: 'data_inicio', value: dia, type: 'DATE' },
      { name: 'data_fim', value: dia, type: 'DATE' },
    ])
  }
})