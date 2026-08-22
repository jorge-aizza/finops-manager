import '@testing-library/jest-dom/vitest'

// @tanstack/react-virtual (usado em RecursosTable) precisa de ResizeObserver
// e getBoundingClientRect — jsdom não implementa nenhum dos dois.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub

// IntersectionObserver (infinite scroll do overlay Configurar Estimativa)
// também não existe em jsdom.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error — stub mínimo só pra satisfazer o IntersectionObserver em testes
globalThis.IntersectionObserver = IntersectionObserverStub

// jsdom não faz layout de verdade — getBoundingClientRect()/offsetHeight
// sempre voltam 0, então @tanstack/react-virtual (RecursosTable) acha que a
// área visível tem altura zero e não renderiza nenhum item. Dá uma altura
// grande o bastante pra qualquer lista de teste caber inteira.
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 800 })
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 1000 })
Element.prototype.getBoundingClientRect = () => ({
  width: 1000, height: 800, top: 0, left: 0, right: 1000, bottom: 800, x: 0, y: 0, toJSON() {},
})

// jsdom's built-in `localStorage` colide com o global do Node 20+ e vira um
// stub sem métodos ("localStorage.getItem is not a function") — troca por um
// polyfill in-memory simples só pros testes.
class LocalStorageStub {
  private store = new Map<string, string>()
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null }
  setItem(key: string, value: string) { this.store.set(key, String(value)) }
  removeItem(key: string) { this.store.delete(key) }
  clear() { this.store.clear() }
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new LocalStorageStub() })
