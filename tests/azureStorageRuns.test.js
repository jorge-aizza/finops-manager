const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findStorageExportRuns,
  validateStorageExportRun,
  selectLatestStorageRun,
} = require('../azureStorageRuns');

const prefix = 'reports/actual-cost/20261101-20261130/';

function makeRun(id, submittedTime, { includePart = true, size = 100 } = {}) {
  const runPrefix = `${prefix}${id}/`;
  const manifestBlob = { name: `${runPrefix}manifest.json`, lastModified: submittedTime, size: 200 };
  const part = { name: `${runPrefix}part_0.csv`, size, lastModified: submittedTime };
  const manifest = {
    blobCount: 1,
    dataRowCount: 2,
    runInfo: { submittedTime },
    blobs: [{ blobName: part.name, byteCount: size, dataRowCount: 2 }],
  };
  return {
    blobs: includePart ? [manifestBlob, part] : [manifestBlob],
    run: { runId: id, runPrefix, manifestBlob },
    manifest,
  };
}

test('finds runs by manifest and validates all listed partitions and sizes', () => {
  const run = makeRun('run-a', '2026-11-19T04:00:00Z');
  const candidates = findStorageExportRuns(run.blobs, prefix);
  assert.equal(candidates.length, 1);
  const validated = validateStorageExportRun(candidates[0], run.manifest, run.blobs);
  assert.equal(validated.complete, true);
  assert.equal(validated.expectedRows, 2);
  assert.deepEqual(validated.dataBlobs.map(blob => blob.name), [`${prefix}run-a/part_0.csv`]);
});

test('marks a run incomplete when a manifest partition is missing', () => {
  const run = makeRun('run-a', '2026-11-19T04:00:00Z', { includePart: false });
  const candidate = validateStorageExportRun(run.run, run.manifest, run.blobs);
  assert.equal(candidate.complete, false);
  assert.match(candidate.error, /Partição ausente/);
});

test('rejects a partition whose listed size differs from Storage', () => {
  const run = makeRun('run-a', '2026-11-19T04:00:00Z');
  run.manifest.blobs[0].byteCount = 101;
  const candidate = validateStorageExportRun(run.run, run.manifest, run.blobs);
  assert.equal(candidate.complete, false);
  assert.match(candidate.error, /Tamanho divergente/);
});

test('selects the latest complete run and refuses a newer incomplete run', () => {
  const older = makeRun('run-a', '2026-11-19T04:00:00Z');
  const newer = makeRun('run-b', '2026-11-20T04:00:00Z', { includePart: false });
  const oldCandidate = validateStorageExportRun(older.run, older.manifest, older.blobs);
  const newCandidate = validateStorageExportRun(newer.run, newer.manifest, newer.blobs);
  assert.equal(selectLatestStorageRun([oldCandidate]).runId, 'run-a');
  assert.throws(() => selectLatestStorageRun([oldCandidate, newCandidate]), /execução mais recente.*incompleta/);
});

test('selects the newest complete snapshot regardless of listing order', () => {
  const older = makeRun('run-a', '2026-11-19T04:00:00Z');
  const newer = makeRun('run-b', '2026-11-20T04:00:00Z');
  const oldCandidate = validateStorageExportRun(older.run, older.manifest, older.blobs);
  const newCandidate = validateStorageExportRun(newer.run, newer.manifest, newer.blobs);
  assert.equal(selectLatestStorageRun([newCandidate, oldCandidate]).runId, 'run-b');
});

test('does not fall back when a newer GUID folder has no manifest yet', () => {
  const older = makeRun('run-a', '2026-11-19T04:00:00Z');
  const newerPrefix = `${prefix}run-b/`;
  const newerPart = { name: `${newerPrefix}part_0.csv`, size: 100, lastModified: '2026-11-20T04:00:00Z' };
  const blobs = [...older.blobs, newerPart];
  const candidates = findStorageExportRuns(blobs, prefix).map(run => {
    if (!run.manifestBlob) return validateStorageExportRun(run, null, blobs);
    return validateStorageExportRun(run, older.manifest, blobs);
  });
  assert.throws(() => selectLatestStorageRun(candidates), /execução mais recente.*incompleta/);
});