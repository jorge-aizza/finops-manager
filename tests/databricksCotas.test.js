const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')

function extractFunction(name) {
  const start = serverSource.indexOf(`function ${name}(`)
  const end = serverSource.indexOf('\n}\n', start)
  if (start < 0 || end < 0) throw new Error(`Não foi possível localizar ${name} em server.js`)
  return serverSource.slice(start, end + 2)
}

const mappers = new Function(
  `${extractFunction('_cotaStatus')}\n${extractFunction('_mapearCotasWorkspaces')}\n${extractFunction('_mapearCotasUsuarios')}; return { _mapearCotasWorkspaces, _mapearCotasUsuarios }`
)()

const budget = (escopo_tipo, workspace_id, valor_mensal, usuario = null) => ({
  escopo_tipo, workspace_id, valor_mensal, usuario, nome: 'Budget mensal',
  threshold_atencao: 75, threshold_critico: 90,
})

test('completa workspace sem consumo com custo zero e aplica a quota mensal', () => {
  const rows = mappers._mapearCotasWorkspaces(
    ['ws-com-consumo', 'ws-sem-consumo', 'ws-sem-budget'],
    [{ workspace_id: 'ws-com-consumo', custo: '25', dbus: '4', dbus_free: '1', dbus_pago: '3' }],
    [budget('workspace', 'ws-com-consumo', '100'), budget('workspace', 'ws-sem-consumo', '80')],
    1,
  )

  const semConsumo = rows.find(row => row.workspace_id === 'ws-sem-consumo')
  assert.equal(semConsumo.custo, 0)
  assert.equal(semConsumo.cota, 80)
  assert.equal(semConsumo.pct, 0)
  assert.equal(semConsumo.status, 'ok')
  assert.equal(rows.find(row => row.workspace_id === 'ws-sem-budget').status, 'sem_cota')
})

test('não aplica teto individual ao consumo sem identidade e não duplica estado sem consumo', () => {
  const rows = mappers._mapearCotasUsuarios(
    [{ workspace_id: 'ws-anon', usuario: '', custo: '140', dbus: '8', dbus_free: '0', dbus_pago: '8' }],
    [budget('workspace_por_usuario', 'ws-anon', '100'), budget('workspace_por_usuario', 'ws-vazio', '80')],
    1,
    ['ws-anon', 'ws-vazio'],
    true,
  )

  const semIdentidade = rows.find(row => row.workspace_id === 'ws-anon')
  assert.equal(semIdentidade.usuario, '(não identificado)')
  assert.equal(semIdentidade.limite, null)
  assert.equal(semIdentidade.status, 'sem_cota')
  assert.equal(rows.some(row => row.workspace_id === 'ws-anon' && row.usuario === 'Sem consumo'), false)

  const vazio = rows.find(row => row.workspace_id === 'ws-vazio')
  assert.equal(vazio.usuario, 'Sem consumo')
  assert.equal(vazio.custo, 0)
  assert.equal(vazio.limite, 80)
})