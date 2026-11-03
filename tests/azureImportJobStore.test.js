'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAzureImportJobStore } = require('../azureImportJobStore');

test('persists job snapshots in order and loads the stored job and files', async () => {
  const rows = new Map();
  const pool = {
    async query(sql, values = []) {
      if (sql.includes('INSERT INTO azure_cost_import_state')) {
        rows.set(1, { job: JSON.parse(values[0]), source_files: JSON.parse(values[1]) });
        return { rowCount: 1, rows: [] };
      }
      return { rowCount: rows.has(1) ? 1 : 0, rows: rows.has(1) ? [rows.get(1)] : [] };
    },
  };
  const store = createAzureImportJobStore(() => pool);

  await Promise.all([
    store.save({ id: 'job-1', status: 'running', inseridos: 0 }, [{ path: '/tmp/a.csv', originalname: 'a.csv' }]),
    store.save({ id: 'job-1', status: 'running', inseridos: 4 }, [{ path: '/tmp/a.csv', originalname: 'a.csv' }]),
  ]);

  assert.deepEqual(await store.load(), {
    job: { id: 'job-1', status: 'running', inseridos: 4 },
    source_files: [{ path: '/tmp/a.csv', originalname: 'a.csv' }],
  });
});

test('rejects persistence when the database pool is unavailable', async () => {
  const store = createAzureImportJobStore(() => null);
  await assert.rejects(store.save({ id: 'job-1' }, []), /Banco não configurado/);
});