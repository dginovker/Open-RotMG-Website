import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../public/bug-report.js',import.meta.url),'utf8');
function fixture(hash='',ready=true){
 const element=()=>({listeners:{},attributes:{},addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(k,v){this.attributes[k]=v;},textContent:'',value:'',disabled:false,hidden:true,scrollIntoView(){},replaceChildren(...children){this.children=children;this.textContent=children.map(v=>typeof v==='string'?v:v.textContent).join('');}});
 const panel=element(),form=element(),description=element(),image=element(),status=element(),submit=element(),refresh=element(),link=element();
 form.querySelector=()=>submit;
 const nodes={'#bug-report':panel,'#bug-form':form,'#bug-description':description,'#bug-screenshot':image,'#bug-status':status,'#bug-refresh':refresh,'a[href="/#bug-report"]':link};
 let captureError=false,resolveRequest,onLoaded,draws=0,now=0;const requests=[];
 const context={window:{},location:{hash},AbortSignal,Date:{now:()=>now},setTimeout:fn=>{now+=2000;setImmediate(fn);},requestAnimationFrame:fn=>fn(),document:{querySelector:selector=>{assert(selector in nodes,selector);return nodes[selector];},createElement:tag=>{
  if(tag==='a')return element();assert.equal(tag,'canvas');return {getContext:()=>({drawImage(){draws++;if(captureError)throw Error('frame unavailable');}}),toDataURL:()=> 'data:image/png;base64,cG5n'};
 }},OpenRotMGBackend:{fetch:async(path,options)=>{requests.push({path,options});return new Promise(resolve=>{resolveRequest=resolve;});}}};
 runInNewContext(source,context);
 context.window.OpenRotMGBugReport.start('a'.repeat(32),{addEventListener(type,fn){assert.equal(type,'loadeddata');onLoaded=fn;},shadowRoot:{querySelector:selector=>{assert.equal(selector,'canvas');return {width:800,height:600};}}});
 if(ready)onLoaded();
 return {panel,description,image,status,submit,requests,refresh,link,drawCount:()=>draws,load:async()=>{onLoaded();await new Promise(setImmediate);},failCapture:()=>{captureError=true;},respond:(ok,value)=>resolveRequest({ok,status:ok?200:400,json:async()=>value}),open:async()=>{link.listeners.click({preventDefault(){}});await new Promise(setImmediate);},send:()=>form.listeners.submit({preventDefault(){}})};
}
test('footer link opens one hidden form and captures the game without another disclosure',async()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(html,/<section id="bug-report"[^>]* hidden>/);assert.doesNotMatch(html,/<summary>Report Bug/);
 const f=fixture();assert.equal(f.panel.hidden,true);await f.open();assert.equal(f.panel.hidden,false);assert.equal(f.link.attributes['aria-expanded'],'true');assert.equal(f.link.attributes['aria-controls'],'bug-report');assert.equal(f.submit.disabled,false);assert.match(f.image.src,/^data:image\/png/);
 const direct=fixture('#bug-report',false);await new Promise(setImmediate);assert.equal(direct.panel.hidden,false);assert.equal(direct.submit.disabled,true);assert.equal(direct.drawCount(),0,'a pre-load canvas must not be captured');
 const loading=direct.load();assert.equal(direct.drawCount(),0,'startup capture must wait until loadeddata dispatch finishes');
 await loading;assert.equal(direct.submit.disabled,false);assert.equal(direct.image.hidden,false);
});
test('report preserves rejected input and shows the validated GitHub receipt, not an internal ID',async()=>{
 const f=fixture();await f.open();f.description.value='First line\nReferences appreciated';let sending=f.send();assert.equal(f.requests.length,1);await f.refresh.listeners.click();await f.send();assert.equal(f.requests.length,1);
 assert.equal(f.requests[0].path,`/api/diagnostics/${'a'.repeat(32)}/report`);assert.deepEqual(JSON.parse(f.requests[0].options.body),{message:f.description.value,screenshot:'cG5n'});
 f.respond(false,{error:'Report storage unavailable.'});await sending;assert.match(f.status.textContent,/Report storage unavailable/);assert.match(f.description.value,/First line/);
 sending=f.send();f.respond(true,{id:'b'.repeat(24)});await new Promise(setImmediate);
 assert.equal(f.requests.at(-1).path,`/api/bug-reports/${'b'.repeat(24)}/status`);assert.equal(f.requests.at(-1).options.cache,'no-store');assert.notEqual(f.description.value,'');
 f.respond(true,{url:'https://github.com/OpenRotMG/Open-RotMG-Server/issues/528'});await sending;
 assert.equal(f.description.value,'');assert.equal(f.status.children[0].href,'https://github.com/OpenRotMG/Open-RotMG-Server/issues/528');assert.match(f.status.textContent,/View GitHub issue #528/);assert.doesNotMatch(f.status.textContent,/Report ID/);
});
test('publication failures retry only the saved report lookup and reject untrusted links',async()=>{
 const f=fixture();await f.open();f.description.value='Do not duplicate';let sending=f.send();f.respond(true,{id:'b'.repeat(24)});await new Promise(setImmediate);f.respond(false,{error:'offline'});await sending;
 assert.match(f.status.textContent,/Your report is saved/);assert.equal(f.submit.textContent,'Check report link');assert.equal(f.description.value,'Do not duplicate');
 await f.open();assert.equal(f.submit.disabled,false);assert.match(f.status.textContent,/Your report is saved/);
 sending=f.send();assert.equal(f.requests.filter(r=>r.options.method==='POST').length,1);f.respond(true,{url:'javascript:alert(1)'});await sending;assert.match(f.status.textContent,/Invalid GitHub issue link/);assert.equal(f.description.value,'Do not duplicate');
 sending=f.send();f.respond(true,{url:null});await new Promise(setImmediate);await new Promise(setImmediate);assert.equal(f.requests.at(-1).path,`/api/bug-reports/${'b'.repeat(24)}/status`);f.respond(true,{url:'https://github.com/OpenRotMG/Open-RotMG-Server/issues/529'});await sending;
 assert.equal(f.requests.filter(r=>r.options.method==='POST').length,1);assert.equal(f.status.children[0].href,'https://github.com/OpenRotMG/Open-RotMG-Server/issues/529');
});
test('screenshot failure is explicit and never submits a pretend image',async()=>{
 const f=fixture();f.failCapture();await f.open();assert(f.submit.disabled);assert(f.image.hidden);assert.match(f.status.textContent,/Screenshot failed: frame unavailable/);await f.send();assert.equal(f.requests.length,0);
});
