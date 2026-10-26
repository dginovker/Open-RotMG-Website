import { createHash } from 'node:crypto';

function validateClient(revision, lock) {
  if (!/^[a-f0-9]{40}$/.test(revision)
      || !/^[0-9]+\.[0-9]+\.[0-9]+-openrotmg\.[0-9]+$/.test(lock?.version)
      || !/^[a-f0-9]{64}$/.test(lock?.bundleSha256)) {
    throw new Error('Invalid client revision or runtime lock for deployed client selection.');
  }
}

export function localClientRelease(revision, tree, lock) {
  validateClient(revision, lock);
  if (!/^[a-f0-9]{40}$/.test(tree)) throw new Error('Invalid local client tree.');
  return {client: revision, client_tree: tree, local_client: true,
    runtime_version: lock.version, runtime_bundle_sha256: lock.bundleSha256};
}

export async function clientRelease(revision, lock, download = fetch) {
  validateClient(revision, lock);
  const url = `https://codeload.github.com/OpenRotMG/Open-RotMG-Client/zip/${revision}`;
  const response = await download(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Client source archive ${url}: HTTP ${response.status}`);
  return {
    client: revision,
    client_archive_sha256: createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),
    runtime_version: lock.version,
    runtime_bundle_sha256: lock.bundleSha256,
  };
}
