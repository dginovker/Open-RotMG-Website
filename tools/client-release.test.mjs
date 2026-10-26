import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { clientRelease, localClientRelease } from './client-release.mjs';

const revision = 'a'.repeat(40);
const lock = { version: '0.7.1-openrotmg.7', bundleSha256: 'b'.repeat(64) };

test('deployed selection describes the exact website client and verified runtime lock', async () => {
  let calls = 0;
  const result = await clientRelease(revision, lock, async (url, options) => {
    calls++;
    assert.equal(url, `https://codeload.github.com/OpenRotMG/Open-RotMG-Client/zip/${revision}`);
    assert.ok(options.signal instanceof AbortSignal);
    return new Response('immutable-client-archive');
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    client: revision,
    client_archive_sha256: createHash('sha256').update('immutable-client-archive').digest('hex'),
    runtime_version: lock.version,
    runtime_bundle_sha256: lock.bundleSha256,
  });
});

test('unpublished source and download failures cannot publish a guessed selection', async () => {
  await assert.rejects(clientRelease(revision, lock, async () => new Response('', { status: 404 })), /HTTP 404/);
  await assert.rejects(clientRelease(revision, lock, async () => { throw Error('offline'); }), /offline/);
});

test('explicit local selection records exact head/tree and never a remote archive identity', () => {
  const local = localClientRelease(revision, 'c'.repeat(40), lock);
  assert.deepEqual(local, {client: revision, client_tree: 'c'.repeat(40), local_client: true,
    runtime_version: lock.version, runtime_bundle_sha256: lock.bundleSha256});
  assert.equal(Object.hasOwn(local, 'client_archive_sha256'), false);
  assert.throws(() => localClientRelease(revision, 'main', lock), /Invalid local client tree/);
  assert.throws(() => localClientRelease('main', 'c'.repeat(40), lock), /Invalid client revision/);
});

test('invalid commit or runtime lock fails before downloading', async () => {
  for (const [commit, runtime] of [['main', lock], [revision, {}], [revision, { ...lock, bundleSha256: 'invalid' }]]) {
    await assert.rejects(clientRelease(commit, runtime, async () => assert.fail('must not download')), /Invalid client revision or runtime lock/);
  }
});
