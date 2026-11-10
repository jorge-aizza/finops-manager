const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// server.js não exporta nada e subir o servidor num teste unitário não é opção. Técnica
// documentada em MODULES/15-TESTING.md: recortar o bloco e avaliá-lo com as dependências
// stubadas. `node --check` passa em código semanticamente errado — só o teste pega.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')

function extrairFuncao(nome) {
  // Busca literal, sem regex: barra invertida não sobrevive bem ao heredoc, e aqui não precisa.
  let ini = SRC.indexOf('async function ' + nome + '(')
  if (ini < 0) ini = SRC.indexOf('function ' + nome + '(')
  if (ini < 0) throw new Error('função ' + nome + ' não encontrada em server.js')
  // Contador ingênuo de chaves: basta porque ${} de template literal e {n} de regex são
  // sempre balanceados, e estas funções não têm chave solta em comentário.
  let nivel = 0
  for (let i = SRC.indexOf('{', ini); i < SRC.length; i++) {
    if (SRC[i] === '{') nivel++
    else if (SRC[i] === '}' && --nivel === 0) return SRC.slice(ini, i + 1)
  }
  throw new Error('fim de ' + nome + ' não encontrado')
}

function construir(nome, deps = {}) {
  const chaves = Object.keys(deps)
  const fab = new Function(...chaves, `${extrairFuncao(nome)}\nreturn ${nome};`)
  return fab(...chaves.map((k) => deps[k]))
}

// ── _segundosAteBreakerFechar ────────────────────────────────────────────────

const segAteBreaker = construir('_segundosAteBreakerFechar')

test('erro que não é de breaker devolve null', () => {
  assert.equal(segAteBreaker(new Error('HTTP 500')), null)
  assert.equal(segAteBreaker(new Error('Timeout (60s) na chamada Azure')), null)
  assert.equal(segAteBreaker(undefined), null)
})

test('breaker aberto devolve os segundos que faltam para a janela fechar', () => {
  const ate = new Date(Date.now() + 120_000).toISOString()
  const erro = new Error(`Circuit Breaker OPEN — Azure API bloqueada até ${ate} (família: custo)`)
  const seg = segAteBreaker(erro)
  assert.ok(seg >= 118 && seg <= 125, `esperava ~122s, veio ${seg}`)
})

test('breaker sem data parseável cai num fallback em vez de NaN', () => {
  assert.equal(segAteBreaker(new Error('Circuit Breaker OPEN — bloqueada até ? (família: custo)')), 30)
})

test('janela já vencida nunca devolve espera negativa', () => {
  const ate = new Date(Date.now() - 60_000).toISOString()
  const seg = segAteBreaker(new Error(`Circuit Breaker OPEN — até ${ate} (família: custo)`))
  assert.ok(seg > 0, `espera tem que ser positiva, veio ${seg}`)
})

// ── _comRetentativa ──────────────────────────────────────────────────────────

function montarRetentativa() {
  const logs = []
  const fn = construir('_comRetentativa', {
    _logColeta: (m) => logs.push(m),
    _segundosAteBreakerFechar: segAteBreaker,
    _CB_ESPERAS_MAX: 5,
    // dispara na hora: o laço de espera é de 1s por iteração e travaria a suíte
    setTimeout: (cb) => { cb(); return 0 },
  })
  return { fn, logs }
}

const semCancelamento = () => false

test('breaker aberto NÃO gasta tentativa — era o que abandonava a assinatura', async () => {
  const { fn } = montarRetentativa()
  const ate = () => new Date(Date.now() + 2000).toISOString()
  let chamadas = 0
  const alvo = async () => {
    chamadas++
    // 3 recusas por breaker seguidas de sucesso: com o comportamento antigo (breaker gastando
    // tentativa) estourava em 3 tentativas e a assinatura era perdida.
    if (chamadas <= 3) throw new Error(`Circuit Breaker OPEN — até ${ate()} (família: custo)`)
    return 'ok'
  }
  assert.equal(await fn(alvo, 'sub-x', 3, {}, semCancelamento), 'ok')
  assert.equal(chamadas, 4)
})

test('erro comum gasta tentativa e lança na última', async () => {
  const { fn } = montarRetentativa()
  let chamadas = 0
  const alvo = async () => { chamadas++; throw new Error('HTTP 500') }
  await assert.rejects(fn(alvo, 'sub-y', 3, {}, semCancelamento), /HTTP 500/)
  assert.equal(chamadas, 3)
})

test('espera de breaker tem teto, senão gira para sempre', async () => {
  const { fn } = montarRetentativa()
  let chamadas = 0
  const alvo = async () => {
    chamadas++
    throw new Error(`Circuit Breaker OPEN — até ${new Date(Date.now() + 1000).toISOString()} (família: custo)`)
  }
  await assert.rejects(fn(alvo, 'sub-z', 3, {}, semCancelamento), /Circuit Breaker OPEN/)
  // 5 esperas de breaker + 3 tentativas normais, não infinito
  assert.ok(chamadas <= 9, `girou demais: ${chamadas} chamadas`)
})

test('cancelamento sai na hora, sem consumir tentativa nem esperar', async () => {
  const { fn } = montarRetentativa()
  const alvo = async () => { throw new Error('Cancelado pelo usuário') }
  await assert.rejects(fn(alvo, 'sub-w', 3, {}, semCancelamento), /Cancelado pelo usuário/)
})

test('cancelamento durante a espera interrompe a retentativa', async () => {
  const { fn } = montarRetentativa()
  let chamadas = 0
  const alvo = async () => { chamadas++; throw new Error('HTTP 500') }
  await assert.rejects(fn(alvo, 'sub-v', 3, {}, () => true), /Cancelado pelo usuário/)
  assert.equal(chamadas, 1)
})

// ── _apagarSnapshotAnterior ──────────────────────────────────────────────────

function montarApagar(rowCount = 0) {
  const queries = []
  const fn = construir('_apagarSnapshotAnterior', {
    pool: { query: async (q, p) => { queries.push({ q, p }); return { rowCount } } },
    _logColeta: () => {},
  })
  return { fn, queries }
}

test('apaga escopado por assinatura e pelo período do chunk', async () => {
  const { fn, queries } = montarApagar(12)
  assert.equal(await fn('sub-1', '2026-10-01', '2026-10-31', null, {}), 12)
  assert.equal(queries.length, 1)
  assert.match(queries[0].q, /DELETE FROM azure_costs/)
  assert.match(queries[0].q, /subscription_id = \$1/)
  assert.match(queries[0].q, /cost_date >= \$2::date AND cost_date <= \$3::date/)
  assert.deepEqual(queries[0].p, ['sub-1', '2026-10-01', '2026-10-31'])
})

test('com rgFilter ativo o DELETE usa o MESMO recorte da importação', async () => {
  // Sem isto apagaria RGs que a importação não vai repor.
  const { fn, queries } = montarApagar(3)
  await fn('sub-1', '2026-10-01', '2026-10-31', new Set(['RG-A', 'RG-B']), {})
  assert.match(queries[0].q, /UPPER\(resource_group_name\) = ANY\(\$4\)/)
  assert.deepEqual(queries[0].p[3], ['RG-A', 'RG-B'])
})

test('rgFilter vazio não vira cláusula — apagaria nada', async () => {
  const { fn, queries } = montarApagar(1)
  await fn('sub-1', '2026-10-01', '2026-10-31', new Set(), {})
  assert.ok(!/resource_group_name/.test(queries[0].q))
  assert.equal(queries[0].p.length, 3)
})

test('datas entram como string do chunk, nunca reconstruídas', async () => {
  // _splitDateRange tem dependência implícita de fuso; reconstruir a data aqui deslocaria o dia.
  const { fn, queries } = montarApagar(0)
  await fn('sub-1', '2026-08-01', '2026-08-31', null, {})
  assert.equal(typeof queries[0].p[1], 'string')
  assert.equal(queries[0].p[1], '2026-08-01')
  assert.equal(queries[0].p[2], '2026-08-31')
})
