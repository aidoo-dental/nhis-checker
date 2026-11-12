import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {verifyPayload} from '../scripts/verify-windows-payload.mjs';

const bytes = Buffer.from('synthetic archive');
const approval = {runId: 12, artifactId: 21, commit: 'a'.repeat(40),
  version: '1.2.3', digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex')};
const repository = {full_name: 'aidoo-dental/nhis-checker'};
const run = {id: 12, repository, head_repository: repository, head_sha: approval.commit,
  head_branch: 'main', path: '.github/workflows/windows.yml', event: 'push', conclusion: 'success'};
const artifact = {id: 21, name: 'NHIS-Checker-Windows-signing-payload', expired: false,
  size_in_bytes: bytes.length, digest: approval.digest, workflow_run: {id: 12, head_sha: approval.commit}};

function githubFixture({runData = run, artifactData = artifact, archive = bytes} = {}) {
  return async (url, options) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/runs/12')) return Response.json(runData);
    if (path.endsWith('/artifacts/21')) return Response.json(artifactData);
    if (path.endsWith('/artifacts/21/zip'))
      return Response.redirect('https://productionresultssa0.blob.core.windows.net/build/archive');
    assert.equal(path, '/build/archive');
    assert.equal(options.headers.Authorization, undefined);
    return new Response(archive);
  };
}

test('only the approved run and matching immutable archive are accepted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nhis-signing-test-'));
  const output = join(dir, 'artifact.zip');
  try {
    for (const fixture of [
      {runData: {...run, head_repository: {full_name: 'unapproved/repository'}}},
      {runData: {...run, conclusion: 'failure'}},
      {artifactData: {...artifact, workflow_run: {...artifact.workflow_run, id: 99}}},
      {artifactData: {...artifact, digest: 'sha256:' + 'b'.repeat(64)}},
      {archive: Buffer.alloc(bytes.length)}
    ]) {
      await assert.rejects(verifyPayload(approval, 'test', output, githubFixture(fixture)), /match/);
      await assert.rejects(stat(output), {code: 'ENOENT'});
    }
    await verifyPayload(approval, 'test', output, githubFixture());
    assert.deepEqual(await readFile(output), bytes);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
