const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST, port: process.env.DB_PORT,
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
});
(async () => {
  const total = await pool.query(`SELECT COUNT(*) FROM azure_price_list`);
  console.log('Total linhas em azure_price_list:', total.rows[0].count);
  const fams = await pool.query(`SELECT service_family, COUNT(*) FROM azure_price_list WHERE type='Consumption' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`);
  console.log('Service families:', fams.rows);
  const vms = await pool.query(`SELECT DISTINCT sku_name FROM azure_price_list WHERE service_family='Compute' AND type='Consumption' LIMIT 20`);
  console.log('Exemplo SKUs Compute:', vms.rows.map(r => r.sku_name));
  const disks = await pool.query(`SELECT DISTINCT product_name, sku_name FROM azure_price_list WHERE product_name ILIKE '%disk%' AND type='Consumption' LIMIT 20`);
  console.log('Exemplo discos:', disks.rows);
  await pool.end();
})().catch(e => { console.error(e); process.exit(1); });
