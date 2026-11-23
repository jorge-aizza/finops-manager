'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { diasOrfaoNaExclusao, filtrarOrfaosPublicos } = require('../savingOrfaos');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('usa a data real de órfão do portal, mesmo quando anterior à primeira detecção', () => {
  assert.equal(diasOrfaoNaExclusao({
    desde_orfao_em: '2026-01-01T00:00:00Z',
    primeira_deteccao_em: '2026-01-30T00:00:00Z',
    excluido_em: '2026-02-01T00:00:00Z',
  }), 31);
});


test('usa a primeira detecção como fallback quando a data real não existe', () => {
  assert.equal(diasOrfaoNaExclusao({
    desde_orfao_em: null,
    primeira_deteccao_em: '2026-01-30T00:00:00Z',
    excluido_em: '2026-02-01T00:00:00Z',
  }), 2);
});

test('retorna null quando não há data ou o valor não é válido', () => {
  assert.equal(diasOrfaoNaExclusao({ excluido_em: '2026-02-01T00:00:00Z' }), null);
  assert.equal(diasOrfaoNaExclusao({
    desde_orfao_em: 'data inválida',
    excluido_em: '2026-02-01T00:00:00Z',
  }), null);
});

test('filtro público de órfãos aplica allowlist de assinatura, tipo, RG e validação', () => {
  const itens = [
    { resource_id: '/a', subscription_id: 'sub-a', categoria: 'disco_orfao', resource_group: 'RG-A' },
    { resource_id: '/b', subscription_id: 'sub-a', categoria: 'snapshot_antigo', resource_group: 'RG-A' },
    { resource_id: '/c', subscription_id: 'sub-b', categoria: 'disco_orfao', resource_group: 'RG-A' },
    { resource_id: '/d', subscription_id: 'sub-a', categoria: 'disco_orfao', resource_group: 'RG-B' },
    { resource_id: '/e', subscription_id: 'sub-a', categoria: 'disco_orfao', resource_group: 'RG-A', motivo_validacao: 'PVC/ASR' },
    { resource_id: '/f', subscription_id: 'sub-a', categoria: 'nic_orfa', resource_group: 'RG-A' },
  ];

  const resultado = filtrarOrfaosPublicos(itens, {
    subscriptionIds: ['SUB-A'], categories: ['disco_orfao'], resourceGroups: ['rg-a'],
  }, new Set(['nic_orfa']));

  assert.deepEqual(resultado.map((item) => item.resource_id), ['/a']);
});

test('separa saving bruto de discos, snapshots excluídos e custos de retenção', async () => {
  const functionStart = serverSource.indexOf('async function _resumoSavingOrfaos');
  const functionEnd = serverSource.indexOf('\n// Snapshots vivos cuja origem', functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart, 'função _resumoSavingOrfaos localizada');

  const agora = Date.now();
  const diasAtras = (dias) => new Date(agora - dias * 86400000).toISOString();
  const rows = [
    {
      tipo: 'economia', categoria: 'disco_orfao', resource_id_upper: '/DISCO-1', nome: 'disco-1',
      custo_mensal: 600, excluido_em: diasAtras(60), desde_orfao_em: diasAtras(105), recriado: false,
    },
    {
      tipo: 'desconto', categoria: 'snapshot_antigo', resource_id_upper: '/SNAP-1', nome: 'snap-1',
      custo_mensal: 80, criado_em: diasAtras(60), excluido_em: diasAtras(30), recriado: false,
    },
    {
      tipo: 'economia', categoria: 'snapshot_antigo', resource_id_upper: '/SNAP-2', nome: 'snap-2',
      custo_mensal: 40, criado_em: diasAtras(60), excluido_em: diasAtras(30), desde_orfao_em: diasAtras(75), recriado: false,
    },
    {
      tipo: 'economia', categoria: 'ip_solto', resource_id_upper: '/IP-1', nome: 'ip-1',
      custo_mensal: 50, excluido_em: diasAtras(60), desde_orfao_em: diasAtras(105), recriado: false,
    },
  ];
  const resumo = new Function(
    'pool', 'diasOrfaoNaExclusao', '_DESP_CATEGORIAS_SEM_CUSTO', '_classificarDiscoValidacao',
    '_SAVING_DIAS_MIN_ORFAO', '_MS_MES',
    `${serverSource.slice(functionStart, functionEnd)}; return _resumoSavingOrfaos`
  )(
    { query: async () => ({ rows }) },
    () => 45,
    new Set(['nic_orfa']),
    () => null,
    30,
    30 * 86400000
  );

  const result = await resumo([ ], [{ custo_mensal_estimado: 20, criado_em: diasAtras(30) }]);
  const assertClose = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.01, `${actual} deve ser próximo de ${expected}`);

  assert.equal(result.saving_disco_mensal, 600);
  assertClose(result.saving_disco_acumulado, 1200);
  assert.equal(result.saving_snapshots_mensal, 120);
  assertClose(result.saving_snapshots_acumulado, 120);
  assert.equal(result.saving_outros_mensal, 50);
  assertClose(result.saving_outros_acumulado, 100);
  assert.equal(result.desconto_mensal_snapshots, 20);
  assertClose(result.custo_acumulado_snapshots, 100);
  assert.equal(result.economia_mensal, 670);
  assertClose(result.economia_acumulada, 1240);
});

test('a coleta horária apura saving apenas quando todas as assinaturas foram coletadas', async () => {
  const functionStart = serverSource.indexOf('async function _coletarEstadosDesperdicio()');
  const functionEnd = serverSource.indexOf('\nfunction _iniciarDesperdicioEstadosAgendador', functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart, 'função de coleta horária localizada');

  const makeCollector = ({ coletas, apurar }) => {
    const values = {
      _desperdicioEstadoEmExecucao: false,
      pool: {},
      ensureAzureColetaTable: async () => {},
      _getInventarioEscopos: async () => ({ escopos: [
        { spId: 1, spNome: 'SP A', subscriptionId: 'sub-a' },
        { spId: 1, spNome: 'SP A', subscriptionId: 'sub-b' },
      ] }),
      _coletarDesperdicio: coletas,
      _registrarEstadosDesperdicio: async () => {},
      _apurarSavingOrfaos: apurar,
      console: { log() {}, warn() {} },
    };
    return new Function(...Object.keys(values), `${serverSource.slice(functionStart, functionEnd)}; return _coletarEstadosDesperdicio`)(...Object.values(values));
  };

  let apurado;
  await makeCollector({
    coletas: async (subs) => subs.map((subscriptionId) => ({ resource_id: '/' + subscriptionId })),
    apurar: async (ids) => { apurado = ids; return 0; },
  })();
  assert.deepEqual(apurado, ['/sub-a', '/sub-b']);

  let chamadas = 0;
  let apuradoEmColetaParcial = false;
  await makeCollector({
    coletas: async (subs) => {
      chamadas++;
      if (subs.length > 1 || subs[0] === 'sub-b') throw new Error('sem permissão');
      return [{ resource_id: '/sub-a' }];
    },
    apurar: async () => { apuradoEmColetaParcial = true; return 0; },
  })();
  assert.equal(chamadas, 3);
  assert.equal(apuradoEmColetaParcial, false);
});