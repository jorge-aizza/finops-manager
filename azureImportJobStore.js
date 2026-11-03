'use strict';

const UPSERT_SQL = `
  INSERT INTO azure_cost_import_state (id, job, source_files, atualizado_em)
  VALUES (1, $1::jsonb, $2::jsonb, NOW())
  ON CONFLICT (id) DO UPDATE SET
    job = EXCLUDED.job,
    source_files = EXCLUDED.source_files,
    atualizado_em = NOW()
`;

function createAzureImportJobStore(getPool) {
  let writeQueue = Promise.resolve();

  function save(job, sourceFiles) {
    const jobJson = JSON.stringify(job);
    const filesJson = JSON.stringify(sourceFiles || []);
    writeQueue = writeQueue.catch(() => {}).then(async () => {
      const pool = getPool();
      if (!pool) throw new Error('Banco não configurado para persistir importação.');
      await pool.query(UPSERT_SQL, [jobJson, filesJson]);
    });
    return writeQueue;
  }

  async function load() {
    const pool = getPool();
    if (!pool) return null;
    const result = await pool.query('SELECT job, source_files FROM azure_cost_import_state WHERE id = 1');
    return result.rows[0] || null;
  }

  return { save, load };
}

module.exports = { createAzureImportJobStore };