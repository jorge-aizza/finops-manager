const TTL_PADRAO_MS = 60 * 60 * 1000

function createGenieCotasCache({ getPool, collect, ttlMs = TTL_PADRAO_MS, now = Date.now, onRefreshError = () => {} }) {
  const inFlight = new Map()

  async function refresh(periodo) {
    if (inFlight.has(periodo)) return inFlight.get(periodo)

    const pending = (async () => {
      const payload = await collect(periodo)
      const result = await getPool().query(`
        INSERT INTO databricks_genie_cotas_cache (periodo, payload, coletado_em)
        VALUES ($1, $2, NOW())
        ON CONFLICT (periodo) DO UPDATE
          SET payload = EXCLUDED.payload, coletado_em = NOW()
        RETURNING payload, coletado_em
      `, [periodo, payload])
      return { payload: result.rows[0].payload, atualizado_em: result.rows[0].coletado_em }
    })()

    inFlight.set(periodo, pending)
    try {
      return await pending
    } finally {
      if (inFlight.get(periodo) === pending) inFlight.delete(periodo)
    }
  }

  async function get(periodo) {
    const result = await getPool().query(
      'SELECT payload, coletado_em FROM databricks_genie_cotas_cache WHERE periodo = $1',
      [periodo],
    )
    const row = result.rows[0]
    if (!row) {
      const snapshot = await refresh(periodo)
      return { ...snapshot, desatualizado: false, atualizando: false }
    }

    const ttl = typeof ttlMs === 'function' ? ttlMs(periodo) : ttlMs
    const desatualizado = now() - new Date(row.coletado_em).getTime() >= ttl
    if (desatualizado && !inFlight.has(periodo)) {
      refresh(periodo).catch(onRefreshError)
    }

    return {
      payload: row.payload,
      atualizado_em: row.coletado_em,
      desatualizado,
      atualizando: inFlight.has(periodo),
    }
  }

  return { get, refresh }
}

module.exports = { createGenieCotasCache }