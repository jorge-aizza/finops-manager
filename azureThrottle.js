'use strict';
// Proteção das chamadas à Azure: circuit breaker POR FAMÍLIA de API, pausa compartilhada para
// HTTP 429 e limite de concorrência para laços por subscription.
//
// Por que existe: um único breaker global fazia o 429 (limite de ritmo) do Advisor abrir o
// bloqueio para tudo — coleta de custos, Inventário, reservas. E cada chamada concorrente que
// esgotava as tentativas de 429 contava como uma falha ("220 falhas consecutivas").
//
// Regras:
//  - 429 é limitação de ritmo, não queda: pausa a FAMÍLIA inteira pelo Retry-After (com jitter)
//    e as chamadas seguintes esperam essa pausa; nunca conta para o breaker.
//  - Só 5xx, timeout e erro de rede contam falha, e só na família da URL.
//  - Storage (blob) e identidade têm família própria: o problema de uma não bloqueia a outra.

const FAMILIAS = ['custo', 'resourcegraph', 'advisor', 'reservas', 'arm', 'graph', 'identidade', 'blob', 'loganalytics'];

function familiaDeUrl(url) {
  const u = String(url || '');
  let host = '';
  try { host = new URL(u).hostname.toLowerCase(); } catch (_) { /* URL relativa/inválida */ }
  if (host === 'login.microsoftonline.com') return 'identidade';
  if (host.endsWith('.blob.core.windows.net') || host.endsWith('.dfs.core.windows.net')) return 'blob';
  if (host === 'graph.microsoft.com') return 'graph';
  if (host === 'api.loganalytics.io') return 'loganalytics';
  const p = u.toLowerCase();
  if (p.includes('/providers/microsoft.resourcegraph/')) return 'resourcegraph';
  if (p.includes('/providers/microsoft.advisor/')) return 'advisor';
  if (p.includes('/providers/microsoft.capacity') || p.includes('/providers/microsoft.billingbenefits')) return 'reservas';
  if (p.includes('/providers/microsoft.costmanagement') || p.includes('/providers/microsoft.billing/')
      || p.includes('/providers/microsoft.consumption')) return 'custo';
  return 'arm';
}

// Executa fn(item, i) com no máximo `limite` em voo; preserva a ordem. Rejeita no 1º erro.
async function mapLimit(items, limite, fn) {
  const lista = Array.from(items);
  const out = new Array(lista.length);
  let proximo = 0;
  let falhou = false;
  async function worker() {
    while (!falhou) {
      const i = proximo++;
      if (i >= lista.length) return;
      try { out[i] = await fn(lista[i], i); } catch (e) { falhou = true; throw e; }
    }
  }
  const n = Math.max(1, Math.min(limite, lista.length));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

// Mesmo que Promise.allSettled, mas com limite de concorrência.
function mapLimitSettled(items, limite, fn) {
  return mapLimit(items, limite, async (x, i) => {
    try { return { status: 'fulfilled', value: await fn(x, i) }; }
    catch (e) { return { status: 'rejected', reason: e }; }
  });
}

class Breaker {
  constructor({ maxFailures, openMs, now, onLog }) {
    Object.assign(this, { maxFailures, openMs, now, onLog });
    this.state = 'CLOSED'; this.failures = 0; this.openUntil = null;
  }
  canAttempt() {
    if (this.state !== 'OPEN') return true;
    if (this.openUntil !== null && this.now() >= this.openUntil) {
      this.state = 'HALF_OPEN';
      this.onLog('Estado → HALF_OPEN (janela expirou, testando)');
      return true;
    }
    return false;
  }
  recordSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED'; this.failures = 0; this.openUntil = null;
      this.onLog('Estado → CLOSED (HALF_OPEN bem-sucedido)');
    } else if (this.state === 'CLOSED') {
      this.failures = 0;
    }
  }
  recordFailure() {
    if (this.state === 'HALF_OPEN') {
      this._abrir('HALF_OPEN falhou');
      return;
    }
    this.failures++;
    if (this.failures >= this.maxFailures) this._abrir(`${this.failures} falhas consecutivas`);
  }
  _abrir(motivo) {
    this.state = 'OPEN';
    this.openUntil = this.now() + this.openMs;
    this.onLog(`Estado → OPEN (${motivo}, bloqueando até ${new Date(this.openUntil).toISOString()})`);
  }
  reset() { this.state = 'CLOSED'; this.failures = 0; this.openUntil = null; }
  snapshot() {
    return {
      state: this.state, failures: this.failures,
      open_until: this.openUntil ? new Date(this.openUntil).toISOString() : null,
    };
  }
}

function createCbFetch({
  fetch: fetchImpl,
  log = () => {},
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
  random = Math.random,
  maxFailures = 3,
  openMs = 5 * 60 * 1000,
  maxPausaMs = 120_000,
} = {}) {
  const breakers = new Map();
  const gates = new Map(); // família -> timestamp até quando pausar

  const breaker = (fam) => {
    if (!breakers.has(fam)) {
      breakers.set(fam, new Breaker({ maxFailures, openMs, now, onLog: (m) => log(`[CB:${fam}] ${m}`) }));
    }
    return breakers.get(fam);
  };

  async function esperarGate(fam) {
    for (;;) {
      const ate = gates.get(fam) || 0;
      const falta = ate - now();
      if (falta <= 0) return;
      await sleep(falta);
    }
  }

  function pausar(fam, retryAfterSeg, tentativa) {
    const base = Number.isFinite(retryAfterSeg) ? retryAfterSeg * 1000 : 30_000;
    const exponencial = 2 ** tentativa * 1000;
    const jitter = random() * 1000 * (tentativa + 1);
    const ms = Math.min(maxPausaMs, Math.max(1000, base, exponencial) + jitter);
    const ate = now() + ms;
    const anterior = gates.get(fam) || 0;
    if (ate > anterior) {
      gates.set(fam, ate);
      if (ate > anterior + 1000) log(`[429] ${fam} — pausando ${Math.round(ms / 1000)}s (todas as chamadas dessa família aguardam)`);
    }
  }

  async function cbFetch(url, options = {}, { timeoutMs = 30000, maxRetries = 5, countCbFailure = true } = {}) {
    const fam = familiaDeUrl(url);
    const br = breaker(fam);
    if (!br.canAttempt()) {
      const ate = br.openUntil ? new Date(br.openUntil).toISOString() : '?';
      throw new Error(`Circuit Breaker OPEN — Azure API bloqueada até ${ate} (família: ${fam})`);
    }

    let tentativa = 0;
    for (;;) {
      await esperarGate(fam);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const resp = await fetchImpl(url, { ...options, signal: ctrl.signal });
        clearTimeout(timer);

        if (resp.status === 429) {
          const ra = parseInt(resp.headers && resp.headers.get ? resp.headers.get('Retry-After') : '', 10);
          if (tentativa >= maxRetries) {
            const e = new Error(`HTTP 429 esgotado após ${maxRetries} tentativas (${fam})`);
            e.status = 429;
            throw e;
          }
          pausar(fam, ra, tentativa);
          tentativa++;
          continue;
        }

        if (resp.status >= 500 && countCbFailure) br.recordFailure();
        else if (resp.status < 400) br.recordSuccess();
        return resp;
      } catch (err) {
        clearTimeout(timer);
        if (err.status === 429) throw err;
        if (countCbFailure) br.recordFailure();
        if (err.name === 'AbortError') throw new Error(`Timeout (${timeoutMs / 1000}s) na chamada Azure: ${String(url).split('?')[0]}`);
        throw err;
      }
    }
  }

  function estado() {
    const out = {};
    for (const f of FAMILIAS) out[f] = breaker(f).snapshot();
    return out;
  }

  // Resumo no formato antigo (um breaker só): a pior família vence.
  function resumo() {
    const todos = Object.entries(estado());
    const ordem = { OPEN: 2, HALF_OPEN: 1, CLOSED: 0 };
    todos.sort((a, b) => (ordem[b[1].state] - ordem[a[1].state]) || (b[1].failures - a[1].failures));
    const [familia, s] = todos[0];
    return { ...s, familia };
  }

  return {
    cbFetch,
    estado,
    resumo,
    recordFailure: (fam = 'custo') => breaker(fam).recordFailure(),
    reset: () => { for (const f of FAMILIAS) breaker(f).reset(); gates.clear(); },
  };
}

module.exports = { createCbFetch, familiaDeUrl, mapLimit, mapLimitSettled, FAMILIAS };
