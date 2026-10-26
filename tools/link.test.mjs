import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startLink,completeLink} from '../public/link/app.js';
const token='a'.repeat(64),origin='https://openrotmg.org';
const authorization=()=>{
  const u=new URL('https://discord.com/oauth2/authorize');
  u.search=new URLSearchParams({scope:'identify',state:'b'.repeat(64),redirect_uri:origin+'/api/account/link/callback'});
  return u.href;
};
test('linking automatically uses the authenticated browser without passwords or a second confirmation',async()=>{
  const result=await startLink(token,origin,async(path,request)=>{
    assert.equal(path,'/api/account/link/start');assert.deepEqual(JSON.parse(request.body),{token});
    assert.equal(request.credentials,'include');assert.equal(request.mode,'cors');assert.equal(request.redirect,'error');assert.equal(request.cache,'no-store');assert.equal(request.method,'POST');
    return Response.json({state:'authorize',url:authorization()});
  });assert.equal(result.state,'authorize');
  assert.deepEqual(await startLink(token,origin,async()=>Response.json({state:'signed_out'})),{state:'signed_out'});
});
test('untrusted OAuth destinations, stale grants and malformed results fail explicitly',async()=>{
  for(const url of ['https://evil.example/',authorization().replace('scope=identify','scope=email'),authorization().replace('https%3A%2F%2Fopenrotmg.org','https%3A%2F%2Fevil.example')]){
    await assert.rejects(startLink(token,origin,async()=>Response.json({state:'authorize',url})),/Invalid Discord/);
  }
  await assert.rejects(startLink('invalid',origin,()=>assert.fail('must not send')),/Run \/link/);
  await assert.rejects(startLink(token,origin,async()=>Response.json({error:'link expired'},{status:400})),/expired/);
  await assert.rejects(startLink(token,origin,async()=>Response.json({state:'surprise'})),/Invalid linking/);
});
test('success requires a server-verified cookie-bound completion receipt, never just a forged URL name',async()=>{
  assert.equal(await completeLink(token,async(path,request)=>{assert.equal(path,'/api/account/link/complete');assert.deepEqual(JSON.parse(request.body),{token});return Response.json({name:'FixtureArcher'});}),'FixtureArcher');
  await assert.rejects(completeLink(token,async()=>Response.json({})),/could not be confirmed/);
  await assert.rejects(completeLink(token,async()=>Response.json({error:'receipt rejected'},{status:400})),/receipt rejected/);
});
test('page has no password form, shows confirmed next steps only after success, and strips secrets from history',()=>{
  const html=readFileSync(new URL('../public/link/index.html',import.meta.url),'utf8');
  const app=readFileSync(new URL('../public/link/app.js',import.meta.url),'utf8');
  assert.doesNotMatch(html,/<form|<input/i);
  assert.match(html,/<section id="success" hidden>/);
  for (const command of ['kick','recover','unlink']) assert.ok(html.includes(`<code>/${command}</code>`));
  assert.match(html,/You can now close this tab/);
  assert.match(app,/status.textContent = 'Account linked!'/);
  assert.match(html,/target="_blank" rel="noopener"/);assert.match(html,/no-referrer/);
  assert.match(app,/history.replaceState/);assert.match(app,/visibilitychange/);
  assert.doesNotMatch(app,/localStorage|sessionStorage|console\.|result\.has\('linked'\)/);
});
