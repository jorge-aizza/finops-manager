const DATA_FILE_PATTERN = /\.(csv|parquet|zip)$/i;
const MANIFEST_PATTERN = /(?:^|\/)_?manifest\.json$/i;

function normalizeBlobName(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\/+/, '');
}

function findStorageExportRuns(blobs, prefix = '') {
  const normalizedPrefix = normalizeBlobName(prefix);
  const grouped = new Map();
  for (const rawBlob of blobs) {
    const blob = { ...rawBlob, name: normalizeBlobName(rawBlob.name) };
    if (!blob.name.startsWith(normalizedPrefix)) continue;
    const relative = blob.name.slice(normalizedPrefix.length);
    const slash = relative.indexOf('/');
    if (slash < 1) continue;
    const runPrefix = `${normalizedPrefix}${relative.slice(0, slash + 1)}`;
    const run = grouped.get(runPrefix) || {
      runId: relative.slice(0, slash),
      runPrefix,
      manifestBlob: null,
      lastModified: null,
    };
    if (MANIFEST_PATTERN.test(blob.name)) run.manifestBlob = blob;
    if (!run.lastModified || Date.parse(blob.lastModified || '') > Date.parse(run.lastModified || '')) {
      run.lastModified = blob.lastModified;
    }
    grouped.set(runPrefix, run);
  }
  return [...grouped.values()];
}

function validateStorageExportRun(run, manifest, blobs) {
  const submittedAt = Date.parse(manifest?.runInfo?.submittedTime || '') || Date.parse(run.manifestBlob?.lastModified || run.lastModified || '') || 0;
  const listed = new Map(blobs.map(blob => [normalizeBlobName(blob.name), blob]));
  const entries = Array.isArray(manifest?.blobs) ? manifest.blobs : null;
  const declaredCount = Number(manifest?.blobCount);

  if (!entries || entries.length === 0) {
    return { ...run, submittedAt, complete: false, error: 'Manifesto não lista partições de dados.' };
  }
  if (Number.isFinite(declaredCount) && declaredCount !== entries.length) {
    return { ...run, submittedAt, complete: false, error: 'A contagem de partições não confere com o manifesto.' };
  }

  const seen = new Set();
  const dataBlobs = [];
  for (const entry of entries) {
    const name = normalizeBlobName(entry?.blobName);
    if (!name || !name.startsWith(run.runPrefix) || !DATA_FILE_PATTERN.test(name) || seen.has(name)) {
      return { ...run, submittedAt, complete: false, error: 'Manifesto contém um caminho de partição inválido.' };
    }
    seen.add(name);
    const blob = listed.get(name);
    if (!blob) return { ...run, submittedAt, complete: false, error: `Partição ausente: ${name.split('/').pop()}` };
    const expectedSize = Number(entry.byteCount);
    if (Number.isFinite(expectedSize) && expectedSize > 0 && expectedSize !== Number(blob.size)) {
      return { ...run, submittedAt, complete: false, error: `Tamanho divergente: ${name.split('/').pop()}` };
    }
    dataBlobs.push(blob);
  }

  const expectedRows = Number(manifest.dataRowCount);
  if (manifest.dataRowCount == null || !Number.isSafeInteger(expectedRows) || expectedRows < 0) {
    return { ...run, submittedAt, complete: false, error: 'Manifesto sem dataRowCount válido.' };
  }
  return { ...run, submittedAt, complete: true, expectedRows, dataBlobs };
}

function selectLatestStorageRun(runs) {
  if (!runs.length) throw new Error('Nenhuma execução com manifest.json foi encontrada no prefixo.');
  const latest = [...runs].sort((a, b) =>
    b.submittedAt - a.submittedAt ||
    (Date.parse(b.lastModified || '') || 0) - (Date.parse(a.lastModified || '') || 0) ||
    b.runId.localeCompare(a.runId)
  )[0];
  if (!latest.complete) {
    throw new Error(`A execução mais recente (${latest.runId}) está incompleta: ${latest.error}`);
  }
  return latest;
}

module.exports = { findStorageExportRuns, validateStorageExportRun, selectLatestStorageRun };