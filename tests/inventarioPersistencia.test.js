const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Carência de dias do Inventário: um recurso só conta como real depois de sobreviver alguns
// dias. Medido nesta base em 2026-11: dos 1,53 milhão de recursos já excluídos, 99,2% viveram
// menos de UM dia — disco, placa de rede e VM de autoescala nascendo e morrendo juntos.
//
// Técnica de extração documentada em MODULES/15-TESTING.md: server.js não exporta nada.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')

function extrair(nome) {
  const i = SRC.indexOf(`const ${nome}`)
  assert.ok(i > 0, `${nome} não encontrado em server.js`)
  const fim = SRC.indexOf('};', i)
  const trecho = fim > i && fim - i < 600 ? SRC.slice(i, fim + 2) : SRC.slice(i, SRC.indexOf('\n', i))
  return new Function(`${trecho}\nreturn ${nome};`)()
}

const idadeSql = extrair('_invIdadeDiasSql')
const DIAS = extrair('_INV_DIAS_MIN_PERSISTENTE')

test('a carência é um número de dias plausível', () => {
  assert.equal(typeof DIAS, 'number')
  assert.ok(DIAS >= 1 && DIAS <= 60, `carência de ${DIAS} dias não faz sentido`)
})

// A decisão que mais importa, e a que estava errada: 71% do inventário ativo (26.915 de 37.795)
// veio da reconciliação e NÃO tem criado_em. As duas consultas que tinham piso descartavam esses
// recursos — uma pela comparação com NULL, outra por COALESCE(...,0) — e com isso mediam 19% do
// parque achando que mediam tudo.
test('idade cai em detectado_em quando não há data de criação', () => {
  const sql = idadeSql()
  assert.match(sql, /COALESCE\(/, 'sem fallback, NULL descarta 71% do inventário')
  assert.match(sql, /criado_em/)
  assert.match(sql, /detectado_em/)
  // detectado_em nasceu TIMESTAMP sem fuso e nunca foi migrado — sem o cast o COALESCE falha.
  assert.match(sql, /detectado_em::timestamptz/)
})

test('a ordem do COALESCE respeita a data real quando ela existe', () => {
  const sql = idadeSql()
  assert.ok(
    sql.indexOf('criado_em') < sql.indexOf('detectado_em'),
    'detectado_em é limite INFERIOR da idade — só vale quando criado_em falta'
  )
})

test('aceita alias de tabela, porque as consultas usam ri. e sem alias', () => {
  assert.match(idadeSql('ri'), /ri\.criado_em/)
  assert.match(idadeSql('ri'), /ri\.detectado_em/)
  assert.ok(!/\bri\./.test(idadeSql()), 'sem alias não pode prefixar nada')
})

test('devolve dias, não segundos', () => {
  assert.match(idadeSql(), /86400/)
})

// Guarda contra a regressão que originou tudo isto: o 7 estava repetido em duas consultas, com
// tratamentos de NULL divergentes entre elas.
test('nenhuma consulta de inventário calcula idade por fora do helper', () => {
  // Ignora o corpo do próprio helper — é lá que a conta mora legitimamente.
  // _invVidaDiasSql (tempo de vida até a exclusão) tem a MESMA forma textual (86400 +
  // criado_em) que este teste varre — por isso o recorte vai até o FIM dela, não da primeira.
  const ini = SRC.indexOf('const _invIdadeDiasSql')
  const fim = SRC.indexOf('};', SRC.indexOf('const _invVidaDiasSql', ini)) + 2
  const fora = SRC.slice(0, ini) + SRC.slice(fim)
  const suspeitas = fora
    .split(/\r?\n/)
    .map((l, i) => ({ n: i + 1, l }))
    .filter(({ l }) => /86400/.test(l) && /criado_em/.test(l))
  assert.deepEqual(
    suspeitas.map((s) => s.n),
    [],
    'idade calculada à mão reintroduz a divergência de tratamento de NULL:\n' +
      suspeitas.map((s) => `  linha ~${s.n}: ${s.l.trim().slice(0, 100)}`).join('\n')
  )
})

test('o piso não aparece mais como número solto nas consultas de persistência', () => {
  const linhas = SRC.split(/\r?\n/)
  const soltas = linhas
    .map((l, i) => ({ n: i + 1, l }))
    .filter(({ l }) => l.includes('_invIdadeDiasSql') && />=\s*7\b/.test(l))
  assert.deepEqual(soltas.map((s) => s.n), [], 'use _INV_DIAS_MIN_PERSISTENTE, não 7 literal')
})
