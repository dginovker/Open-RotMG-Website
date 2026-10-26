import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

const identity = {website: 'a'.repeat(40), client: 'b'.repeat(40), runtime: 'c'.repeat(16), dirty: false};
const deployedManifest = {...identity, client_archive_sha256: 'd'.repeat(64), runtime_version: '0.7.1-openrotmg.8', runtime_bundle_sha256: 'e'.repeat(64)};

function fixture({longTasks = true, graphicsError = false, loaded = true, baseURI = 'https://example.test/', buildValue = deployedManifest} = {}) {
  let tick, frame, visibility, observer, time = 0, status = 204;
  const uploads = [], errors = [], lookups = [];
  const document = {
    baseURI, hidden: false,
    createElement: () => ({getContext() {if (graphicsError) throw Error('blocked'); return null;}}),
    querySelector: () => ({getBoundingClientRect: () => ({width: 800, height: 600})}),
    addEventListener: (event, callback) => {assert.equal(event, 'visibilitychange'); visibility = callback;}
  };
  class Observer {
    static supportedEntryTypes = longTasks ? ['longtask'] : [];
    constructor(callback) {observer = callback;}
    observe(options) {assert.equal(options.type, 'longtask');}
  }
  const context = {window: {}, crypto: webcrypto, URL, document, devicePixelRatio: 1.5, PerformanceObserver: Observer,
    performance: {now: () => time}, requestAnimationFrame: callback => {frame = callback;},
    setInterval: (callback, delay) => {assert.equal(delay, 5000); tick = callback;}, AbortSignal,
    console: {error: (...args) => errors.push(args)}, fetch: async (url, options) => {
      if (!options?.method) { lookups.push(url.href); return Response.json(buildValue); }
      uploads.push({url: url.href, options}); return new Response(null, {status});
    }
  };
  context.OpenRotMGBackend = {fetch: (path, options) => context.fetch(new URL(path, 'https://game.example.test'), options)};
  runInNewContext(readFileSync(new URL('../public/diagnostics.js', import.meta.url), 'utf8'), context);
  const endpoint = new URL('wss://game.example.test/game');
  let load;
  const player = {addEventListener(event, callback, options) {assert.equal(event, 'loadeddata'); assert.equal(options.once, true); load = callback;}};
  context.window.OpenRotMGDiagnostics.start(endpoint, player);
  if (loaded) load();
  return {load, endpoint, uploads, lookups, errors, document, sample: async () => {time += 5000; await tick();},
    frame: t => frame(t), task: ms => observer({getEntries: () => [{duration: ms}]}), visibility: () => visibility(), status: value => {status = value;}};
}

test('nested editor page looks up the same root build identity and telemetry API', async () => {
  const f = fixture({baseURI: 'https://example.test/draw/'});
  assert.deepEqual(f.lookups, ['https://example.test/diagnostics-build.json']);
  await f.sample();
  assert.match(f.uploads[0].url, /^https:\/\/game\.example\.test\/api\/diagnostics\/[a-f0-9]{32}$/);
});

test('startup sends no build lookup or telemetry and starts only after the movie loads', async () => {
  const f = fixture({loaded: false});
  assert.equal(f.uploads.length, 0);
  assert.equal(f.lookups.length, 0);
  assert.throws(() => f.frame(0));
  f.load();
  await f.sample();
  assert.equal(f.uploads.length, 1);
});

test('wrapper uses a random per-page socket key, bounded telemetry and no identifying fields', async () => {
  const f = fixture();
  assert.match(f.endpoint.searchParams.get('diagnostics'), /^[a-f0-9]{32}$/);
  assert.notEqual(f.endpoint.href, fixture().endpoint.href);
  await new Promise(resolve => setImmediate(resolve));
  f.frame(0); f.frame(16); f.frame(216); f.task(80);
  await f.sample();
  const upload = f.uploads[0];
  assert.equal(upload.url, `https://game.example.test/api/diagnostics/${f.endpoint.searchParams.get('diagnostics')}`);
  assert.equal(upload.options.redirect, 'error');
  const sample = JSON.parse(upload.options.body);
  assert.deepEqual(sample, {build: JSON.stringify(identity), renderer: null,
    renderer_status: 'webgl-unavailable', width: 800, height: 600, pixel_ratio: 1.5,
    hidden: false, hidden_during_interval: false, frames: 3, max_frame_gap_ms: 200, long_tasks: 1, long_task_ms: 80, elapsed_ms: 5000});
  f.document.hidden = true; f.visibility(); f.document.hidden = false; f.visibility();
  await f.sample();
  const next = JSON.parse(f.uploads[1].options.body);
  assert.equal(next.frames, 0); assert.equal(next.long_tasks, 0); assert.equal(next.hidden_during_interval, true);
});

test('oversized complete deployed/local manifests project exact bounded identities without altering release metadata', async () => {
  const local = {...identity, dirty: true, client_tree: 'f'.repeat(40), local_client: true,
    runtime_version: deployedManifest.runtime_version, runtime_bundle_sha256: deployedManifest.runtime_bundle_sha256};
  for (const [manifest, expected] of [[deployedManifest, identity], [local, {...identity, dirty: true, local_client: true}]]) {
    const original = structuredClone(manifest);
    assert.ok(Buffer.byteLength(JSON.stringify(manifest), 'utf8') > 256);
    const f = fixture({buildValue: manifest});
    await new Promise(resolve => setImmediate(resolve));
    await f.sample();
    const build = JSON.parse(f.uploads[0].options.body).build;
    assert.deepEqual(JSON.parse(build), expected);
    assert.ok(Buffer.byteLength(build, 'utf8') <= 256);
    assert.equal(f.errors.length, 0);
    assert.deepEqual(manifest, original);
  }
});

test('missing or malformed identity is logged as unavailable, never guessed or truncated', async () => {
  for (const change of [{website: undefined}, {client: 'main'}, {runtime: 'x'.repeat(512)}, {dirty: undefined}, {dirty: 'false'}, {local_client: false}]) {
    const f = fixture({buildValue: {...deployedManifest, ...change}});
    await new Promise(resolve => setImmediate(resolve));
    await f.sample();
    assert.equal(JSON.parse(f.uploads[0].options.body).build, 'unavailable');
    assert.equal(f.errors.length, 1);
    assert.equal(f.errors[0][0], 'Bug diagnostics build lookup failed');
  }
});

test('unsupported long tasks and probe errors remain explicitly unavailable, not fabricated success', async () => {
  const f = fixture({longTasks: false, graphicsError: true});
  await f.sample();
  const sample = JSON.parse(f.uploads[0].options.body);
  assert.equal(sample.renderer, null); assert.equal(sample.renderer_status, 'probe-error');
  assert.equal(sample.long_tasks, null); assert.equal(sample.long_task_ms, null);
  assert.equal(f.errors.length, 1);
});

test('title-screen/transfer absence is expected; real upload errors remain visible', async () => {
  const f = fixture(); f.status(409); await f.sample(); assert.equal(f.errors.length, 0);
  f.status(400); await f.sample(); assert.deepEqual(f.errors[0], ['Bug diagnostics upload rejected', 400]);
});
