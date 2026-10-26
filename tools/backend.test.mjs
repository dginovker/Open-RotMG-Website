import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const backend = readFileSync(new URL('../public/backend.js', import.meta.url), 'utf8');

test('backend requests use the declared game origin and reject foreign destinations or missing configuration', async () => {
  const calls = [];
  const context = {URL, document: {querySelector: () => ({content: 'https://game.example.test'})}, fetch: async (...args) => {calls.push(args);return {ok: true};}};
  context.window = context;
  runInNewContext(backend, context);
  const request = {credentials: 'include', mode: 'cors'};
  await context.OpenRotMGBackend.fetch('/api/account/browser', request);
  assert.equal(calls[0][0].href, 'https://game.example.test/api/account/browser');
  assert.equal(calls[0][1], request);
  assert.throws(() => context.OpenRotMGBackend.url('//evil.example/account'), /changed origin/);
  assert.throws(() => runInNewContext(backend, {URL, window: {}, document: {querySelector: () => null}}), /origin is missing/);
});

test('an offline game API does not prevent the independent static client from loading', async () => {
  let movie;
  const nodes = {'#game': {dataset: {mode: 'game'}, append() {}}, '#startup': {}, '#load-error': {hidden: true}};
  const context = {URL, AbortSignal, crypto: {getRandomValues: bytes => bytes.fill(1)},
    document: {baseURI: 'https://example.test/', querySelector: key => key.startsWith('meta[') ? {content: 'https://game.example.test'} : nodes[key]},
    fetch: async () => {throw Error('offline');}, console: {error() {}}, setInterval() {}, clearInterval() {}, addEventListener() {},
    OpenRotMGDiagnostics: {start() {}}, RufflePlayer: {newest: () => ({createPlayer: () => ({addEventListener() {}, ruffle: () => ({load: async config => {movie = config;}})})})}};
  context.window = context;
  runInNewContext(backend, context);
  await runInNewContext(readFileSync(new URL('../public/game.js', import.meta.url), 'utf8'), context);
  await new Promise(setImmediate);
  assert.equal(movie.url, 'https://example.test/client.swf');
  assert.equal(movie.socketProxy[0].proxyUrl, 'wss://game.example.test/game');
  assert.equal(nodes['#load-error'].hidden, false);
  assert.match(nodes['#load-error'].textContent, /Game server unavailable/);
});

test('the static OAuth callback preserves the registered path and forwards only to the configured backend', () => {
  let target, clean;
  const context = {URL, document: {querySelector: () => ({content: 'https://game.example.test'})},
    location: {pathname: '/api/account/link/callback/', search: '?code=fixture&state=prepared', replace: url => {target = url;}},
    history: {replaceState: (_, __, path) => {clean = path;}}};
  context.window = context;
  runInNewContext(backend, context);
  runInNewContext(readFileSync(new URL('../public/api/account/link/callback/callback.js', import.meta.url), 'utf8'), context);
  assert.equal(target, 'https://game.example.test/api/account/link/callback?code=fixture&state=prepared');
  assert.equal(clean, '/api/account/link/callback/');
});
