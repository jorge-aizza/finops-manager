const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveStoragePrefix } = require('../azureStoragePrefix');

test('expands the current monthly export folder without changing its parent path', () => {
  const now = new Date(2026, 10, 19, 12);
  assert.equal(
    resolveStoragePrefix('reports/ReportTI-actual-cost/{periodo}/', now),
    'reports/ReportTI-actual-cost/20261101-20261130/',
  );
});

test('rolls into the next month and handles leap February', () => {
  assert.equal(resolveStoragePrefix('exports/{periodo}', new Date(2026, 11, 1, 12)), 'exports/20261201-20261231');
  assert.equal(resolveStoragePrefix('exports/{periodo}', new Date(2028, 1, 15, 12)), 'exports/20280201-20280229');
});

test('leaves static prefixes unchanged', () => {
  assert.equal(resolveStoragePrefix('reports/current-month/', new Date(2026, 10, 19)), 'reports/current-month/');
});

test('resolves a historical month for a manual reprocess', () => {
  assert.equal(
    resolveStoragePrefix('reports/ReportTI-actual-cost/{periodo}/', new Date(2026, 10, 19), '2025-02'),
    'reports/ReportTI-actual-cost/20250201-20250228/',
  );
});