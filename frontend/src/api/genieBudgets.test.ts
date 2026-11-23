import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch } from './client'
import { resolveGenieUserPrincipals } from './genieBudgets'

vi.mock('./client', () => ({ apiFetch: vi.fn() }))

describe('resolveGenieUserPrincipals', () => {
  beforeEach(() => vi.clearAllMocks())

  it('envia listas grandes no corpo POST em vez de exceder o tamanho da URL', async () => {
    const usernames = Array.from({ length: 398 }, (_, index) => `usuario-${index}@example.com`)
    vi.mocked(apiFetch).mockResolvedValue([])

    await resolveGenieUserPrincipals(usernames)

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledWith('POST', '/databricks-coleta/genie-user-principals', { usernames })
  })
})