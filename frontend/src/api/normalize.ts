// Colunas NUMERIC/INTEGER do Postgres voltam como STRING via node-postgres
// (pg) — nunca assumir que um campo "numérico" da API já é um `number` em
// JS. Sem isso, `valor.toLocaleString(...)` chama o método de String (que
// ignora o locale e devolve o texto cru) e `soma += valor` vira concatenação
// de string em vez de soma. Normaliza logo após o fetch, na borda da API,
// pra manter os tipos em TS honestos daqui pra frente.
export function numFields<T extends object>(row: T, fields: (keyof T)[]): T {
  const out = { ...row } as Record<keyof T, unknown>
  for (const f of fields) {
    const v = out[f]
    if (v !== null && v !== undefined && v !== '') {
      out[f] = Number(v as string)
    }
  }
  return out as T
}
