import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {events, viewMessage, start} from '../public/bots/app.js';

test('bot stream parser keeps partial messages and skips keep-alive comments', () => {
  const [first, rest] = events('data: {"a":1}\n\n:\n\ndata: {"b"');
  assert.deepEqual(first, [{a: 1}]);
  assert.deepEqual(events(rest + ':2}\n\n'), [[{b: 2}], '']);
  assert.deepEqual(events('data: {"a":1}\r\n\r\n'), [[{a: 1}], '']);
  assert.throws(() => events('data: bad\n\n'), SyntaxError);
});

test('native messages require exact origin, window, bot and status schema', () => {
  const source = {}, data = {type: 'openrotmg-bot-view', bot: 'Alpha', status: 'live'};
  const event = {origin: 'https://game.test', source, data};
  const valid = change => viewMessage({...event, ...change}, event.origin, source, 'Alpha');
  assert.equal(valid({}), true);
  for (const status of ['connecting', 'live', 'stale', 'disconnected']) assert.equal(valid({data: {...data, status}}), true);
  assert.equal(valid({data: {...data, status: 'error', error: 'socket closed'}}), true);
  for (const change of [
    {origin: 'https://evil.test'}, {source: {}}, {source: null}, {data: null}, {data: []},
    ...[{bot: 'Beta'}, {type: 'other'}, {status: 'playing'}, {error: 1}, {status: 'error'}, {status: 'error', error: ''}, {extra: true}].map(patch => ({data: {...data, ...patch}})),
  ]) assert.equal(valid(change), false, JSON.stringify(change));
  assert.equal(viewMessage({...event, source: null}, event.origin, null, 'Alpha'), false);
});

class Node {
  constructor(tag = '') {this.tag = tag;this.children = [];this.textContent = '';this.listeners = {};this.attributes = {};if (tag === 'iframe') this.contentWindow = {};}
  set value(value) {this.selected = this.tag === 'select' && !this.children.some(child => child.value === value) ? '' : value;}
  get value() {return this.selected;}
  replaceChildren(...children) {this.children = children;for (const child of children) child.parent = this;if (this.tag === 'select') this.value = children[0]?.value ?? '';}
  prepend(child) {child.parent = this;this.children.unshift(child);}
  get lastChild() {return this.children.at(-1);}
  remove() {this.parent.children = this.parent.children.filter(child => child !== this);}
  setAttribute(key, value) {this.attributes[key] = value;}
  addEventListener(type, callback) {this.listeners[type] = callback;}
  removeEventListener(type) {delete this.listeners[type];}
}
const flush = () => new Promise(setImmediate);
const deferred = () => {let resolve;const promise = new Promise(done => {resolve = done;});return {promise, resolve};};
const frame = {level: 3, class: 'Wizard', world: 'Realm', hp: 80, max_hp: 100, mp: 40, max_mp: 60, reason: 'exploring', aim: null};
const bots = names => ({bots: names.map(name => ({name, frame})), llm: {enabled: false}});
const json = value => new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}});
function harness(t, query = '', initial = bots(['Alpha', 'Beta'])) {
  let clock = 0, nextTimer = 0;
  const nodes = Object.fromEntries(['bot', 'status', 'view', 'view-status', 'telemetry-status', 'vitals', 'thoughts', 'llm'].map(id => [`#${id}`, new Node(id === 'bot' ? 'select' : '')]));
  const listeners = {}, timers = new Map(), calls = [], lists = [json(initial)], streams = [], feeds = [];
  const window = {location: {search: query}, history: {replaceState(...args) {window.path = args[2];}},
    addEventListener(type, callback) {listeners[type] = callback;}, removeEventListener(type) {delete listeners[type];},
    setInterval(callback, ms) {timers.set(++nextTimer, {callback, ms, interval: true});return nextTimer;},
    setTimeout(callback, ms) {timers.set(++nextTimer, {callback, ms});return nextTimer;},
    clearTimeout(id) {timers.delete(id);}, clearInterval(id) {timers.delete(id);}};
  const backend = {url: path => new URL(path, 'https://game.test'), fetch: async (path, options) => {
    calls.push({path, options});
    if (path === '/api/bots') return lists.length ? await lists.shift() : json(bots(['Alpha', 'Beta']));
    if (streams.length) return await streams.shift();
    const stream = new ReadableStream({start(controller) {feeds.push(controller);}});
    return new Response(stream);
  }};
  const stop = start({document: {querySelector: key => nodes[key], createElement: tag => new Node(tag)}, window, backend, now: () => clock});
  t.after(stop);
  return {nodes, window, calls, lists, streams, feeds, timers,
    iframe: () => nodes['#view'].children[0],
    send(data, change = {}) {listeners.message({origin: 'https://game.test', source: nodes['#view'].children[0]?.contentWindow, data: {type: 'openrotmg-bot-view', bot: 'Alpha', status: 'live', ...data}, ...change});},
    choose(name) {nodes['#bot'].value = name;nodes['#bot'].listeners.change({target: nodes['#bot']});},
    async emit(update, feed = feeds.at(-1)) {feed.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(update)}\n\n`));await flush();},
    async advance(ms) {clock += ms;for (const [id, timer] of [...timers]) if (timer.ms <= ms && timers.has(id)) {if (!timer.interval) timers.delete(id);timer.callback();}await flush();},
  };
}

test('native iframe uses configured backend, constrained permissions and independent status/age', async t => {
  const h = harness(t);await flush();
  assert.equal(h.iframe().src, 'https://game.test/api/bots/Alpha/view');
  assert.equal(h.iframe().attributes.sandbox, 'allow-scripts allow-same-origin');
  assert.match(h.iframe().attributes.allow, /camera 'none'/);
  assert.match(h.iframe().title, /Read-only.*Alpha/);
  assert.match(h.nodes['#view-status'].textContent, /connecting/);
  await h.emit({frame, age_ms: 12000, thoughts: [{at: 0, text: 'Heading toward the beach'}]});
  assert.match(h.nodes['#telemetry-status'].textContent, /12 s ago/);
  assert.match(h.nodes['#vitals'].textContent, /Alpha, level 3 Wizard/);
  assert.match(h.nodes['#thoughts'].children[0].textContent, /Heading toward the beach/);
  assert.doesNotMatch(h.nodes['#view-status'].textContent, /live/);
  h.send();assert.equal(h.nodes['#view-status'].textContent, 'Native view: live.');
  await h.advance(16000);
  assert.match(h.nodes['#view-status'].textContent, /stale/);
  assert.match(h.nodes['#telemetry-status'].textContent, /stale.*28 s ago/);
  h.send({status: 'disconnected'});assert.match(h.nodes['#view-status'].textContent, /disconnected/);
  h.send({status: 'error', error: 'overflow; reconnect required'});assert.match(h.nodes['#view-status'].textContent, /error.*overflow/);
  h.send({status: 'connecting'});assert.match(h.nodes['#view-status'].textContent, /connecting/);
});

test('picker discards old iframe/feed; forged and retired-window messages cannot change new status', async t => {
  const h = harness(t);await flush();
  await h.emit({frame, age_ms: 0, thoughts: [{at: 0, text: 'old Alpha thought'}]});
  const old = h.iframe(), signal = h.calls[1].options.signal;
  h.choose('Beta');await flush();
  assert.equal(signal.aborted, true);assert.notEqual(h.iframe(), old);
  assert.equal(h.window.path, '?bot=Beta');assert.equal(h.nodes['#vitals'].textContent, '');assert.equal(h.nodes['#thoughts'].children.length, 0);
  for (const [data, change] of [[{bot: 'Alpha'}, {}], [{bot: 'Beta'}, {source: old.contentWindow}], [{bot: 'Beta'}, {origin: 'https://evil.test'}], [{bot: 'Beta', status: 'nonsense'}, {}]]) h.send(data, change);
  assert.equal(h.nodes['#view-status'].textContent, 'Native view: connecting.');
  // Even a buffered read resolved after abort must not repaint the new selection.
  await h.emit({frame: {...frame, reason: 'old stream'}, age_ms: 0, thoughts: [{at: 0, text: 'late Alpha'}]}, h.feeds[0]);
  assert.equal(h.nodes['#vitals'].textContent, '');assert.equal(h.nodes['#thoughts'].children.length, 0);
  h.send({bot: 'Beta'});assert.equal(h.nodes['#view-status'].textContent, 'Native view: live.');
  await h.emit({frame, age_ms: 0, thoughts: []});assert.match(h.nodes['#vitals'].textContent, /^Beta,/);
});

test('HTTP failure retry is canceled on selection and late responses never repaint', async t => {
  const h = harness(t);await flush();
  h.streams.push(new Response('not here', {status: 404}));h.choose('Beta');await flush();
  assert.match(h.nodes['#telemetry-status'].textContent, /error.*HTTP 404.*Retrying in 5 s/);
  const late = deferred();h.streams.push(late.promise);h.choose('Alpha');await flush();h.choose('Beta');await flush();
  late.resolve(new Response('bad old response', {status: 500}));await flush();
  assert.match(h.nodes['#telemetry-status'].textContent, /connecting/);
  const count = h.calls.filter(call => call.path.endsWith('/stream')).length;
  await h.advance(5000);assert.equal(h.calls.filter(call => call.path.endsWith('/stream')).length, count);
  assert.equal(h.nodes['#vitals'].textContent, '');assert.match(h.iframe().src, /Beta\/view$/);
});

test('malformed/closed SSE is observable and same-bot retry replaces replayed thoughts', async t => {
  const h = harness(t);await flush();
  await h.emit({frame, age_ms: 0, thoughts: [{at: 0, text: 'first thought'}]});
  h.feeds[0].close();await flush();assert.match(h.nodes['#telemetry-status'].textContent, /server closed the stream/);
  await h.advance(5000);assert.equal(h.nodes['#thoughts'].children.length, 0);
  await h.emit({frame: null, age_ms: 0, thoughts: []});assert.match(h.nodes['#vitals'].textContent, /has not made a decision/);
  await h.emit({frame, age_ms: -1, thoughts: []});assert.match(h.nodes['#telemetry-status'].textContent, /malformed bot telemetry/);
});

test('missing query bot never substitutes another bot; availability loss resets display and can reconnect', async t => {
  const h = harness(t, '?bot=Missing');await flush();
  assert.equal(h.iframe(), undefined);assert.match(h.nodes['#status'].textContent, /Missing is offline/);
  assert.equal(h.nodes['#bot'].value, '');assert.equal(h.calls.length, 1);
  h.choose('Beta');await flush();await h.emit({frame, age_ms: 0, thoughts: [{at: 0, text: 'Beta thought'}]});
  h.lists.push(json(bots([])));await h.advance(10000);
  assert.equal(h.iframe(), undefined);assert.equal(h.nodes['#vitals'].textContent, '');assert.equal(h.nodes['#thoughts'].children.length, 0);
  assert.equal(h.nodes['#bot'].disabled, true);assert.match(h.nodes['#status'].textContent, /Beta is offline/);
  h.lists.push(json(bots(['Beta'])));await h.advance(10000);
  assert.match(h.iframe().src, /Beta\/view$/);assert.equal(h.nodes['#bot'].disabled, false);
});

test('out-of-order list responses cannot undo picker selection or newer availability', async t => {
  const h = harness(t);await flush();
  const late = deferred();h.lists.push(late.promise);await h.advance(10000);
  h.choose('Beta');await flush();h.lists.push(json(bots(['Beta'])));await h.advance(10000);
  const iframe = h.iframe();late.resolve(json(bots([])));await flush();
  assert.equal(h.iframe(), iframe);assert.equal(h.nodes['#bot'].value, 'Beta');
  h.lists.push(new Response('offline', {status: 503}));await h.advance(10000);
  assert.match(h.nodes['#status'].textContent, /Bot list error:.*HTTP 503/);assert.equal(h.iframe(), iframe);
});

test('empty server and native bootstrap failure are explicit; model budgets/errors remain visible', async t => {
  const h = harness(t);await flush();
  h.iframe().listeners.error();assert.match(h.nodes['#view-status'].textContent, /error.*failed to load/);
  h.choose('Alpha');await flush();await h.advance(16000);assert.match(h.nodes['#view-status'].textContent, /error.*no native status/);
  const list = bots([]);list.llm = {enabled: true, model: 'test-model', status: 'limited', budget_scope: 'process-local', budget_resets_on_restart: true, budget_window_seconds: 86400, budget_window_resets_in_seconds: 3600, provider_quota: 'unknown', daily_requests: 9, daily_limit: 1000, requests_remaining: 991, automatic_limit: 800, automatic_remaining: 0, successes: 7, failures: 2, local_capacity_denials: 3, in_flight: 0, last_latency_ms: 300, last_error: 'quota exhausted'};
  h.lists.push(json(list));await h.advance(10000);
  const text = h.nodes['#llm'].textContent;
  assert.match(text, /Process-local fixed 24 h allowance: 9 of 1000 requests used, 991 remaining \(0 of 800 left for bot-initiated speech\)/);
  assert.match(text, /Resets in 3600 s and on server restart\. Actual provider quota: unknown\./);
  assert.match(text, /7 succeeded, 2 failed, 0 in flight\./);
  assert.match(text, /Last reply took 300 ms\. Last error: quota exhausted\./);
  assert.match(text, /Local capacity denials since restart: 3 \(no provider requests\)\./);
  assert.doesNotMatch(text, /Today|rolling|free provider|provider limit/i);
  for (const value of [undefined, -1, 1.5, '3']) {
    list.llm.local_capacity_denials = value;h.lists.push(json(list));await h.advance(10000);
    assert.match(h.nodes['#status'].textContent, /Bot list error: malformed language-model allowance/);
    assert.equal(h.nodes['#llm'].textContent, text);
  }
  list.llm.local_capacity_denials = 3;
  list.llm.budget_scope = 'provider';h.lists.push(json(list));await h.advance(10000);
  assert.match(h.nodes['#status'].textContent, /Bot list error: malformed language-model allowance/);
  assert.equal(h.nodes['#llm'].textContent, text);
});

test('initial empty population and encoded query selection never invent a live feed', async t => {
  const empty = harness(t, '', bots([]));await flush();
  assert.equal(empty.iframe(), undefined);assert.match(empty.nodes['#status'].textContent, /No bots are running/);
  assert.equal(empty.nodes['#bot'].disabled, true);assert.equal(empty.calls.length, 1);
  const encoded = harness(t, '?bot=Alpha%20%26%20Beta', bots(['Alpha & Beta']));await flush();
  assert.equal(encoded.iframe().src, 'https://game.test/api/bots/Alpha%20%26%20Beta/view');
  assert.equal(encoded.calls[1].path, '/api/bots/Alpha%20%26%20Beta/stream');
});

test('page allows only backend frames, preserves native 4:3 mobile layout and accessible statuses without diagram', async () => {
  const html = await readFile(new URL('../public/bots/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/bots/style.css', import.meta.url), 'utf8');
  assert.match(html, /frame-src \{\{API_ORIGIN\}\};/);
  for (const id of ['status', 'view-status', 'telemetry-status']) assert.match(html, new RegExp(`id="${id}" role="status"`));
  assert.match(css, /aspect-ratio:4\/3/);assert.match(css, /@media \(max-width:700px\)/);assert.doesNotMatch(html, /<canvas/);
});
