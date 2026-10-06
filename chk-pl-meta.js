const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
(async () => {
  const meta = await pool.query(`SELECT key, value, updated_at FROM azure_price_list_meta ORDER BY updated_at DESC`);
  console.log('azure_price_list_meta:');
  meta.rows.forEach(r => console.log(' -', r.key, '@', r.updated_at, '=>', r.value));
  const total = await pool.query(`SELECT COUNT(*) FROM azure_price_list`);
  console.log('Total linhas azure_price_list:', total.rows[0].count);
  await pool.end();
})().catch(e => { console.error('ERRO AO CONECTAR:', e.message); process.exit(1); });
