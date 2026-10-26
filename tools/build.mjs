import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { validateEvidence, referenceClient, referenceSha256 } from '../public/restoration/catalogue.js';
import { validateCatalogue as validateJulyCatalogue } from '../public/restoration/2010/catalogue.js';
import { validateRoadmap } from '../public/restoration/2010/roadmap.js';
import { clientRelease, localClientRelease } from './client-release.mjs';
import {socialMetadata} from './social.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const progress = JSON.parse(await readFile(join(root, 'public/restoration/progress.json'), 'utf8'));
const evidence = JSON.parse(await readFile(join(root, 'public/restoration/evidence.json'), 'utf8'));
validateEvidence(progress, evidence);
const july = JSON.parse(await readFile(join(root, 'public/restoration/2010/catalogue.json'), 'utf8'));
validateRoadmap(july, validateJulyCatalogue(july));
for (const icon of new Set([...progress.categories, ...progress.features].map(row => row.icon).filter(icon => icon !== null))) {
  if (!/^assets\/player\/[a-z0-9-]+\.png$/.test(icon)) throw new Error(`Invalid restoration asset: ${icon}`);
  await readFile(join(root, 'public/restoration', icon));
}
for (const name of ['SITE_URL', 'CLIENT_DIR', 'API_ORIGIN']) {
  if (!process.env[name]) throw new Error(`${name} is required; see the setup instructions.`);
}
const site = new URL(process.env.SITE_URL);
if (site.username || site.password || site.search || site.hash) throw new Error('SITE_URL must be a public site root without credentials, query or fragment.');
if (site.protocol !== 'https:' && !(site.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(site.hostname))) {
  throw new Error('SITE_URL must use HTTPS, except for a loopback development server.');
}
if (site.pathname !== '/') throw new Error('SITE_URL must be the origin root for the game backend.');
const local = process.env.LOCAL_CLIENT_BUILD;
if (local !== undefined && local !== '1') throw new Error('LOCAL_CLIENT_BUILD must be exactly 1 when set.');
if (local && !(site.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(site.hostname))) {
  throw new Error('LOCAL_CLIENT_BUILD requires a loopback HTTP SITE_URL.');
}
const api = new URL(process.env.API_ORIGIN);
if (api.username || api.password || api.search || api.hash || api.pathname !== '/' ||
    (api.protocol !== 'https:' && !(api.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(api.hostname)))) {
  throw new Error('API_ORIGIN must be an HTTPS origin, or loopback HTTP for development.');
}
if (local && api.origin !== site.origin) throw new Error('Local client build requires matching loopback API_ORIGIN.');
const socketOrigin = api.origin.replace(/^http/, 'ws');
const client = resolve(process.env.CLIENT_DIR);
const revision = execFileSync('git', ['-C', client, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
execFileSync('git', ['-C', client, 'diff', '--exit-code', 'HEAD']);
if (local && execFileSync('git', ['-C', client, 'status', '--porcelain'], {encoding: 'utf8'}).trim()) {
  throw new Error('Local client build requires a clean exact client HEAD/tree.');
}
execFileSync('python3', [join(client, 'scripts/run.py'), '--prepare-only'], { stdio: 'inherit' });
const runtimeFiles = await readdir(join(client, 'vendor'));
if (runtimeFiles.length !== 8 || !runtimeFiles.includes('ruffle.js') || !runtimeFiles.includes('openrotmg.json')) throw new Error('Expected the pinned dual Ruffle runtime and source provenance.');

const lock = JSON.parse(await readFile(join(client, 'ruffle/lock.json'), 'utf8'));
const selection = local
  ? localClientRelease(revision, execFileSync('git', ['-C', client, 'rev-parse', 'HEAD^{tree}'], {encoding: 'utf8'}).trim(), lock)
  : await clientRelease(revision, lock);
const reference = await readFile(join(client, 'client.swf'));
if (createHash('sha256').update(reference).digest('hex') !== referenceSha256) throw new Error('Restoration reference data must be the unchanged original 123.5.1 client.');
const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist);
await cp(join(root, 'public'), dist, { recursive: true });
// Site ownership keeps adding the editor from changing an already-deployed client revision's files.
await cp(join(client, 'native-texture-editor.swf'), join(dist, 'draw/native-texture-editor.swf'));
await mkdir(join(dist, 'restoration/reference-data'), { recursive: true });
await writeFile(join(dist, 'restoration', referenceClient), reference);
const socialImage = `social.png?v=${createHash('sha256').update(await readFile(join(dist, 'social.png'))).digest('hex').slice(0, 12)}`;
const projectNav = '<div><a href="{{BASE}}">Game</a><a href="{{BASE}}about/">About</a><a href="{{BASE}}hiscores/">Hiscores</a></div>\n      <div><a href="{{BASE}}#bug-report">Report bug</a><a href="https://discord.gg/EwZWNzzYwP">Discord</a></div>';
async function render(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await render(path);
    else if (entry.name.endsWith('.html')) {
      const html = (await readFile(path, 'utf8')).replaceAll('{{PROJECT_NAV}}', projectNav).replaceAll('{{SITE_URL}}', site.href).replaceAll('{{BASE}}', site.pathname).replaceAll('{{CLIENT_REVISION}}', revision).replaceAll('{{SOCIAL_IMAGE}}', socialImage).replaceAll('{{API_ORIGIN}}', api.origin).replaceAll('{{SOCKET_ORIGIN}}', socketOrigin);
      if (html.includes('{{')) throw new Error(`Unresolved template token: ${path}`);
      await writeFile(path, socialMetadata(html, site.href + socialImage));
    }
  }
}
await render(dist);
await writeFile(join(dist, 'diagnostics-build.json'), JSON.stringify({
  website: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim().length > 0,
  ...selection, runtime: createHash('sha256').update(await readFile(join(client, 'vendor/openrotmg.json'))).digest('hex').slice(0, 16)
}));
await writeFile(join(dist, '.nojekyll'), '');
await writeFile(join(dist, 'robots.txt'), `User-agent: *\nAllow: ${site.pathname}\nDisallow: /vendor/\nDisallow: /client.swf\nDisallow: /sfx/\nDisallow: /legacy-api/\nDisallow: /game\nSitemap: ${site.href}sitemap.xml\n`);
await writeFile(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${site.href}</loc></url><url><loc>${site.href}about/</loc></url><url><loc>${site.href}restoration/</loc></url><url><loc>${site.href}restoration/2010/</loc></url><url><loc>${site.href}branding/</loc></url><url><loc>${site.href}hiscores/</loc></url><url><loc>${site.href}gold/</loc></url><url><loc>${site.href}updates/</loc></url></urlset>\n`);
console.log(`Built ${site.href} for client ${revision}. Game API: ${api.origin}. Pages publication must add the patched client, runtime and audio assets.`);
