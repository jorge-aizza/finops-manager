'use strict';
// Unifica linhas duplicadas de azure_recursos_inventario que diferem só na caixa das letras
// do resource_id e passa a garantir unicidade case-insensitive.
//
// Causa: o Change Analysis entrega o targetResourceId com grafia diferente entre eventos
// Create/Update e Delete do MESMO recurso. O índice único era case-sensitive, então o Delete
// virava uma linha nova (inativa) e a linha original ficava ativa para sempre ("zumbi").
//
// Idempotente: o índice idx_azure_recursos_inv_uniq_lower é o marcador — se existe, não faz nada.
// Tudo (backup, merge, índice) roda numa única transação; falha => rollback completo.

const MARCADOR = 'idx_azure_recursos_inv_uniq_lower';
const BACKUP = 'azure_recursos_inventario_bkp_20260923';

async function precisaMigrar(pool) {
  const r = await pool.query(`SELECT 1 FROM pg_indexes WHERE indexname = $1`, [MARCADOR]);
  return r.rowCount === 0;
}

async function run(pool, log = console.log, { dryRun = false } = {}) {
  if (!(await precisaMigrar(pool))) return { migrado: false };

  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL statement_timeout = 0');

    const antes = (await c.query(
      `SELECT COUNT(*)::int AS linhas, COUNT(*) FILTER (WHERE ativo)::int AS ativos FROM azure_recursos_inventario`
    )).rows[0];

    await c.query(`CREATE TABLE IF NOT EXISTS ${BACKUP} AS SELECT * FROM azure_recursos_inventario`);

    await c.query(`
      CREATE TEMP TABLE _inv_linhas ON COMMIT DROP AS
      SELECT i.*, LOWER(i.resource_id) AS rid
      FROM azure_recursos_inventario i
      JOIN (
        SELECT subscription_id, LOWER(resource_id) AS rid
        FROM azure_recursos_inventario
        GROUP BY 1, 2 HAVING COUNT(*) > 1
      ) g ON g.subscription_id = i.subscription_id AND g.rid = LOWER(i.resource_id)
    `);

    // Regra de estado: compara o último sinal de "vivo" (criação/atualização, ou visto pelo
    // Resource Graph) com a última exclusão. Sem exclusão conhecida, vale o ativo existente.
    await c.query(`
      CREATE TEMP TABLE _inv_merge ON COMMIT DROP AS
      SELECT
        MIN(id) AS id,
        subscription_id,
        (ARRAY_AGG(resource_id    ORDER BY (criado_em IS NULL), criado_em, id))[1] AS resource_id,
        (ARRAY_AGG(resource_type  ORDER BY (resource_type IS NULL),  (criado_em IS NULL), id))[1] AS resource_type,
        (ARRAY_AGG(resource_group ORDER BY (resource_group IS NULL), (criado_em IS NULL), id))[1] AS resource_group,
        (ARRAY_AGG(nome           ORDER BY (nome IS NULL),           (criado_em IS NULL), id))[1] AS nome,
        (ARRAY_AGG(criado_por     ORDER BY (criado_em IS NULL), criado_em, id))[1] AS criado_por,
        MIN(criado_em) AS criado_em,
        (ARRAY_AGG(atualizado_por ORDER BY (atualizado_em IS NULL), atualizado_em DESC, id))[1] AS atualizado_por,
        MAX(atualizado_em) AS atualizado_em,
        (ARRAY_AGG(excluido_por   ORDER BY (excluido_em IS NULL), excluido_em DESC, id))[1] AS excluido_por,
        MAX(excluido_em) AS excluido_em,
        CASE
          WHEN MAX(excluido_em) IS NULL THEN BOOL_OR(ativo)
          WHEN GREATEST(
                 MAX(GREATEST(criado_em, atualizado_em)),
                 MAX(CASE WHEN origem_deteccao = 'resource_graph' AND ativo THEN detectado_em::timestamptz END)
               ) IS NULL THEN false
          ELSE GREATEST(
                 MAX(GREATEST(criado_em, atualizado_em)),
                 MAX(CASE WHEN origem_deteccao = 'resource_graph' AND ativo THEN detectado_em::timestamptz END)
               ) > MAX(excluido_em)
        END AS ativo,
        MIN(detectado_em) AS detectado_em,
        CASE WHEN BOOL_OR(origem_deteccao = 'activity_log') THEN 'activity_log' ELSE 'resource_graph' END AS origem_deteccao
      FROM _inv_linhas
      GROUP BY subscription_id, rid
    `);

    const grupos = (await c.query(`SELECT COUNT(*)::int AS n FROM _inv_merge`)).rows[0].n;
    const linhasDup = (await c.query(`SELECT COUNT(*)::int AS n FROM _inv_linhas`)).rows[0].n;

    await c.query(`DELETE FROM azure_recursos_inventario WHERE id IN (SELECT id FROM _inv_linhas)`);
    await c.query(`
      INSERT INTO azure_recursos_inventario
        (id, subscription_id, resource_id, resource_type, resource_group, nome, criado_por, criado_em,
         atualizado_por, atualizado_em, excluido_por, excluido_em, ativo, detectado_em, origem_deteccao)
      SELECT id, subscription_id, resource_id, resource_type, resource_group, nome, criado_por, criado_em,
             atualizado_por, atualizado_em, excluido_por, excluido_em, ativo, detectado_em, origem_deteccao
      FROM _inv_merge
    `);

    await c.query(`CREATE UNIQUE INDEX ${MARCADOR} ON azure_recursos_inventario (subscription_id, LOWER(resource_id))`);

    const depois = (await c.query(
      `SELECT COUNT(*)::int AS linhas, COUNT(*) FILTER (WHERE ativo)::int AS ativos FROM azure_recursos_inventario`
    )).rows[0];

    // Consistência: cada grupo de duplicatas vira exatamente 1 linha; o resto não muda.
    const esperado = antes.linhas - linhasDup + grupos;
    if (depois.linhas !== esperado) {
      throw new Error(`Inconsistência na unificação: esperava ${esperado} linhas, ficaram ${depois.linhas} — revertido`);
    }

    if (dryRun) {
      await c.query('ROLLBACK');
      return { migrado: false, dryRun: true, grupos_unificados: grupos, antes, depois };
    }
    await c.query('COMMIT');
    const stats = { migrado: true, grupos_unificados: grupos, antes, depois, backup: BACKUP };
    log(`[Inventário] resource_id unificado (case-insensitive): ${JSON.stringify(stats)}`);

    // Fora da transação: índice para buscas case-insensitive na auditoria (tabela grande).
    const c2 = await pool.connect();
    try {
      await c2.query('SET statement_timeout = 0');
      await c2.query(`CREATE INDEX IF NOT EXISTS idx_azure_recursos_aud_resource_lower ON azure_recursos_auditoria_eventos (LOWER(resource_id))`);
    } catch (e) {
      log('[Inventário] Índice LOWER(resource_id) na auditoria não criado: ' + e.message);
    } finally {
      await c2.query('RESET statement_timeout').catch(() => {});
      c2.release();
    }
    return stats;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

module.exports = { run, precisaMigrar };
