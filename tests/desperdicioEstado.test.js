const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8')

function extrairFuncao(nome) {
  let ini = SRC.indexOf('async function ' + nome + '(')
  if (ini < 0) ini = SRC.indexOf('function ' + nome + '(')
  assert.ok(ini >= 0, `${nome} não encontrado em server.js`)
  let nivel = 0
  for (let i = SRC.indexOf('{', ini); i < SRC.length; i++) {
    if (SRC[i] === '{') nivel++
    else if (SRC[i] === '}' && --nivel === 0) return SRC.slice(ini, i + 1)
  }
  throw new Error(`fim de ${nome} não encontrado`)
}

function construir(nome, deps = {}) {
  const chaves = Object.keys(deps)
  return new Function(...chaves, `${extrairFuncao(nome)}\nreturn ${nome};`)(...chaves.map((k) => deps[k]))
}

test('duração usa o início do episódio salvo e exige observação recente', async () => {
  const agora = Date.now()
  const pool = {
    query: async () => ({ rows: [
      {
        resource_id_upper: '/SUBSCRIPTIONS/SUB-1/VM/VM-1',
        categoria: 'vm_parada',
        estado_desde: new Date(agora - 5 * 86400000 - 3600000).toISOString(),
        ultimo_visto_em: new Date(agora - 30 * 60000).toISOString(),
      },
      {
        resource_id_upper: '/SUBSCRIPTIONS/SUB-1/VM/VM-2',
        categoria: 'vm_parada',
        estado_desde: new Date(agora - 10 * 86400000).toISOString(),
        ultimo_visto_em: new Date(agora - 3 * 60 * 60000).toISOString(),
      },
    ] }),
  }
  const calcular = construir('_mapearDiasEstadoDesperdicio', { pool, _DESP_ESTADO_FRESCO_MS: 2 * 60 * 60 * 1000 })
  const resultado = await calcular([
    { resource_id: '/subscriptions/sub-1/vm/vm-1', categoria: 'vm_parada' },
    { resource_id: '/subscriptions/sub-1/vm/vm-2', categoria: 'vm_parada' },
    { resource_id: '/subscriptions/sub-1/vm/vm-3', categoria: 'vm_parada' },
  ])

  assert.equal(resultado.get('/SUBSCRIPTIONS/SUB-1/VM/VM-1').dias_estado_atual, 5)
  assert.equal(resultado.get('/SUBSCRIPTIONS/SUB-1/VM/VM-1').estado_desde, new Date(agora - 5 * 86400000 - 3600000).toISOString())
  assert.equal(resultado.get('/SUBSCRIPTIONS/SUB-1/VM/VM-2').dias_estado_atual, null)
  assert.equal(resultado.get('/SUBSCRIPTIONS/SUB-1/VM/VM-3').dias_estado_atual, null)
})

test('data Azure inválida cai para a duração horária válida', () => {
  const calcular = construir('_duracaoOciosaDesperdicio')

  assert.deepEqual(calcular(true, Number.NaN, 6), { dias_ocioso: 6, fonte_dias_ocioso: 'coleta' })
  assert.deepEqual(calcular(true, Number.NaN, Number.NaN), { dias_ocioso: null, fonte_dias_ocioso: null })
})

test('data Azure inválida usa episódio horário recente para disco', async () => {
  const agora = Date.now()
  const pool = {
    query: async () => ({ rows: [{
      resource_id_upper: '/DISK/1', categoria: 'disco_orfao',
      estado_desde: new Date(agora - 4 * 86400000).toISOString(),
      ultimo_visto_em: new Date(agora - 30 * 60000).toISOString(),
    }] }),
  }
  const calcular = construir('_mapearDiasEstadoDesperdicio', { pool, _DESP_ESTADO_FRESCO_MS: 2 * 60 * 60 * 1000 })
  const resultado = await calcular([{ resource_id: '/disk/1', categoria: 'disco_orfao', marcado_orfao_em: 'data-invalida' }])

  assert.equal(resultado.get('/DISK/1').dias_estado_atual, 4)
})

test('duração unificada prioriza data da Azure e usa coleta como fallback', () => {
  const calcular = construir('_duracaoOciosaDesperdicio')

  assert.deepEqual(calcular(true, 12, 3), { dias_ocioso: 12, fonte_dias_ocioso: 'azure' })
  assert.deepEqual(calcular(false, 12, 3), { dias_ocioso: 3, fonte_dias_ocioso: 'coleta' })
  assert.deepEqual(calcular(false, 12, null), { dias_ocioso: null, fonte_dias_ocioso: null })
})

test('portal público exige 30 dias de ociosidade conhecida em qualquer categoria', () => {
  const cumprePiso = construir('_cumprePisoOrfaosPublico')

  assert.equal(cumprePiso({ dias_ocioso: 29 }, 30), false)
  assert.equal(cumprePiso({ dias_ocioso: 30 }, 30), true)
  assert.equal(cumprePiso({ dias_ocioso: null }, 30), false)
})

test('disco e snapshot usam a data real, sem exigir linha no histórico horário', async () => {
  const pool = { query: async () => ({ rows: [] }) }
  const calcular = construir('_mapearDiasEstadoDesperdicio', { pool, _DESP_ESTADO_FRESCO_MS: 2 * 60 * 60 * 1000 })
  const desde = new Date(Date.now() - 40 * 86400000 - 3600000).toISOString()
  const resultado = await calcular([{ resource_id: '/disk/1', categoria: 'disco_orfao', marcado_orfao_em: desde }])

  assert.equal(resultado.get('/DISK/1').dias_estado_atual, 40)
  assert.equal(resultado.get('/DISK/1').estado_desde, desde)
})

test('uma observação completa fecha estados ausentes e preserva o início dos estados presentes', async () => {
  const chamadas = []
  const pool = {
    connect: async () => ({
      query: async (sql, params = []) => { chamadas.push({ sql, params }); return { rows: [] } },
      release: () => {},
    }),
  }
  const registrar = construir('_registrarEstadosDesperdicio', {
    pool,
    _DESP_ESTADO_CATEGORIAS: new Set(['ip_solto', 'vm_parada']),
  })

  await registrar(['sub-1'], [
    { subscription_id: 'sub-1', resource_id: '/subscriptions/sub-1/vm/vm-1', categoria: 'vm_parada' },
  ])

  assert.equal(chamadas[0].sql, 'BEGIN')
  assert.match(chamadas[1].sql, /UPDATE azure_desperdicio_estado_historico/)
  assert.deepEqual(chamadas[1].params[2], ['/SUBSCRIPTIONS/SUB-1/VM/VM-1'])
  assert.match(chamadas[2].sql, /ON CONFLICT .* WHERE encerrado_em IS NULL/)
  assert.equal(chamadas[2].params[0], 'sub-1')
  assert.equal(chamadas[2].params[2], 'vm_parada')
  assert.equal(chamadas.at(-1).sql, 'COMMIT')
})

test('modo estrito propaga falha de SP para não tratar resultado parcial como recuperação', async () => {
  const inicio = SRC.indexOf('async function _resourceGraphQueryTodasSps(')
  const fim = SRC.indexOf('\nasync function _resourceGraphQuery(', inicio)
  assert.ok(inicio >= 0 && fim > inicio, 'função multi-SP não encontrada')
  const consultar = new Function('_getInventarioEscopos', '_resourceGraphQuery', 'console',
    `${SRC.slice(inicio, fim)}\nreturn _resourceGraphQueryTodasSps`)(
    async () => ({ escopos: [{
      spId: 7, spNome: 'SP de teste', subscriptionId: 'sub-1', getToken: async () => 'token',
    }] }),
    async () => { throw new Error('SP indisponível') },
    { warn: () => {} },
  )

  await assert.rejects(consultar('Resources | limit 1', ['sub-1'], { strict: true }), /SP indisponível/)
  assert.deepEqual(await consultar('Resources | limit 1', ['sub-1']), [])
})

test('a tabela de episódios é separada da detecção usada pela economia', () => {
  assert.match(SRC, /CREATE TABLE IF NOT EXISTS azure_desperdicio_estado_historico/)
  assert.match(SRC, /uq_desp_estado_ativo ON azure_desperdicio_estado_historico/)
  assert.match(SRC, /const diasOrfao = desde \? Math\.max/)
  const categorias = SRC.match(/const _DESP_ESTADO_CATEGORIAS = new Set\(\[([\s\S]*?)\]\)/)?.[1] || ''
  for (const categoria of ['disco_orfao', 'snapshot_antigo', 'nic_orfa', 'ip_solto', 'app_service_plan_vazio', 'lb_sem_backend', 'appgw_sem_backend', 'vm_parada']) {
    assert.ok(categorias.includes(`'${categoria}'`), `coletor horario não inclui ${categoria}`)
  }
})