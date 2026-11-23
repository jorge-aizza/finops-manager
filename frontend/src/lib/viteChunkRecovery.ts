const RELOAD_KEY = 'finops-vite-chunk-reload-at'
const RELOAD_COOLDOWN_MS = 60_000

export function createViteChunkRecoveryHandler(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  reload: () => void,
  now: () => number = Date.now,
) {
  return (event: Event) => {
    event.preventDefault()
    let previous = 0
    try { previous = Number(storage.getItem(RELOAD_KEY)) || 0 } catch { /* storage pode estar indisponível */ }
    if (previous && now() - previous < RELOAD_COOLDOWN_MS) return
    try { storage.setItem(RELOAD_KEY, String(now())) } catch { /* recarrega mesmo sem storage */ }
    reload()
  }
}

export function installViteChunkRecovery() {
  window.addEventListener('vite:preloadError', createViteChunkRecoveryHandler(
    window.sessionStorage,
    () => window.location.reload(),
  ))
}