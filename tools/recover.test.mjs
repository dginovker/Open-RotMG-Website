import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {passwordValid,submitReset} from '../public/recover/app.js';
test('reset passwords use native byte limits without trimming or control characters', () => {
  for (const p of ['12345',' '.repeat(5),'😀😀','a'.repeat(128)]) assert.equal(passwordValid(p),true);
  for (const p of ['', '1234','a'.repeat(129),'a\nbcd','abc\u0085d','😀'.repeat(33)]) assert.equal(passwordValid(p),false);
});
test('reset secrets stay in a same-origin no-store JSON body, never URLs or credentials', async () => {
  await submitReset('a'.repeat(64),'new-password',async (url,request) => {
    assert.equal(url,'/api/account/recover');
    assert.deepEqual(JSON.parse(request.body),{token:'a'.repeat(64),password:'new-password'});
    for (const [key,value] of Object.entries({redirect:'error',cache:'no-store',credentials:'omit',mode:'cors',method:'POST'})) assert.equal(request[key],value);
    return new Response('{"reset":true}');
  });
  await assert.rejects(submitReset('bad','new-password',() => {throw Error('called');}),/Invalid reset/);
  await assert.rejects(submitReset('a'.repeat(64),'new-password',async () => new Response('{"error":"expired"}',{status:400})),/expired/);
  await assert.rejects(submitReset('a'.repeat(64),'new-password',async () => new Response('{}')),/Invalid reset confirmation/);
});
test('reset page erases fragments and hiscores use the requested concise copy',async () => {
  const app=await readFile(new URL('../public/recover/app.js',import.meta.url),'utf8');
  assert.match(app,/history.replaceState/);assert.match(app,/addEventListener\('hashchange', \(\) => location\.reload\(\)\)/);assert.ok(!/localStorage|sessionStorage|console\./.test(app));
  const html=await readFile(new URL('../public/recover/index.html',import.meta.url),'utf8');
  assert.match(html,/noindex,nofollow/);assert.match(html,/no-referrer/);assert.ok(!/<script[^>]*src="https?:/.test(html));
  const scores=await readFile(new URL('../public/hiscores/app.js',import.meta.url),'utf8');
  const index=await readFile(new URL('../public/hiscores/index.html',import.meta.url),'utf8');
  assert.ok(!scores.includes('Updated '));assert.ok(!index.includes('Alpha records.'));
  assert.match(index,/>Search<\/label>/);assert.ok(scores.includes('Items personally picked up from enemy drops'));
  assert.ok(!scores.includes('before spending'));
});
