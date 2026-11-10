const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Guarda contra uma regressão que já aconteceu e passou meses sem ser notada.
//
// `azure_inventario_coleta_historico.origem` nasceu VARCHAR(20) e a reconciliação grava
// `'reconciliacao_' + origem`. Com origem='manual' dá exatos 20 e passa; com 'agendado' dá 22 e
// estoura com "value too long for type character varying(20)". Como o INSERT é a primeira
// instrução do try, a reconciliação SEMANAL falhava antes de fazer qualquer trabalho e sem nem
// deixar linha no histórico — e a manual, que é a que alguém testa à mão, funcionava.
//
// O teste lê a largura EFETIVA da coluna em server.js (DDL + eventuais ALTERs) e confere contra
// o maior valor que o código realmente constrói. Assim ele quebra tanto se alguém estreitar a
// coluna quanto se alguém criar uma origem com nome mais longo.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')

const TABELA = 'azure_inventario_coleta_historico'
const PREFIXO = 'reconciliacao_'

function larguraDeclarada() {
  const i = SRC.indexOf(`CREATE TABLE IF NOT EXISTS ${TABELA}`)
  assert.ok(i > 0, `DDL de ${TABELA} não encontrada em server.js`)
  const ddl = SRC.slice(i, SRC.indexOf('`', i))
  const naDdl = /origem\s+VARCHAR\((\d+)\)/i.exec(ddl)
  assert.ok(naDdl, 'coluna origem não encontrada na DDL')

  // ALTER posterior vence a DDL.
  const alter = new RegExp(
    `ALTER TABLE ${TABELA} ALTER COLUMN origem TYPE VARCHAR\\((\\d+)\\)`, 'i'
  ).exec(SRC)
  return alter ? Number(alter[1]) : Number(naDdl[1])
}

function origensUsadas() {
  // Chamadas literais de _reconciliarInventarioResourceGraph('...')
  const achados = new Set()
  const re = /_reconciliarInventarioResourceGraph\(\s*'([^']+)'\s*\)/g
  let m
  while ((m = re.exec(SRC)) !== null) achados.add(m[1])
  // O default da assinatura também é uma origem possível.
  const def = /async function _reconciliarInventarioResourceGraph\(origem = '([^']+)'\)/.exec(SRC)
  if (def) achados.add(def[1])
  return [...achados]
}

test('a reconciliação ainda grava origem com o prefixo esperado', () => {
  // Se o prefixo mudar, o cálculo de largura abaixo deixa de valer — o teste tem que saber.
  assert.ok(
    SRC.includes(`['${PREFIXO}' + origem]`),
    `o INSERT do histórico não usa mais '${PREFIXO}' + origem — reveja este teste`
  )
})

test('toda origem de reconciliação cabe na coluna do histórico', () => {
  const largura = larguraDeclarada()
  const origens = origensUsadas()
  assert.ok(origens.length >= 2, `esperava manual e agendado, achei: ${origens.join(', ')}`)

  for (const origem of origens) {
    const valor = PREFIXO + origem
    assert.ok(
      valor.length <= largura,
      `"${valor}" tem ${valor.length} caracteres e a coluna aceita ${largura} — ` +
      `a reconciliação com origem="${origem}" vai falhar no INSERT`
    )
  }
})

test('a coluna tem folga para uma origem nova', () => {
  // 'reconciliacao_' já come 14. Sem folga, qualquer origem nova repete o bug.
  const folga = larguraDeclarada() - PREFIXO.length
  assert.ok(folga >= 20, `só sobram ${folga} caracteres para o nome da origem`)
})
