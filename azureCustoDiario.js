const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/

function mesDaDataCusto(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`
  }
  if (typeof value !== 'string') return null
  const mes = value.slice(0, 7)
  return MES_RE.test(mes) ? mes : null
}

function registrarMesCustoImportado(meses, value) {
  const mes = mesDaDataCusto(value)
  if (!mes) return false
  meses.add(mes)
  return true
}

async function reconstruirMesCustoDiario(client, mes) {
  if (!MES_RE.test(mes)) throw new Error(`Mês inválido para rollup de custo: ${mes}`)

  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`azure_custo_diario:${mes}`])
  const inicio = `${mes}-01`
  await client.query(
    `DELETE FROM azure_custo_diario
     WHERE cost_date >= $1::date AND cost_date < ($1::date + INTERVAL '1 month')`,
    [inicio]
  )
  const result = await client.query(
    `INSERT INTO azure_custo_diario (cost_date, subscription_id, custo_microsoft, custo_marketplace, primeiro_import, ultimo_import)
     SELECT cost_date, subscription_id::text,
            COALESCE(SUM(cost_in_billing_currency) FILTER (WHERE publisher_type IS DISTINCT FROM 'Marketplace'),0),
            COALESCE(SUM(cost_in_billing_currency) FILTER (WHERE publisher_type = 'Marketplace'),0),
            MIN(importado_em), MAX(importado_em)
     FROM azure_costs
     WHERE cost_date >= $1::date AND cost_date < ($1::date + INTERVAL '1 month')
       AND subscription_id IS NOT NULL
     GROUP BY 1, 2`,
    [inicio]
  )
  return result.rowCount
}

async function reconstruirMesesCustoDiario(pool, meses) {
  const unicos = [...new Set(meses)].filter((mes) => MES_RE.test(mes)).sort()
  const reconstruidos = []

  for (const mes of unicos) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const linhas = await reconstruirMesCustoDiario(client, mes)
      await client.query('COMMIT')
      reconstruidos.push({ mes, linhas })
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }

  return reconstruidos
}

module.exports = {
  mesDaDataCusto,
  registrarMesCustoImportado,
  reconstruirMesCustoDiario,
  reconstruirMesesCustoDiario,
}