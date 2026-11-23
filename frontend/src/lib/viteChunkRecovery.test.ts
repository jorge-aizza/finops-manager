import { describe, expect, it, vi } from 'vitest'
import { createViteChunkRecoveryHandler } from './viteChunkRecovery'

function makeStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('vite chunk recovery', () => {
  it('prevents a stale dynamic import error and reloads once', () => {
    const storage = makeStorage()
    const reload = vi.fn()
    const handler = createViteChunkRecoveryHandler(storage, reload, () => 100_000)
    const event = new Event('vite:preloadError', { cancelable: true })

    handler(event)

    expect(event.defaultPrevented).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not reload repeatedly in the cooldown window', () => {
    const storage = makeStorage()
    const reload = vi.fn()
    createViteChunkRecoveryHandler(storage, reload, () => 100_000)(new Event('vite:preloadError', { cancelable: true }))
    createViteChunkRecoveryHandler(storage, reload, () => 110_000)(new Event('vite:preloadError', { cancelable: true }))

    expect(reload).toHaveBeenCalledOnce()
  })
})