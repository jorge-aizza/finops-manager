const test = require('node:test')
const assert = require('node:assert/strict')
const {
  MAX_PARAMS_PG,
  linhasPorComando,
  montarInsertMultiplo,
  achatarValores,
  inserirLinhasEmLote,
} = require('../azureCostsInsert')

// Client falso: registra os comandos e deixa o teste escolher quais falham.
function fakeClient({ falharSe = () => false } = {}) {
  const queries = []
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params })
      if (falharSe(sql, params)) throw new Error('erro simulado')
      return { rowCount: 1 }
    },
  }
}

const COLS = ['a', 'b', 'c']
const linha = (n) => ({ a: n, b: 'x' + n, c: null })

test('monta uma tupla de placeholders por linha, numerada em sequência', () => {
  assert.equal(
    montarInsertMultiplo('t', ['a', 'b'], 3),
    'INSERT INTO t (a, b) VALUES ($1, $2), ($3, $4), ($5, $6)'
  )
})

test('achata os valores na ordem das colunas e troca ausente por null', () => {
  assert.deepEqual(achatarValores(['a', 'b'], [{ a: 1, b: 2 }, { a: 3 }]), [1, 2, 3, null])
})

// Sem este teto o comando estoura o limite do protocolo e CAI no fallback sempre — ficando mais
// lento que o código original, não mais rápido.
test('respeita o limite de parâmetros do Postgres', () => {
  assert.equal(linhasPorComando(69, 500), 500)
  assert.equal(linhasPorComando(69, 100000), Math.floor(MAX_PARAMS_PG / 69))
  assert.ok(linhasPorComando(69, 100000) * 69 <= MAX_PARAMS_PG)
  assert.equal(linhasPorComando(70000, 500), 1, 'coluna demais ainda tem que inserir 1 por vez')
})

test('caminho feliz: um comando por fatia, não um por linha', async () => {
  const c = fakeClient()
  const r = await inserirLinhasEmLote(c, 'azure_costs', COLS, [linha(1), linha(2), linha(3)], {
    tetoLinhasPorComando: 500,
  })
  assert.deepEqual(r, { ins: 3, err: 0 })
  const inserts = c.queries.filter((q) => q.sql.startsWith('INSERT'))
  assert.equal(inserts.length, 1, 'as 3 linhas tinham que ir num comando só')
  assert.equal(inserts[0].params.length, 9)
})

test('fatia conforme o teto pedido', async () => {
  const c = fakeClient()
  await inserirLinhasEmLote(c, 'azure_costs', COLS, [linha(1), linha(2), linha(3), linha(4), linha(5)], {
    tetoLinhasPorComando: 2,
  })
  const inserts = c.queries.filter((q) => q.sql.startsWith('INSERT'))
  assert.equal(inserts.length, 3) // 2 + 2 + 1
})

// A propriedade que não pode se perder na otimização.
test('linha ruim não derruba as boas da mesma fatia', async () => {
  // falha o lote (3 tuplas) e também a linha 2 sozinha
  const c = fakeClient({
    falharSe: (sql, params) =>
      (sql.startsWith('INSERT') && params.length === 9) ||
      (sql.startsWith('INSERT') && params[0] === 2),
  })
  const recusadas = []
  const r = await inserirLinhasEmLote(c, 'azure_costs', COLS, [linha(1), linha(2), linha(3)], {
    onErroLinha: (e, l, i) => recusadas.push({ valor: l.a, indice: i }),
  })
  assert.deepEqual(r, { ins: 2, err: 1 })
  assert.deepEqual(recusadas, [{ valor: 2, indice: 1 }])
})

test('o lote que falha é desfeito antes do fallback, senão a transação fica abortada', async () => {
  const c = fakeClient({ falharSe: (sql, params) => sql.startsWith('INSERT') && params.length === 9 })
  await inserirLinhasEmLote(c, 'azure_costs', COLS, [linha(1), linha(2), linha(3)])
  const ordem = c.queries.map((q) => q.sql.split(' ').slice(0, 3).join(' '))
  const iInsertLote = ordem.indexOf('INSERT INTO azure_costs')
  assert.equal(ordem[iInsertLote - 1], 'SAVEPOINT lote')
  assert.equal(ordem[iInsertLote + 1], 'ROLLBACK TO SAVEPOINT')
  assert.ok(ordem.includes('SAVEPOINT linha'), 'fallback tem que isolar linha a linha')
})

test('cada SAVEPOINT é liberado, no sucesso e na falha', async () => {
  const c = fakeClient({ falharSe: (sql, params) => sql.startsWith('INSERT') && params.length === 6 })
  await inserirLinhasEmLote(c, 'azure_costs', COLS, [linha(1), linha(2)])
  const abertos = c.queries.filter((q) => q.sql.startsWith('SAVEPOINT')).length
  const liberados = c.queries.filter((q) => q.sql.startsWith('RELEASE SAVEPOINT')).length
  assert.equal(abertos, liberados, 'SAVEPOINT vazando acumula memória na transação')
})

test('lista vazia não toca no banco', async () => {
  const c = fakeClient()
  assert.deepEqual(await inserirLinhasEmLote(c, 'azure_costs', COLS, []), { ins: 0, err: 0 })
  assert.equal(c.queries.length, 0)
})
