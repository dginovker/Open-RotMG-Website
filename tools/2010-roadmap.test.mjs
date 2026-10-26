import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCatalogue, countChecks} from '../public/restoration/2010/catalogue.js';
import {validateRoadmap, restorationStage} from '../public/restoration/2010/roadmap.js';
const load = () => JSON.parse(readFileSync(new URL('../public/restoration/2010/catalogue.json', import.meta.url)));
const data = load(), leaves = validateCatalogue(data), areas = validateRoadmap(data, leaves);

test('seven player-facing areas retain every technical check and thirty concrete requirements', () => {
  assert.equal(areas.length, 7);
  const assigned = areas.flatMap(area => area.leaves.map(leaf => leaf.id));
  assert.equal(assigned.length, leaves.length);
  assert.equal(new Set(assigned).size, leaves.length);
  assert.equal(areas.reduce((count, area) => count + area.requirements.length, 0), 30);
  for (const area of areas) {
    assert.ok(area.leaves.length > 0);
    assert.equal(restorationStage(data, area.leaves, 'original'), 'Needs research');
    for (const row of area.requirements) assert.equal(restorationStage(data, row.leaves, 'original'), 'Needs research');
  }
});

test('tutorial geometry, lesson flow, encounter timing, rewards and whole-game coverage have independent blocking result keys', () => {
  for (const id of ['tutorial-layout','tutorial-lessons','tutorial-encounters','tutorial-rewards-exit','restoration-coverage']) {
    const leaf = leaves.find(leaf => leaf.id === id);
    assert.ok(leaf && leaf.unknowns.length > 0);
    assert.equal(leaf.confidence, 'unknown');
    const probe = load();
    for (const other of leaves.filter(other => other.id !== id)) probe.results[other.id + '@original'] = {functional:'passed',historical:'verified',evidence:[]};
    assert.equal(countChecks(probe, leaves, 'original').complete, false);
    assert.equal(restorationStage(probe, [leaf], 'original'), 'Needs research');
  }
  assert.ok(areas[0].requirements.some(row => row.checks.includes('object-0823-when-close')));
  assert.ok(areas[0].requirements.some(row => row.checks.includes('system-tutorial-entry')));
});

for (const [name, mutate, message] of [
  ['missing area', d => d.roadmap.pop(), /restoration areas/],
  ['missing requirement', d => d.roadmap[0].requirements.pop(), /end-to-end/],
  ['unknown check', d => d.roadmap[0].requirements[0].checks.push('nonexistent'), /Missing restoration check/],
  ['duplicate check', d => d.roadmap[0].requirements[0].checks.push('tutorial-layout'), /Incomplete restoration requirement/],
  ['empty historical target', d => {d.roadmap[0].requirements[0].target='';}, /Incomplete restoration requirement/],
  ['manual green status', d => {d.roadmap[0].requirements[0].stage='Restored';}, /manual restoration status/],
  ['missing current difference', d => {delete d.roadmap[0].current;}, /Incomplete restoration area/],
]) test(`roadmap rejects ${name} without silently dropping coverage`, () => {
  const probe = load(); mutate(probe);
  assert.throws(() => validateRoadmap(probe, validateCatalogue(probe)), message);
});

test('implementation and execution cannot skip research; Restored requires exact historical acceptance', () => {
  const probe = load(), leaf = structuredClone(leaves.find(leaf => leaf.id === 'tutorial-layout'));
  assert.throws(() => restorationStage(probe, [], 'original'), /empty restoration/);
  leaf.implementation = 'present';
  probe.results[leaf.id+'@original']={functional:'passed',historical:'unresolved',evidence:[]};
  assert.equal(restorationStage(probe, [leaf], 'original'), 'Needs research');
  probe.questions={global:[],categories:{[leaf.domain]:[]},variants:{original:[],repaired:[]}};leaf.unknowns=[];
  assert.equal(restorationStage(probe, [leaf], 'original'), 'Needs verification');
  leaf.implementation='missing';
  assert.equal(restorationStage(probe, [leaf], 'original'), 'Ready to implement');
  leaf.implementation='present';probe.results[leaf.id+'@original'].historical='verified';
  assert.equal(restorationStage(probe, [leaf], 'original'), 'Restored');
  assert.equal(restorationStage(probe, [leaf], 'repaired'), 'Needs verification');
  probe.questions.global.push('Unresolved provenance');
  assert.equal(restorationStage(probe, [leaf], 'original'), 'Needs research');
});
