const AUX_MIN_DIAS = 1;
const AUX_MAX_DIAS = 30;

function normalizarIntervaloAuxiliar(value, fallback = AUX_MIN_DIAS) {
  const parsed = Number.parseInt(value, 10);
  const days = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(AUX_MIN_DIAS, Math.min(AUX_MAX_DIAS, days));
}

function auxiliaresVencidas(proximaColeta, now = Date.now()) {
  if (!proximaColeta) return true;
  const due = new Date(proximaColeta).getTime();
  return !Number.isFinite(due) || due <= now;
}

function proximaColetaAuxiliar(now = new Date(), intervalDays = AUX_MIN_DIAS) {
  const next = new Date(now);
  next.setDate(next.getDate() + normalizarIntervaloAuxiliar(intervalDays));
  return next;
}

function createSerialColetaQueue() {
  let tail = Promise.resolve();
  const jobs = new Map();

  return {
    enqueue(key, run) {
      const id = String(key);
      if (jobs.has(id)) return { accepted: false, promise: jobs.get(id) };
      const promise = tail.then(run);
      jobs.set(id, promise);
      tail = promise.catch(() => {});
      const remover = () => {
        if (jobs.get(id) === promise) jobs.delete(id);
      };
      promise.then(remover, remover);
      return { accepted: true, promise };
    },
    has(key) {
      return jobs.has(String(key));
    },
    pendingKeys() {
      return [...jobs.keys()];
    },
    get size() {
      return jobs.size;
    },
  };
}

module.exports = { auxiliaresVencidas, normalizarIntervaloAuxiliar, proximaColetaAuxiliar, createSerialColetaQueue };