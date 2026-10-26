import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { validateEvidence, referenceClient, referenceSha256 } from '../public/restoration/catalogue.js';

const browserTab = 'a'.repeat(64);
const browserGlobals = {OpenRotMGBackend: {url: path => new URL(path, 'https://game.example.test'), fetch: async () => ({ok: true})}, fetch: async () => {throw new Error('Linking must not gate game startup');}, crypto: {getRandomValues: bytes => {bytes.fill(0xaa);return bytes;}}, AbortSignal, setInterval: () => 1, clearInterval() {}, addEventListener() {}};
const root = fileURLToPath(new URL('../', import.meta.url));
const build = overrides => spawnSync(process.execPath, ['tools/build.mjs'], {
  cwd: root, env: { ...process.env, ...overrides }, encoding: 'utf8'
});

test('missing deployment URL fails instead of guessing a domain', () => {
  const result = build({ SITE_URL: '' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SITE_URL is required/);
});

test('public HTTP, credentials and subpaths in canonical URL are rejected', () => {
  for (const SITE_URL of ['http://example.test/', 'https://user:password@example.test/', 'https://example.test/game/']) {
    const result = build({ SITE_URL });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must use HTTPS|without credentials|must be the origin root/);
  }
});

test('site builds with metadata, strict same-origin WSS and preserved reference bytes', () => {
  const local = process.env.LOCAL_CLIENT_BUILD === '1';
  // The deployment pipeline packages this build, so an explicit deployment origin must survive the test.
  const SITE_URL = Object.hasOwn(process.env, 'SITE_URL') ? process.env.SITE_URL
    : local ? 'http://127.0.0.1:18923/' : 'https://example.test/';
  const result = build({ SITE_URL });
  assert.equal(result.status, 0, result.stderr);
  const site = new URL(SITE_URL);
  if (!site.pathname.endsWith('/')) site.pathname += '/';
  const home = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
  const about = readFileSync(new URL('../dist/about/index.html', import.meta.url), 'utf8');
  const branding = readFileSync(new URL('../dist/branding/index.html', import.meta.url), 'utf8');
  const gold = readFileSync(new URL('../dist/gold/index.html', import.meta.url), 'utf8');
  for (const html of [home, about, branding, gold]) {
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<h1[ >]/);
    assert.match(html, /name="description"/);
    assert.match(html, /property="og:image"/);
    assert.ok(!html.includes('{{'), 'Unresolved template token');
    assert.ok(!html.includes('\u2014'), 'Em dash in authored public copy');
  }
  assert.ok(home.includes(`rel="canonical" href="${site.href}"`));
  assert.ok(about.includes(`rel="canonical" href="${site.href}about/"`));
  assert.ok(gold.includes(`rel="canonical" href="${site.href}gold/"`));
  assert.match(gold, /You cannot buy Gold in Open RotMG\./);
  assert.match(gold, /<h2>One-time Gold<\/h2>/);
  assert.match(gold, /<h2>Repeatable Gold<\/h2>/);
  assert.match(gold, /Link Discord - use <code>\/link<\/code> in Discord/);
  assert.match(gold, /Submit your first bug report - use <a href="\/#bug-report">Report bug<\/a> on the website/);
  assert.match(gold, /top 50%.*hiscores\/\?board=collection/);
  assert.match(gold, /Make a YouTube video about Open RotMG/);
  assert.equal((gold.match(/Per 1,000 views/g) ?? []).length, 2);
  assert.deepEqual([...gold.matchAll(/<li>(\d+) <img/g)].map(match => Number(match[1])), [100, 100, 50, 75, 150, 250, 750, 2500, 100, 100, 50]);
  assert.equal((gold.match(/src="coin.svg" width="12" height="12" alt="Gold"/g) ?? []).length, 11);
  for (const [amount, colour, stars] of [[75,'Blue',13],[150,'Red',26],[250,'Orange',39],[750,'Yellow',52],[2500,'White',65]]) {
    assert.match(gold, new RegExp(`<li>${amount} <img[^>]+>: Reach ${colour} Star rank \\(${stars} stars\\)\\.`));
  }
  assert.match(gold, /Each star-rank reward is paid once per account\. Existing ranks count, too\./);
  assert.ok(existsSync(new URL('../dist/gold/coin.svg', import.meta.url)));
  assert.doesNotMatch(gold, /<strong>|How to get|methods|Ranks include|Collect at least|posted to GitHub|once per game account|reviewed|suggestions/);
  assert.deepEqual([...about.matchAll(/<li><a[^>]*>(.*?)<\/a><\/li>/g)].map(match => match[1]), ['Source Code', 'Updates', 'Restoration', 'Gold', 'Pixel editor', '2010 Preview']);
  assert.ok(about.includes('href="https://www.openrotmg.org/2010/">2010 Preview</a>'));
  assert.ok(!home.includes('href="https://www.openrotmg.org/2010/"'));
  assert.ok(branding.includes(`rel="canonical" href="${site.href}branding/"`));
  assert.ok(branding.includes(`value="${site.href}branding/banner.png"`));
  assert.doesNotMatch(branding, /discourse-code|Post on Discourse|Forum embed|Lost City|Images for sharing/);
  assert.ok(branding.includes('src="copy.js" defer'));
  for (const [file, width, height] of [['slices/top.png', 1360, 303], ['slices/left.png', 60, 171], ['slices/discord.png', 408, 171], ['slices/right.png', 892, 171], ['slices/bottom.png', 1360, 86]]) {
    const png = readFileSync(new URL(`../dist/branding/${file}`, import.meta.url));
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);

  }
  for (const [file, width, height] of [['banner.png', 1360, 560], ['banner-mobile.png', 800, 530], ['oryx-logo.png', 1448, 1086]]) {
    const png = readFileSync(new URL(`../dist/branding/${file}`, import.meta.url));
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
    assert.ok(branding.includes(`value="${site.href}branding/${file}"`));
    assert.ok(branding.includes(`href="${file}" download`));
  }
  const footer = home.match(/<footer class="site-footer">(.*?)<\/footer>/s)[1];
  assert.ok(footer.includes('2012 Realm of the Mad God reimplementation<br>'));
  assert.ok(footer.includes('Report bugs and missing content with the link below.</p>'));
  assert.doesNotMatch(footer.match(/<p>(.*?)<\/p>/s)[1], /<a[ >]/);
  const footerNav = footer.match(/<nav.*?<\/nav>/s)[0];
  const progress = JSON.parse(readFileSync(new URL('../dist/restoration/progress.json', import.meta.url), 'utf8'));
  const evidence = JSON.parse(readFileSync(new URL('../dist/restoration/evidence.json', import.meta.url), 'utf8'));
  const requirements = validateEvidence(progress, evidence);
  assert.doesNotMatch(footerNav, />Gold<|>Updates<|>Restoration<|>Branding</);
  assert.ok(footerNav.includes('href="https://discord.gg/EwZWNzzYwP">Discord</a>'));
  assert.ok(footerNav.includes('href="/#bug-report">Report bug</a>'));
  assert.doesNotMatch(footerNav, />Source</);
  assert.ok(about.includes('href="https://github.com/OpenRotMG">Source Code</a>'));
  assert.doesNotMatch(footer, /<p>2% complete<\/p>/);
  const shareDescription = home.match(/<meta name="description" content="([^"]+)"/)[1];
  assert.ok(home.includes(`property="og:description" content="${shareDescription}"`));
  assert.ok(home.includes(`name="twitter:description" content="${shareDescription}"`));
  for (const html of [home, about]) {
    assert.ok(html.includes('Open RotMG'));
    assert.doesNotMatch(html.replaceAll('https://github.com/OpenRotMG', ''), /OpenRotMG/);
  }
  assert.ok(home.includes('href="/#bug-report">Report bug</a>'));
  assert.equal(home.match(/Powered by Ruffle/g)?.length, 1);
  assert.match(home, /<p class="alpha-warning" role="note">Open RotMG is in early alpha\. Saves will be reset before Beta release\.<\/p>\s*<div id="game"/);
  assert.equal(home.match(/class="alpha-warning"/g)?.length, 1);
  assert.doesNotMatch(footer, /Powered by Ruffle/);
  assert.ok(about.includes('Open RotMG is an authentic recreation of Realm of the Mad God as it was in 2012. No custom content, no donations, all open source. Development is from passionate players.'));
  assert.doesNotMatch(about, /The client comes first|Reconstructing the game|class="disclaimer"|github.com\/OpenRotMG\/(website|client|server)|multiplayer server is not online/);
  assert.doesNotMatch(about, /supports guest Wizard movement|What works today/);
  assert.equal(JSON.parse(home.match(/type="application\/ld\+json">(.*?)<\/script>/s)[1]).url, site.href);
  const robots = readFileSync(new URL('../dist/robots.txt', import.meta.url), 'utf8');
  const sitemap = readFileSync(new URL('../dist/sitemap.xml', import.meta.url), 'utf8');
  assert.ok(robots.includes(`Sitemap: ${site.href}sitemap.xml`));
  assert.ok(sitemap.includes(`<loc>${site.href}gold/</loc>`));
  assert.ok(sitemap.includes(`<loc>${site.href}</loc>`));
  assert.ok(sitemap.includes(`<loc>${site.href}about/</loc>`));
  assert.ok(sitemap.includes(`<loc>${site.href}updates/</loc>`));
  const updates = readFileSync(new URL('../dist/updates/index.html', import.meta.url), 'utf8');
  const hiscores = readFileSync(new URL('../dist/hiscores/index.html', import.meta.url), 'utf8');
  for (const html of [updates, hiscores]) {
    assert.doesNotMatch(html, /Back to game|class="back"/);
    assert.match(html, /<a href="\/">Game<\/a>/);
  }
  assert.ok(updates.includes(`rel="canonical" href="${site.href}updates/"`));
  assert.ok(updates.includes('id="updates"'));
  assert.ok(!updates.includes('{{'));
  assert.ok(sitemap.includes(`<loc>${site.href}restoration/</loc>`));
  assert.ok(sitemap.includes(`<loc>${site.href}restoration/2010/</loc>`));
  const july = readFileSync(new URL('../dist/restoration/2010/index.html', import.meta.url), 'utf8');
  assert.ok(july.includes(`rel="canonical" href="${site.href}restoration/2010/"`));
  assert.ok(july.includes(`href="${site.pathname}style.css"`));
  assert.match(july, /href="\.\.\/style.css"/);
  assert.match(july, /src="app.js"/);
  assert.match(july, /aria-current="page">July 2010/);
  assert.match(july, /property="og:title"/);
  assert.doesNotMatch(july, /\{\{|RESTORATION_PERCENT|\u2014/);
  assert.match(july, /id="roadmap"/);
  assert.match(july, /<details id="technical" class="scope-details">/);
  assert.match(july, /Unresolved research and known differences block completion/);
  for (const file of ['catalogue.json', 'catalogue.js', 'roadmap.js', 'app.js', 'style.css']) assert.ok(existsSync(new URL(`../dist/restoration/2010/${file}`, import.meta.url)));
  assert.equal(readFileSync(new URL('../dist/restoration/2010/catalogue.json', import.meta.url), 'utf8'), readFileSync(new URL('../public/restoration/2010/catalogue.json', import.meta.url), 'utf8'));
  assert.deepEqual(readFileSync(new URL('../dist/restoration/progress.json', import.meta.url)), readFileSync(new URL('../public/restoration/progress.json', import.meta.url)));
  assert.ok(sitemap.includes(`<loc>${site.href}branding/</loc>`));
  const restorationPage = readFileSync(new URL('../dist/restoration/index.html', import.meta.url), 'utf8');
  assert.ok(restorationPage.includes(`rel="canonical" href="${site.href}restoration/"`));
  assert.ok(restorationPage.includes('<script type="module" src="app.js">'));
  assert.ok(restorationPage.includes(`href="${site.pathname}style.css"`));
  for (const html of [home, about, restorationPage, branding, gold]) {
    assert.equal((html.match(/class="site-shell"/g) ?? []).length, 1);
    assert.equal((html.match(/<nav aria-label="Project">/g) ?? []).length, 1);
    const nav = html.match(/<nav aria-label="Project">(.*?)<\/nav>/s)[1];
    const rows = [...nav.matchAll(/<div>(.*?)<\/div>/sg)].map(match => match[1]);
    assert.equal(rows.length, 2);
    assert.deepEqual([...rows[0].matchAll(/href="([^"]+)"/g)].map(match => match[1]), [site.pathname, `${site.pathname}about/`, `${site.pathname}hiscores/`]);
    assert.deepEqual([...rows[1].matchAll(/href="([^"]+)"/g)].map(match => match[1]), ['/#bug-report', 'https://discord.gg/EwZWNzzYwP']);
    assert.deepEqual([...nav.matchAll(/<a[^>]*>(.*?)<\/a>/g)].map(match => match[1]), ['Game', 'About', 'Hiscores', 'Report bug', 'Discord']);
    assert.equal((html.match(/class="site-signature"/g) ?? []).length, 1);
    assert.doesNotMatch(html, /site-header|site-nav|client-title\.png|Local design|Local concept/);
    assert.ok(html.includes('<footer class="site-footer">'));
    assert.doesNotMatch(html, /Back to game|class="back"/);
    assert.ok(html.includes('content="#000000"'));
  }
  assert.doesNotMatch(restorationPage, /ring-progress|class="hero"|class="score"|catalogue-note|scope-key|Provisional catalogue:|\* Development scene only/);
  const restorationApp = readFileSync(new URL('../dist/restoration/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(restorationApp, /catalogue-note|Provisional catalogue:/);
  assert.doesNotMatch(restorationPage, /feature-gates|provisional|Scope, evidence|scope-dispositions|audit-date/);
  assert.doesNotMatch(restorationApp, /Research-stage verification notes|Implementation at this snapshot|a\.observed|a\.verification/);
  assert.doesNotMatch(restorationPage, /feature-proof|development-note|Historical restoration has not been verified/);
  assert.doesNotMatch(restorationApp, /f\.evidence|f\.development|scene-mark|feature-proof|development-note/);
  const css = readFileSync(new URL('../dist/style.css', import.meta.url), 'utf8');
  assert.match(css, /overflow-y: scroll/);
  assert.match(css, /width: 850px/);
  assert.match(css, /\.game-page \.site-shell \{[^}]*width: 800px;[^}]*max-width: 100%;[^}]*min-height: 0;[^}]*padding: 0;[^}]*border: 0;[^}]*box-shadow: none;/);
  assert.match(css, /\.game-page \.site-footer \{[^}]*border: 0;/);
  assert.match(css, /background: #000/);
  assert.match(css, /color: #cb8585/);
  const restorationCss = readFileSync(new URL('../dist/restoration/style.css', import.meta.url), 'utf8');
  assert.match(restorationCss, /\.forum-list/);
  assert.match(restorationCss, /\.category-links a \{ display: inline-block;/);
  assert.doesNotMatch(restorationCss, /feature-grid|border-radius/);
  assert.equal(progress.features.length, 211);
  assert.equal(requirements.length, 281);
  assert.match(restorationPage, /id="roadmap"/);
  assert.match(restorationPage, /id="search"/);
  assert.doesNotMatch(restorationPage, /Historical evidence score|RESTORATION_PERCENT|RESTORATION_WORK/);
  assert.deepEqual(readFileSync(new URL('../dist/restoration/evidence.json', import.meta.url)), readFileSync(new URL('../public/restoration/evidence.json', import.meta.url)));
  const originalClient = readFileSync(new URL(`../dist/restoration/${referenceClient}`, import.meta.url));
  assert.equal(createHash('sha256').update(originalClient).digest('hex'), referenceSha256);
  assert.equal(existsSync(new URL('../dist/restoration/proof.html', import.meta.url)), false);
  assert.equal(existsSync(new URL('../dist/restoration/audit.html', import.meta.url)), false);
  const provenance = JSON.parse(readFileSync(new URL('../dist/diagnostics-build.json', import.meta.url), 'utf8'));
  assert.match(provenance.client, /^[a-f0-9]{40}$/);
  if (local) {
    assert.equal(provenance.local_client, true);
    assert.match(provenance.client_tree, /^[a-f0-9]{40}$/);
    assert.equal(Object.hasOwn(provenance, 'client_archive_sha256'), false);
  } else assert.match(provenance.client_archive_sha256, /^[a-f0-9]{64}$/);
  const runtimeLock = JSON.parse(readFileSync(`${process.env.CLIENT_DIR}/ruffle/lock.json`, 'utf8'));
  assert.equal(provenance.runtime_version, runtimeLock.version);
  assert.equal(provenance.runtime_bundle_sha256, runtimeLock.bundleSha256);
  const api = new URL(process.env.API_ORIGIN);
  assert.ok(home.includes(`connect-src 'self' ${api.origin} ${api.origin.replace(/^http/, 'ws')};`));
  assert.ok(home.includes(`src="${site.pathname}vendor/ruffle.js?v=${provenance.client}"`));
  assert.doesNotMatch(home, /iframe|runtime\/ruffle/);
  assert.equal(existsSync(new URL('../dist/client.swf', import.meta.url)), false);
  const editor = readFileSync(new URL('../dist/draw/native-texture-editor.swf', import.meta.url));
  const editorLock = JSON.parse(readFileSync(`${process.env.CLIENT_DIR}/editor/lock.json`, 'utf8'));
  assert.equal(createHash('sha256').update(editor).digest('hex'), editorLock.outputSha256);
  assert.equal(existsSync(new URL('../dist/native-texture-editor.swf', import.meta.url)), false);
  assert.equal(existsSync(new URL('../dist/vendor', import.meta.url)), false);
  assert.equal(existsSync(new URL('../dist/local', import.meta.url)), false);
  const social = readFileSync(new URL('../dist/social.png', import.meta.url));
  assert.equal(social.readUInt32BE(16), 1200);
  assert.equal(social.readUInt32BE(20), 630);
  const socialHash = createHash('sha256').update(social).digest('hex');
  assert.equal(socialHash, '243a2d1d875f6539c170e598bcb891476fdf24cae6a3caac52db83a31ae2f0b6');
  const imageUrl = `${site.href}social.png?v=${socialHash.slice(0, 12)}`;
  for (const html of [home, about]) assert.ok(html.includes(`property="og:image" content="${imageUrl}"`));
  assert.ok(home.includes(`name="twitter:image" content="${imageUrl}"`));
});

test('loading screen waits for movie data, not just runtime initialization', async () => {
  let finish;
  let options;
  const ready = new Promise(resolve => { finish = resolve; });
  const nodes = { '#game': { dataset: {mode: 'game'}, append() {} }, '#startup': { hidden: false }, '#load-error': {hidden: true} };
  let loaded, poll;
  const player = {addEventListener: (event, callback) => {assert.equal(event, 'loadeddata'); loaded = callback;}, ruffle: () => ({ load: config => { options = config; return ready; } }) };
  const boot = runInNewContext(readFileSync(new URL('../public/game.js', import.meta.url), 'utf8'), {
    window: { OpenRotMGDiagnostics: {start: url => url.searchParams.set('diagnostics', 'test-session')}, RufflePlayer: { newest: () => ({ createPlayer: () => player }) } },
    document: { baseURI: 'https://example.test/', querySelector: selector => nodes[selector] }, URL, ...browserGlobals,
    setInterval: callback => {poll = callback; return 1;},
    OpenRotMGBackend: {...browserGlobals.OpenRotMGBackend, fetch: async path => {if (path === '/health') return {ok: true}; throw new Error('Backend unavailable');}}
  });
  await new Promise(setImmediate);
  assert.equal(options.splashScreen, false);
  assert.equal(options.openUrlMode, 'confirm');
  assert.equal(options.url, 'https://example.test/client.swf');
  assert.equal(options.socketProxy[0].proxyUrl, 'wss://game.example.test/game?diagnostics=test-session');
  assert.equal(options.socketProxy[0].host, '127.0.0.1');
  assert.equal(options.socketProxy[0].port, 2050);
  assert.equal(options.urlRewriteRules[0][1], `https://game.example.test/legacy-api/char/list?browser=${browserTab}`);
  assert.equal(options.urlRewriteRules[1][1], 'https://game.example.test/legacy-api/');
  assert.deepEqual(Array.from(options.credentialAllowList), ['https://game.example.test']);
  assert.equal(options.urlRewriteRules[2][1], 'https://example.test/sfx/');
  assert.equal(nodes['#startup'].hidden, false);
  finish();
  await boot;
  assert.equal(nodes['#startup'].hidden, false);
  loaded();
  assert.equal(nodes['#startup'].hidden, true);
  assert.equal(nodes['#game'].dataset.loaded, 'true');
  poll();
  await new Promise(setImmediate);
  assert.equal(nodes['#load-error'].hidden, false);
  assert.match(nodes['#load-error'].textContent, /Game connection failed: Backend unavailable.*website and client are still available/);
});

test('legacy API rewrites leave same-origin game assets alone on port 8080', async () => {
  for (const port of [8080, 18923, 65535]) {
    const origin = `http://127.0.0.1:${port}`;
    let options;
    const nodes = { '#game': { dataset: {mode: 'game'}, append() {} }, '#startup': { hidden: false } };
    const player = { addEventListener() {}, ruffle: () => ({ load: config => { options = config; return Promise.resolve(); } }) };
    await runInNewContext(readFileSync(new URL('../public/game.js', import.meta.url), 'utf8'), {
      window: { OpenRotMGDiagnostics: {start: url => url.searchParams.set('diagnostics', 'test-session')}, RufflePlayer: { newest: () => ({ createPlayer: () => player }) } },
      document: { baseURI: origin + '/', querySelector: selector => nodes[selector] }, URL, ...browserGlobals,
      OpenRotMGBackend: {url: path => new URL(path, origin), fetch: async () => ({ok: true})}
    });
    const rewrite = url => options.urlRewriteRules.reduce((url, [pattern, replacement]) => url.replace(pattern, replacement), url);
    for (const path of ['client.swf', 'native-texture-editor.swf', 'draw/', 'game.js', 'vendor/ruffle.js', 'legacy-api/char/list', 'game', 'health']) {
      assert.equal(rewrite(`${origin}/${path}`), `${origin}/${path}`);
    }
    for (const protocol of ['http', 'https']) {
      for (const path of ['char/list', 'char/fame', 'account/register', 'account/verify', 'account/setName', 'fame/list', 'guild/listMembers', 'guild/getBoard', 'guild/setBoard', 'picture/save', 'picture/list', 'picture/get', 'picture/delete']) {
        assert.equal(rewrite(`${protocol}://127.0.0.1:8080/${path}`), `${origin}/legacy-api/${path}${path === 'char/list' ? `?browser=${browserTab}` : ''}`);
      }
    }
    for (const url of [
      'https://127.0.0.1.evil.example:8080/picture/get',
      'http://127.0.0.1:8080.evil.example/picture/get',
      'http://127.0.0.1:8080@evil.example/picture/get',
      'http://127.0.0.1:8081/picture/get', 'http://localhost:8080/picture/get',
      'http://evil.example/picture/get', 'ftp://127.0.0.1:8080/picture/get',
      'http://127.0.0.1:8080/picture', 'http://127.0.0.1:8080/pictures/list',
      'http://127.0.0.1:8080/not/picture/get', 'http://127.0.0.1:8080/?next=/picture/get'
    ]) assert.equal(rewrite(url), url);
    assert.equal(options.allowScriptAccess, false);
    assert.equal(options.openUrlMode, 'confirm');
    assert.equal(rewrite(options.url), options.url);
  }
});

test('startup failure shows an error instead of leaving the branding stuck', async () => {
  const nodes = { '#startup': { hidden: false }, '#load-error': { hidden: true } };
  const errors = [];
  await runInNewContext(readFileSync(new URL('../public/game.js', import.meta.url), 'utf8'), {
    window: {}, document: { querySelector: selector => nodes[selector] },
    console: { error: (...args) => errors.push(args) }
  });
  assert.equal(nodes['#startup'].hidden, true);
  assert.equal(nodes['#load-error'].hidden, false);
  assert.match(nodes['#load-error'].textContent, /Pinned Ruffle runtime did not load/);
  assert.equal(errors.length, 1);
});
