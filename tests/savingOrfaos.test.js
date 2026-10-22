'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { diasOrfaoNaExclusao } = require('../savingOrfaos');

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