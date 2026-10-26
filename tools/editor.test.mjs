import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const script = readFileSync(new URL('../public/game.js', import.meta.url), 'utf8');
for (const [mode, path] of [['game', '/client.swf'], ['editor', '/draw/native-texture-editor.swf']]) {
  test(`${mode} resolves only its named root asset from the nested editor page`, async () => {
    for (const baseURI of ['http://127.0.0.1:18923/draw/', 'https://example.test/draw/?url=https://evil.example/movie.swf']) {
      let options;
      const nodes = {'#game': {dataset: {mode}, append() {}}, '#startup': {}, '#load-error': {hidden: true}};
      const player = {addEventListener() {}, ruffle: () => ({load: async value => {options = value;}})};
      await runInNewContext(script, {window: {RufflePlayer: {newest: () => ({createPlayer: () => player})}, OpenRotMGDiagnostics: {start() {}}},
        document: {baseURI, querySelector: key => nodes[key]}, URL, AbortSignal,
        OpenRotMGBackend: {url: path => new URL(path, baseURI), fetch: async () => ({ok: true})}, crypto: {getRandomValues: bytes => {bytes.fill(0xaa);return bytes;}},
        fetch: async () => ({ok: true, json: async () => ({tab: 'a'.repeat(64)})}), setInterval: () => 1, clearInterval() {}, addEventListener() {}});
      const origin = new URL(baseURI).origin;
      assert.equal(options.url, origin + path);
      const offset = mode === 'game' ? 1 : 0;
      assert.equal(options.urlRewriteRules[offset][1], origin + '/legacy-api/');
      assert.equal(options.urlRewriteRules[offset + 1][1], origin + '/sfx/');
      assert.equal(options.socketProxy[0].proxyUrl, origin.replace(/^http/, 'ws') + '/game');
      assert.equal(options.allowScriptAccess, false);
      assert.equal(options.openUrlMode, 'confirm');
    }
  });
}
test('unknown or absent mode fails visibly without loading arbitrary content', async () => {
  for (const mode of [undefined, '', '../client.swf', 'https://evil.example/movie.swf']) {
    let loads = 0;
    const nodes = {'#game': {dataset: {mode}, append() {}}, '#startup': {}, '#load-error': {hidden: true}};
    const player = {addEventListener() {}, ruffle: () => ({load: async () => {loads++;}})};
    await runInNewContext(script, {window: {RufflePlayer: {newest: () => ({createPlayer: () => player})}, OpenRotMGDiagnostics: {start() {}}},
      document: {baseURI: 'https://example.test/draw/', querySelector: key => nodes[key]}, URL,
      OpenRotMGBackend: {url: path => new URL(path, 'https://game.example.test')}, console: {error() {}}});
    assert.equal(loads, 0);
    assert.equal(nodes['#load-error'].hidden, false);
    assert.match(nodes['#load-error'].textContent, /Unknown client mode/);
  }
});
test('ordinary linked editor uses the same launcher, diagnostics, runtime and CSP', () => {
  const home = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const about = readFileSync(new URL('../public/about/index.html', import.meta.url), 'utf8');
  const draw = readFileSync(new URL('../public/draw/index.html', import.meta.url), 'utf8');
  assert.match(about, /href="{{BASE}}draw\/"/);
  assert.doesNotMatch(home, /href="{{BASE}}draw\/"/);
  assert.match(home, /data-mode="game"/);
  assert.match(draw, /data-mode="editor"/);
  assert.equal(draw.match(/content="default-src[^"]+"/)[0], home.match(/content="default-src[^"]+"/)[0]);
  for (const path of ['vendor/ruffle.js?v={{CLIENT_REVISION}}', 'diagnostics.js', 'game.js']) assert.ok(draw.includes(`src="{{BASE}}${path}"`));
});
test('local build rejects dirty tracked and untracked client state before preparation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'editor-local-client-'));
  const git = (...args) => {
    const result = spawnSync('git', ['-C', directory, ...args], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    git('init', '-q');
    writeFileSync(join(directory, 'tracked'), 'original');
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture');
    for (const name of ['untracked', 'tracked']) {
      writeFileSync(join(directory, name), 'dirty');
      const result = spawnSync(process.execPath, ['tools/build.mjs'], {cwd: new URL('../', import.meta.url),
        env: {...process.env, CLIENT_DIR: directory, SITE_URL: 'http://127.0.0.1/', API_ORIGIN: 'http://127.0.0.1', LOCAL_CLIENT_BUILD: '1'}, encoding: 'utf8'});
      assert.notEqual(result.status, 0);
      assert.doesNotMatch(result.stdout, /Prepared/);
      if (name === 'untracked') assert.match(result.stderr, /clean exact client HEAD\/tree/);
      rmSync(join(directory, 'untracked'), {force: true});
    }
  } finally { rmSync(directory, {recursive: true}); }
});

test('invalid local flags and nonloopback local targets are rejected', () => {
  for (const [flag, SITE_URL] of [['0', 'http://127.0.0.1/'], ['', 'http://127.0.0.1/'], ['1', 'https://example.test/']]) {
    const result = spawnSync(process.execPath, ['tools/build.mjs'], {cwd: new URL('../', import.meta.url),
      env: {...process.env, CLIENT_DIR: process.env.CLIENT_DIR ?? '/not-used', SITE_URL, LOCAL_CLIENT_BUILD: flag}, encoding: 'utf8'});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /LOCAL_CLIENT_BUILD/);
  }
});
