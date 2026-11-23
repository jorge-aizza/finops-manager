function yyyymmdd(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function resolveStoragePrefix(prefix, now = new Date(), monthOverride = null) {
  const value = String(prefix || '');
  if (!value.includes('{periodo}')) return value;
  const match = String(monthOverride || '').match(/^(\d{4})-(\d{2})$/);
  const reference = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, 1)
    : now;
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
  return value.replaceAll('{periodo}', `${yyyymmdd(start)}-${yyyymmdd(end)}`);
}

module.exports = { resolveStoragePrefix };