import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as hiscores from '../public/hiscores/app.js';
const {boards,ranked}=hiscores;
test('living fame keeps existing board links and labels the living-only metric',async()=>{
 assert.equal(boards.base_fame.title,'Living fame');
 assert.equal(boards.base_fame.description,'Highest fame of an alive character per account.');
 const index=await readFile(new URL('../public/hiscores/index.html',import.meta.url),'utf8');
 assert.match(index,/href="\?board=base_fame">Living fame<\/a>/);
 assert.ok(!index.includes('Base fame'));
});
test('star count uses the same stable ranks and rejects missing or invalid scores',async()=>{
 assert.equal(boards.stars.title,'Stars');
 const players=[{account:3,name:'Nova',stars:0},{account:2,name:'Lyra',stars:6},{account:1,name:'Orion',stars:6}];
 assert.deepEqual(ranked(players,'stars').map(p=>[p.account,p.rank,p.stars]),[[1,1,6],[2,1,6],[3,3,0]]);
 for(const stars of [undefined,-1,1.5,NaN])assert.throws(()=>ranked([{account:1,name:'Bad',stars}],'stars'),/Malformed/);
 const index=await readFile(new URL('../public/hiscores/index.html',import.meta.url),'utf8');assert.match(index,/href="\?board=stars">Stars<\/a>/);
});
test('quests completed board is linked and ranks the server quest total',async()=>{
 assert.deepEqual(ranked([{account:1,name:'Orion',quests:2},{account:2,name:'Lyra',quests:9}],'quests').map(p=>[p.account,p.rank]),[[2,1],[1,2]]);
 assert.match(await readFile(new URL('../public/hiscores/index.html',import.meta.url),'utf8'),/href="\?board=quests">Quests completed<\/a>/);
});
test('one account per row, stable competition ties and no mutating sort',()=>{
 const players=[{account:3,name:'Third',base_fame:10},{account:2,name:'Second',base_fame:10},{account:1,name:'First',base_fame:20}];
 assert.deepEqual(ranked(players,'base_fame').map(p=>[p.account,p.rank]),[[1,1],[2,2],[3,2]]);
 assert.equal(players[0].account,3);assert.throws(()=>ranked(players,'wallet'),/Unknown/);
 assert.throws(()=>ranked([{account:1,name:'Bad',base_fame:-1}],'base_fame'),/Malformed/);
 assert.throws(()=>ranked([players[0],players[0]],'base_fame'),/Malformed/);
});
test('collection sorts names naturally, groups missing items and uses first-obtained dates without mutation',()=>{
 const items=[{id:9,name:'Sword 10'},{id:4,name:'sword 2'},{id:8,name:'A Wand'},{id:5,name:'a wand'}];
 const found=new Map([[9,0],[8,200]]),original=structuredClone(items),dates=[...found];
 const ids=mode=>hiscores.collectionOrder(items,found,mode).map(i=>i.id);
 assert.deepEqual(ids('name'),[5,8,4,9]);
 assert.deepEqual(ids('missing'),[5,4,8,9]);
 assert.deepEqual(ids('recent'),[8,9,5,4]);
 assert.deepEqual(items,original);assert.deepEqual([...found],dates);
 found.set(5,200);assert.deepEqual(ids('recent'),[5,8,9,4]);
 assert.deepEqual(hiscores.collectionOrder([],new Map(),'recent'),[]);
 assert.deepEqual(hiscores.collectionOrder(items,new Map(),'missing').map(i=>i.id),[5,8,4,9]);
 for(const mode of ['unknown','__proto__'])assert.throws(()=>ids(mode),/Unknown collection sort/);
});
test('current drop sprites are unique, named, in the exact bounded atlas',async()=>{
 const items=JSON.parse(await readFile(new URL('../public/hiscores/items.json',import.meta.url),'utf8'));
 assert.equal(items.length,827);assert.equal(new Set(items.map(i=>i.id)).size,items.length);
 for(const id of [0xa32,0xa3a,0xa6a,0xa80,0xc10,0x131e]) assert.ok(items.some(item=>item.id===id),`missing drop sprite ${id.toString(16)}`);
 const png=await readFile(new URL('../public/hiscores/items.png',import.meta.url));assert.equal(png.readUInt32BE(16),320);assert.equal(png.readUInt32BE(20),672);
 for(const item of items){assert.ok(item.name);assert.ok(item.x>=0&&item.x+16<=320&&item.y>=0&&item.y+16<=672);}
 const app=await readFile(new URL('../public/hiscores/app.js',import.meta.url),'utf8');assert.ok(!app.includes('innerHTML'));assert.match(app,/className = found.has/);
});
