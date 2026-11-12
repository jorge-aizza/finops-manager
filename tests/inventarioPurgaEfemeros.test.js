const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Purga de recursos EFÊMEROS: critério diferente da retenção de excluídos já existente.
// Aquela apaga pela idade do REGISTRO de exclusão (excluido_em < NOW() - dias); esta apaga pelo
// TEMPO DE VIDA do recurso (excluido_em - criado/detectado_em < dias). Medido nesta base em
// 2026-11: 1,53 milhão de recursos já excluídos, 99,2% com vida < 1 dia.
//
// DELETE permanente, opt-in (desligado por padrão) — pedido explícito do usuário antes de
// construir, dado o efeito irreversível sobre dado histórico.
//
// Técnica de extração documentada em MODULES/15-TESTING.md: server.js não exporta nada.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')

function extrairFuncao(nome) {
  let ini = SRC.indexOf('async function ' + nome + '(')
  if (ini < 0) ini = SRC.indexOf('function ' + nome + '(')
  if (ini < 0) throw new Error('função ' + nome + ' não encontrada em server.js')
  let nivel = 0
  for (let i = SRC.indexOf('{', ini); i < SRC.length; i++) {
    if (SRC[i] === '{') nivel++
    else if (SRC[i] === '}' && --nivel === 0) return SRC.slice(ini, i + 1)
  }
  throw new Error('fim de ' + nome + ' não encontrado')
}

function extrairConst(nome) {
  const i = SRC.indexOf(`const ${nome}`)
  assert.ok(i > 0, `${nome} não encontrado em server.js`)
  const fim = SRC.indexOf('};', i)
  const trecho = fim > i && fim - i < 600 ? SRC.slice(i, fim + 2) : SRC.slice(i, SRC.indexOf('\n', i))
  return new Function(`${trecho}\nreturn ${nome};`)()
}

function construir(nome, deps = {}) {
  const chaves = Object.keys(deps)
  const fab = new Function(...chaves, `${extrairFuncao(nome)}\nreturn ${nome};`)
  return fab(...chaves.map((k) => deps[k]))
}

// ── _invVidaDiasSql ──────────────────────────────────────────────────────────

const vidaSql = extrairConst('_invVidaDiasSql')

test('tempo de vida usa excluido_em, não NOW() — diferente da idade', () => {
  const sql = vidaSql()
  assert.match(sql, /excluido_em/)
  assert.ok(!/NOW\(\)/.test(sql), 'vida é até a EXCLUSÃO, não até agora — isso é idade, não vida')
})

test('cai em detectado_em quando não há data de criação, mesma convenção da idade', () => {
  const sql = vidaSql()
  assert.match(sql, /COALESCE\(/)
  assert.match(sql, /criado_em/)
  assert.match(sql, /detectado_em::timestamptz/)
  assert.ok(
    sql.indexOf('criado_em') < sql.indexOf('detectado_em'),
    'detectado_em só vale quando criado_em falta'
  )
})

test('aceita alias de tabela', () => {
  assert.match(vidaSql('ri'), /ri\.excluido_em/)
  assert.match(vidaSql('ri'), /ri\.criado_em/)
})

// ── _purgarRecursosEfemeros ──────────────────────────────────────────────────

function montarPurga(rowCount = 0) {
  const queries = []
  const fn = construir('_purgarRecursosEfemeros', {
    pool: { query: async (q, p) => { queries.push({ q, p }); return { rowCount } } },
    _logColetaInv: () => {},
    _invVidaDiasSql: vidaSql,
  })
  return { fn, queries }
}

test('desligado não toca no banco', async () => {
  const { fn, queries } = montarPurga(999)
  await fn(false, 1)
  assert.equal(queries.length, 0, 'ativa=false é a configuração padrão — tem que ser inofensiva')
})

test('ligado, apaga só ativo=false com vida menor que o piso', async () => {
  const { fn, queries } = montarPurga(42)
  const removidas = await fn(true, 3)
  assert.equal(removidas, undefined) // função não retorna, só loga — confirma que não quebra chamando sem usar retorno
  assert.equal(queries.length, 1)
  assert.match(queries[0].q, /DELETE FROM azure_recursos_inventario/)
  assert.match(queries[0].q, /ativo = false/)
  assert.match(queries[0].q, /excluido_em IS NOT NULL/)
  assert.deepEqual(queries[0].p, [3])
})

test('nunca filtra por ativo = true — recurso vivo é intocável', async () => {
  const { fn, queries } = montarPurga(0)
  await fn(true, 1)
  assert.ok(!/ativo = true/.test(queries[0].q))
})

test('dias inválido ou ausente cai no default de 1, não em 0 ou NaN', async () => {
  for (const entrada of [0, -5, undefined, null, 'abc']) {
    const { fn, queries } = montarPurga(0)
    await fn(true, entrada)
    assert.deepEqual(queries[0].p, [1], `dias=${entrada} deveria virar 1, não ${queries[0].p[0]}`)
  }
})
