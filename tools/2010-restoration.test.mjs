import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateCatalogue, validateSource, expandCatalogue, inventory, signature, inventorySignature, countChecks, filterChecks, variantBinding, leafState, blockers} from '../public/restoration/2010/catalogue.js';
import {mountCatalogue} from '../public/restoration/2010/app.js';
import {validateCatalogue as validate2012} from '../public/restoration/catalogue.js';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const catalogue = () => JSON.parse(read('public/restoration/2010/catalogue.json'));
const digest = value => createHash('sha256').update(value).digest('hex');
const baseline = catalogue(), baselineLeaves = validateCatalogue(baseline);
const paralyzingRefs = ['impl-paralyzing-tests', 'impl-paralyzing-native'];
const paralyzingIds = ['object-0a64-activation-1', 'object-0a65-activation-1', 'condition-14-wire', 'condition-14-lifecycle', 'combat-collision-matrix'];
const woodenRefs = ['impl-wooden-tests', 'impl-wooden-native'];
const woodenIds = ['object-0a08-activation-1', 'condition-7-wire', 'condition-7-lifecycle', 'combat-collision-matrix'];
// Reverse only this increment so earlier freeze hashes still test their exact original surfaces.
const beforeWooden = structuredClone(baseline);
for (const ref of woodenRefs) delete beforeWooden.sources[ref];
for (const row of beforeWooden.systems) {
  if (['condition-7-wire', 'condition-7-lifecycle'].includes(row.id)) {
    row.implementation = 'not-inspected'; row.implementationSources = [];
    row.check = row.id.endsWith('-wire')
      ? 'Roundtrip index 7 and mask 64; damage/set-condition bytes versus stat29 mask, duration255/256 narrowing.'
      : 'Apply/refresh shorter and longer, exact expiry with shot/heal, transfer/death/reconnect and stacked sources; trace authoritative state.';
    row.unknowns = ['Authoritative application, expiry, stacking and full native acceptance remain Unknown.'];
  }
  if (row.id === 'combat-collision-matrix') {
    row.check = row.check.slice(0, row.check.indexOf(' Wooden0a08 continuing Shield'));
    row.unknowns.pop();
    row.implementationSources = row.implementationSources.filter(ref => !woodenRefs.includes(ref));
  }
}
const beforeWoodenLeaves = expandCatalogue(beforeWooden).map(row => row.id === woodenIds[0]
  ? {...row, implementation: 'missing', implementationSources: ['impl-world']} : row);
const counts = rows => rows.reduce((out, row) => (out[row.kind] = (out[row.kind] ?? 0) + 1, out), {});

test('July100 exact member sets and every ordered occurrence/parameter match the independently derived original inventory', () => {
  assert.equal(digest(JSON.stringify(inventory(baseline))), 'b22e6751e359fd0d3e034e55082e24472459f63d2501b70c7936f4d60792ea7d');
  assert.equal(signature(inventory(baseline)), inventorySignature);
  assert.deepEqual(counts(baseline.members), {Projectile:41, Player:7, Character:170, Container:4, Portal:6, Equipment:161, GameObject:120, Wall:19, Ground:115});
  assert.deepEqual(Object.fromEntries(Object.entries(baseline.occurrences).map(([family, rows]) => [family, rows.length])), {behavior:779, projectile:259, activation:147, loot:723});
  assert.equal(new Set(baseline.occurrences.behavior.map(row => row.name)).size, 33);
  assert.equal(baseline.occurrences.activation.filter(row => row.path === 'Activate').length, 52);
  assert.equal(baseline.occurrences.activation.filter(row => row.path === 'ActivateOnEquip').length, 94);
  assert.equal(baseline.occurrences.activation.filter(row => row.path === 'Projectile/ActivateOnEquip').length, 1);
  assert.equal(baseline.occurrences.loot.filter(row => row.item === null).length, 4);
  assert.equal(baseline.members.filter(m => m.fields.some(f => f[0] === 'Enemy')).length, 184);
  assert.equal(baselineLeaves.filter(leaf => leaf.template === 'attribute-qa').length, 779);
  assert.equal(baselineLeaves.filter(leaf => leaf.template === 'shoot-binding').length, 181);
  assert.equal(baselineLeaves.filter(leaf => leaf.template === 'xp-source').length, 196);
  assert.equal(baseline.members.filter(m => /^object-08/.test(m.id)).length,27);
  assert.equal(baseline.members.reduce((n,m)=>n+(m.audio?.length??0),0),565);
  assert.equal(baseline.systems.length,223);
  assert.equal(baselineLeaves.length, 10888);
  assert.equal(new Set(baselineLeaves.map(leaf => leaf.id)).size, 10888);
});

test('class starts/caps/growth bounds and twelve slot/loadout positions are independent leaves', () => {
  for (const member of baseline.members.filter(m => m.kind === 'Player')) {
    const rows = baselineLeaves.filter(leaf => leaf.group === member.id);
    for (const template of ['start', 'cap']) assert.equal(rows.filter(leaf => leaf.template === template).length, 8);
    assert.equal(rows.filter(leaf => leaf.template === 'growth').length, 16);
    assert.equal(rows.filter(leaf => leaf.template === 'slot').length, 24);
  }
});

test('ordinary class journeys bind each Player and cannot pass sibling classes or variants', () => {
  const journeys = baselineLeaves.filter(leaf => leaf.id.endsWith('-journey'));
  assert.equal(journeys.length, 7);
  assert.equal(baselineLeaves.some(leaf => leaf.id === 'class-journeys'), false);
  for (const member of baseline.members.filter(member => member.kind === 'Player')) {
    const leaf = journeys.find(leaf => leaf.group === member.id), binding = JSON.parse(leaf.binding);
    assert.equal(binding.class, member.id);
    assert.deepEqual(binding.slots, member.SlotTypes);
    assert.deepEqual(binding.loadout, member.Equipment);
    assert.equal(binding.ability.id, 'object-' + Number(member.Equipment[1]).toString(16).padStart(4, '0'));
    assert.deepEqual(binding.ability.actions, baseline.occurrences.activation.filter(row => row.owner === binding.ability.id));
  }
  const wizard = JSON.parse(journeys.find(leaf => leaf.group === 'object-030e').binding);
  assert.ok(wizard.startingItemRepairs.some(repair => repair.field === 'MpCost' && repair.original === '0' && repair.repaired === '40'));
  const d = catalogue();
  d.sources['fixture-test'] = {...d.sources['impl-world'], mode:'test'};
  d.results['object-030e-journey@original'] = {functional:'passed', historical:'unresolved', evidence:['fixture-test']};
  const leaves = validateCatalogue(d).filter(leaf => leaf.id.endsWith('-journey'));
  assert.equal(countChecks(d, leaves, 'original').functional.passed, 1);
  for (const leaf of leaves) assert.equal(leafState(d, leaf, 'original').functional, leaf.group === 'object-030e' ? 'passed' : 'not-run');
  assert.equal(countChecks(d, leaves, 'repaired').functional.passed, 0);
  d.results['class-journeys@original'] = d.results['object-030e-journey@original'];
  assert.throws(() => validateCatalogue(d), /Stale\/orphan/);
});

test('historical claims carry the existing typed period/comparator citations', () => {
  const leaf = id => baselineLeaves.find(row => row.id === id);
  assert.ok(leaf('system-xp-sharing').sources.includes('tig'));
  for (const facet of ['client', 'wire', 'lifecycle']) assert.ok(leaf('condition-18-' + facet).sources.includes('test101'));
  for (const source of ['test100', 'gamezplay', 'build104']) assert.ok(leaf('system-closure').sources.includes(source));
  assert.equal(baseline.sources.test101.kind, 'contemporary-testing');
  assert.equal(baseline.sources.tig.kind, 'earlier/later-comparator');
  assert.equal(baseline.sources.build104.kind, 'earlier/later-comparator');
  assert.equal(baseline.sources.gamezplay.kind, 'earlier/later-comparator');
  assert.equal(baseline.sources.gamezplay.url, 'https://gamezplay.blogspot.com/2010/07/realm-of-mad-god-flash-video-game.html');
  assert.match(baseline.sources.gamezplay.qualification, /2010-07-18.*Predates July26.*not an authenticated/);
  assert.match(baseline.sources.gamezplay.selector, /25,000.*50 Skull Shrines/);
});

test('original sign/tooltip selectors and0823 WhenClose survive beyond the scalar projection', () => {
  for (const [tag, count] of [['Text',16], ['Description',168], ['StatDescription',79]]) {
    const leaves = baselineLeaves.filter(leaf => leaf.template === 'presentation' && leaf.valuePath === tag);
    assert.equal(leaves.length, count);
    assert.ok(leaves.every(leaf => leaf.selector.endsWith('/' + tag) && leafState(baseline, leaf, 'original').functional === 'not-run'));
  }
  const sign = baseline.members.find(member => member.id === 'object-0823');
  assert.deepEqual(sign.presentation, ['Text']);
  assert.deepEqual(sign.whenClose, {radius:'3', boxes:[['0x0000ff',['614','510','40','40']],['0x00ff00',['746','366','40','40']]]});
  const leaf = baselineLeaves.find(leaf => leaf.id === 'object-0823-when-close');
  assert.deepEqual(JSON.parse(leaf.binding), sign.whenClose);
  assert.equal(leaf.selector, 'Objects/Object[@type=0x0823]/WhenClose');
  assert.match(leaf.unknowns.join(' '), /consumer execution and historical live use are Unknown/);
  assert.match(baselineLeaves.find(leaf => leaf.id === 'overlay-loot').expected, /0807 distance <= 1/);
  assert.ok(baseline.members.every(member => !member.fields.some(field => ['Text','Description','StatDescription'].includes(field[0]))));
});

test('presentation and proximity omissions fail explicit original-surface guards before the projection digest', () => {
  for (const tag of ['Text','Description','StatDescription']) {
    const d = catalogue(), member = d.members.find(member => member.presentation?.includes(tag));
    member.presentation = member.presentation.filter(value => value !== tag);
    assert.throws(() => validateCatalogue(d), new RegExp('Missing original ' + tag + ' presentation coverage'));
  }
  const d = catalogue(); delete d.members.find(member => member.id === 'object-0823').whenClose;
  assert.throws(() => validateCatalogue(d), /Missing original WhenClose coverage/);
  const wrongOwner = catalogue(), sign = wrongOwner.members.find(member => member.id === 'object-0823');
  wrongOwner.members[0].whenClose = sign.whenClose; delete sign.whenClose;
  assert.throws(() => validateCatalogue(wrongOwner), /Missing original WhenClose coverage/);
  const reversed = catalogue(); reversed.members.find(member => member.id === 'object-0823').whenClose.boxes.reverse();
  assert.throws(() => validateCatalogue(reversed), /binding mismatch/);
});

test('duplicates, absences, whitespace, compound conditions and corrected values are preserved', () => {
  const cube = baseline.occurrences.projectile.filter(row => row.owner === 'object-0237');
  assert.deepEqual(cube.map(row => row.attrs.id), ['0', '0']);
  const sprite = baseline.occurrences.behavior.filter(row => row.owner === 'object-022b' && row.name === 'Reproduce');
  assert.ok(sprite.some(row => row.attrs.childId === 'Sprite Child' && !Object.hasOwn(row.attrs, 'cooldown')));
  assert.equal(baseline.members.find(m => m.id === 'object-0208').name, 'Juvenile White Dragon ');
  assert.ok(baselineLeaves.some(leaf => leaf.group === 'object-0207' && leaf.unknowns.some(question => question.includes('No exact object-name match'))));
  const projectile = owner => baseline.occurrences.projectile.find(row => row.owner === owner).fields;
  assert.equal(projectile('object-0a86').find(f => f[0] === 'ObjectId')[1], 'Red Fire');
  assert.equal(projectile('object-0a87').find(f => f[0] === 'ObjectId')[1], 'Green Magic');
  assert.equal(baseline.members.find(m => m.id === 'object-0666').fields.find(f => f[0] === 'MaxHitPoints')[1], '200');
  assert.equal(baseline.occurrences.loot.filter(row => row.owner === 'object-0221' && row.item === '0707').length, 3);
  assert.deepEqual(baseline.occurrences.activation.filter(row => row.owner === 'object-0a5b').map(row => row.name), ['HealNova','RemoveNegativeConditions']);
  assert.deepEqual(baseline.occurrences.activation.filter(row => row.owner === 'object-0a5a' && row.path === 'Activate').map(row => row.name), ['Teleport','ConditionEffectSelf']);
  assert.deepEqual(baseline.members.find(m => m.id === 'object-0a55').fields.filter(f => f[0] === 'ConditionEffect').map(f => [f[1], f[2].duration]), [['Healing','20'],['Damaging','20']]);
});

test('all17 consumables and five unknown-acquisition items stay included, never excluded', () => {
  assert.equal(baseline.members.filter(m => m.kind === 'Equipment' && m.fields.some(f => f[0] === 'Consumable')).length, 17);
  const uncertain = baseline.members.filter(m => m.kind === 'Equipment' && m.availability.includes('no declared'));
  assert.deepEqual(uncertain.map(m => m.id).sort(), ['object-0a38','object-0a6e','object-0a74','object-0a77','object-0a7f']);
  for (const m of uncertain) assert.ok(baselineLeaves.some(leaf => leaf.group === m.id && leaf.id.endsWith('-placement') && leaf.binding.includes('availability unresolved')));
});

test('six dungeon contracts have independent access, roster, geometry, patterns, rewards, exits, retirement and multiplayer gates', () => {
  assert.equal(baseline.dungeons.length, 6);
  for (const dungeon of baseline.dungeons) {
    assert.equal(baseline.systems.filter(row => row.id.startsWith('dungeon-' + dungeon.id + '-')).length, 9);
    for (const member of dungeon.roster) assert.ok(baselineLeaves.some(leaf => leaf.group === 'object-' + member));
  }
  const keys = new Set(baseline.dungeons.map(d => d.key).filter(Boolean));
  assert.equal(keys.size, 5);
  assert.equal(baseline.occurrences.loot.filter(row => keys.has(row.item)).length, 13);
  assert.equal(baseline.dungeons.find(d => d.id === 'sprite').key, null);
});

for (const [label, mutate, pattern] of [
  ['wrong target', d => {d.target = 'calendar-2010';}, /target/],
  ['bad member type', d => {d.members[0].kind = 42;}, /member/],
  ['duplicate member', d => {d.members[1].id = d.members[0].id;}, /duplicate/],
  ['replaced identity at same count', d => {d.members[0].id = 'object-ffff';}, /binding mismatch/],
  ['missing occurrence', d => d.occurrences.behavior.pop(), /inventory/],
  ['missing non-DATA system', d => d.systems.pop(), /non-DATA/],
  ['changed occurrence operands', d => {d.occurrences.behavior[0].attrs.range = '999';}, /binding mismatch/],
  ['reordered occurrence', d => d.occurrences.behavior.reverse(), /owner\/order/],
  ['duplicate occurrence', d => {d.occurrences.behavior[1] = structuredClone(d.occurrences.behavior[0]);}, /owner\/order/],
  ['orphan occurrence', d => {d.occurrences.loot[0].owner = 'object-ffff';}, /owner\/order/],
  ['missing item reference', d => {d.occurrences.loot[0].item = 'ffff';}, /loot reference/],
  ['missing visual reference', d => {d.occurrences.projectile[0].fields[0][1] = 'not-a-visual';}, /visual reference/],
  ['bad scalar type', d => {d.members[0].fields = [['Size', 42, {}]];}, /member/],
  ['bad attribute type', d => {d.occurrences.behavior[0].attrs.range = 9;}, /parameters/],
  ['missing source', d => {d.templates.identity.sources = ['absent'];}, /source reference/],
  ['own source in historical field', d => {d.templates.identity.sources = ['impl-world'];}, /mixed source/],
  ['historical source in implementation field', d => {d.templates.identity.implementationSources = ['july'];}, /mixed source/],
  ['missing expected', d => {d.templates.identity.expected = '';}, /expected\/check/],
  ['missing concrete check', d => {delete d.templates.identity.check;}, /expected\/check/],
  ['missing confidence', d => {delete d.templates.identity.confidence;}, /confidence/],
  ['invalid implementation status', d => {d.templates.identity.implementation = 'restored';}, /status/],
  ['template pass', d => {d.templates.identity.passed = true;}, /cannot pass instances/],
  ['wrong condition namespace', d => {d.conditions.push('Stasis');}, /Wrong-era conditions/],
  ['wrong packet namespace', d => {d.packetIds.push(30);}, /Wrong-era protocol/],
  ['modern Tick body', d => {d.systems.find(s => s.id === 'packet-13').expected = 'tickId,tickTime,statuses';}, /Wrong-era protocol body/],
  ['modern teleport result', d => {d.systems.find(s => s.id === 'packet-29').expected = 'success flag,coordinates';}, /Wrong-era protocol body/],
  ['missing category gates', d => {delete d.questions.categories.combat;}, /questions/],
  ['missing variant gates', d => {delete d.questions.variants.repaired;}, /questions/],
]) test(`July catalogue rejects ${label}`, () => { const d = catalogue(); mutate(d); assert.throws(() => validateCatalogue(d), pattern); });

test('source kinds, confidence, URL hygiene and code pins cannot manufacture historical evidence', () => {
  for (const url of ['javascript:alert(1)', 'file:///home/private', 'https://user:pass@example.test/', 'https://example.test/?token=secret', 'https://example.test/?guid=private', 'https://example.test/.local/receipt.json', 'https://github.com/example/repo/blob/main/code.rs']) {
    const source = {...baseline.sources.july, url}; assert.throws(() => validateSource(source, 'probe'), /source URL|code source/);
  }
  for (const ref of ['impl-world', 'impl-inventory-drop', 'impl-player-teleport', 'impl-priest-heals', 'impl-priest-starter-native']) for (const kind of ['artifact', 'contemporary-production', 'contemporary-testing', 'earlier/later-comparator']) assert.throws(() => validateSource({...baseline.sources[ref], kind, mode: undefined}, 'probe'), /not history/);
  assert.throws(() => validateSource({...baseline.sources.july, confidence: 'certain'}, 'probe'), /confidence/);
  assert.throws(() => validateSource({...baseline.sources['impl-world'], url: baseline.sources['impl-world'].url.replace('128bd1de03aaace23381b8705488494490e9061f', 'a'.repeat(40))}, 'probe'), /Wrong implementation pin/);
  for (const source of Object.values(baseline.sources)) validateSource(source, 'valid');
});

test('reviewed Drop19 evidence leaves the frozen audit and broad inventory acceptance intact', () => {
  const d = catalogue(), leaf = baselineLeaves.find(row => row.id === 'system-inventory');
  assert.equal(d.implementationPin, '128bd1de03aaace23381b8705488494490e9061f');
  assert.equal(d.sources['impl-inventory-drop'].mode, 'native');
  assert.match(d.sources['impl-inventory-drop'].url, /95dfd8cdfbb6de907d758c4c72073b338a6135c3/);
  assert.equal(leaf.implementation, 'partial');
  assert.equal(baselineLeaves.find(row => row.id === 'packet-19').expected, 'objectId i32, slotId u8, item type i16; exactly 7 body bytes.');
  for (const variant of ['original', 'repaired']) {
    assert.equal(leafState(d, leaf, variant).functional, 'not-run');
    assert.equal(leafState(d, leaf, variant).historical, 'unresolved');
  }
  d.implementationPin = '95dfd8cdfbb6de907d758c4c72073b338a6135c3';
  assert.throws(() => validateCatalogue(d), /implementation pin/);
});

test('reviewed teleport evidence preserves unresolved historical and full-game gates', () => {
  const d = catalogue(), source = d.sources['impl-player-teleport'];
  assert.equal(d.implementationPin, '128bd1de03aaace23381b8705488494490e9061f');
  assert.equal(source.mode, 'native');
  assert.match(source.url, /143b32856987c5d494e9788ec8a7dad1f567ff84/);
  assert.match(source.qualification, /reconstruction; reconnect resets server cooldown/);
  for (const [id, bytes] of [['packet-18', 12], ['packet-28', 4], ['packet-29', 0]]) {
    const leaf = baselineLeaves.find(row => row.id === id);
    assert.equal(leaf.implementation, 'present');
    assert.match(leaf.expected, new RegExp('exactly ' + bytes + ' body bytes'));
    assert.deepEqual(leaf.implementationSources, ['impl-player-teleport']);
  }
  const leaf = baselineLeaves.find(row => row.id === 'system-teleport');
  assert.equal(leaf.implementation, 'partial');
  for (const variant of ['original', 'repaired']) {
    assert.equal(leafState(d, leaf, variant).functional, 'not-run');
    assert.equal(leafState(d, leaf, variant).historical, 'unresolved');
    assert.equal(countChecks(d, baselineLeaves, variant).complete, false);
  }
});

test('ordinary Priest heals do not pass deferred compounds or unrelated class journeys', () => {
  const d = catalogue();
  assert.equal(d.sources['impl-priest-heals'].mode, 'test');
  assert.equal(d.sources['impl-priest-starter-native'].mode, 'native');
  assert.match(d.sources['impl-priest-heals'].url, /ff285b5e970a2cd9f71b71c68b388d41cf4b5203/);
  for (const owner of ['0a31', '0a32', '0a33', '0a3f', '0a5b']) {
    const leaf = baselineLeaves.find(row => row.id === 'object-' + owner + '-activation-0');
    assert.equal(leaf.implementation, ['0a31', '0a32', '0a33'].includes(owner) ? 'present' : 'missing');
    assert.equal(leaf.implementationSources.includes('impl-priest-starter-native'), owner === '0a31');
    for (const variant of ['original', 'repaired']) {
      assert.equal(leafState(d, leaf, variant).functional, 'not-run');
      assert.equal(leafState(d, leaf, variant).historical, 'unresolved');
    }
  }
  for (const leaf of baselineLeaves.filter(row => row.id.endsWith('-journey'))) {
    assert.equal(leaf.implementation, 'partial');
    assert.equal(leaf.implementationSources.includes('impl-priest-starter-native'), leaf.group === 'object-0310');
  }
});

test('prediction repair citations separate executed reconstruction from historical and ordinary-play claims', () => {
  const pin = '376b6425eb402de2271950e142866227b874534a';
  const tests = baseline.sources['impl-prediction-repair-tests'], native = baseline.sources['impl-prediction-repair-native'];
  for (const [source, mode, file] of [[tests, 'test', 'prediction_runtime_tests.rs'], [native, 'native', 'world.rs']]) {
    assert.equal(source.kind, 'implementation'); assert.equal(source.mode, mode);
    assert.equal(source.url, `https://github.com/dginovker/Open-RotMG-Server/blob/${pin}/src/build100/${file}`);
    assert.doesNotMatch(JSON.stringify(source), /\.local\/|\/home\/|guid=|credential|authenticated.?trace|profile\/|\.db\b/i);
    validateSource(source, 'prediction');
    for (const kind of ['artifact', 'contemporary-production', 'contemporary-testing', 'earlier/later-comparator']) {
      assert.throws(() => validateSource({...source, kind, mode: undefined}, 'prediction'), /not history/);
    }
    assert.throws(() => validateSource({...source, url: source.url.replace(pin, 'a'.repeat(40))}, 'prediction'), /Wrong implementation pin/);
  }
  assert.match(tests.selector, /prediction_runtime_known_living_enemy_self_only_drop_then_make/);
  assert.match(tests.selector, /prediction_actor_actual_sql_begin_failure_preserves_candidate_view_and_outputs/);
  assert.match(tests.selector, /prediction_actor_postcommit_full_or_closed_queue_detaches_no_delivery_or_replay/);
  for (const pattern of [/13 new.*334 total.*15 qualification guards/, /SQL begin failure and dispatcher fatality/, /no candidate install\/publication before commit/, /no Character writes/, /peer isolation/, /drained requests/, /full\/closed postcommit queues/]) assert.match(tests.qualification, pattern);
  for (const symbol of ['Room::repairable_enemy', 'Room::handle_at packet9', 'Room::publication']) assert.ok(native.selector.includes(symbol));
  for (const pattern of [/Unchanged repaired-client native acceptance only/, /PREPARED private Pirate HP20/, /prediction27\/Dead1 versus authoritative8 left HP12/, /visibility and collision.*peer untouched/, /real bow death occurred once/, /server-to-client-only 150ms WebSocket conditioning/, /Separately, actual public HTTPS\/WSS with normal Pirate HP5 and no relay/, /rejected quiver prediction56\/Dead1/, /HP121 and HP124.*MP100, XP1, inventories and generation1/, /Quivers remain unsupported and MP was not charged/, /Predicted rolls are not trusted and RNG is not synchronized/, /not double HP damage/, /not.*full Archer\/class acceptance/]) assert.match(native.qualification, pattern);
});

test('prediction repair stays scoped alongside the quiver increments without passing leaves', () => {
  const refs = ['impl-prediction-repair-tests', 'impl-prediction-repair-native'];
  const priorRefs = {'condition-1-client': [], 'condition-1-wire': [], 'condition-1-lifecycle': [], 'packet-9': ['impl-protocol'], 'combat-collision-matrix': ['impl-combat']};
  const scoped = baseline.systems.filter(row => row.implementationSources.some(ref => refs.includes(ref)));
  assert.deepEqual(scoped.map(row => row.id).sort(), Object.keys(priorRefs).sort());
  for (const row of scoped) {
    assert.equal(row.implementation, 'partial');
    assert.deepEqual(row.implementationSources, [...priorRefs[row.id], ...refs, ...(row.id === 'combat-collision-matrix' ? ['impl-iron-tests', 'impl-iron-native', ...paralyzingRefs, ...woodenRefs] : [])]);
    assert.deepEqual(row.sources, ['artifact']);
  }
  assert.equal(digest(JSON.stringify(beforeWooden.systems.filter(row => !Object.hasOwn(priorRefs, row.id) && !['condition-4-wire', 'condition-4-lifecycle', 'condition-14-wire', 'condition-14-lifecycle'].includes(row.id)))), '3b753f84ca58978520a1c43fe836a2373ad5259e082bd44d5c3918ac92fca9e9');
  const frozen = structuredClone(beforeWooden); delete frozen.sources; delete frozen.systems; delete frozen.roadmap;
  assert.equal(digest(JSON.stringify(frozen)), '8746920f0778d190e098747ca3edbe691ad593676811e0c9ceff8477a70e1b50');
  assert.equal(digest(JSON.stringify(Object.fromEntries(Object.entries(beforeWooden.sources).filter(([id]) => ![...refs, 'impl-quiver-tests', 'impl-quiver-native', 'impl-iron-tests', 'impl-iron-native', ...paralyzingRefs].includes(id))))), 'fc95d0b220e1d715f101985c59cca6ba66a3ff8da4a151042282ad5dad97c237');
  const roadmap = baseline.roadmap.map(area => ({...area, requirements: area.requirements.map(row => (area.id === 'combat' && ['Weapons, spells and projectiles', 'Conditions and their lifecycle'].includes(row.title)) || (area.id === 'multiplayer' && row.title === 'Identity, saves and world transitions') ? {...row, current: null} : row)}));
  assert.equal(digest(JSON.stringify(roadmap)), '63a4a090465819bdbf657dba0b64c84ed3c47f84cca1c56306e23f1c6366a2e6');
  const leaf = id => baselineLeaves.find(row => row.id === id);
  assert.match(leaf('condition-1-client').expected, /separate sticky client dead boolean.*without HP subtraction or local dictionary deletion/);
  assert.match(leaf('condition-1-client').check, /stat1 and stat29 do not clear.*bare same-ID Make10 fails.*self-only Drop11 then fresh Make10/);
  assert.match(leaf('condition-1-wire').expected, /exactly 13 body bytes: i32 target, u8 condition, u8 duration, i16 amount, u8 bullet, i32 source/);
  assert.match(leaf('condition-1-wire').check, /Distinguish enum1 from stat29 bitmask/);
  assert.match(leaf('condition-1-lifecycle').check, /not fabricated Dead expiry, refresh or stacking/);
  assert.equal(leaf('packet-9').expected, 'i32 target, u8 condition, u8 duration, i16 amount, u8 bullet, i32 source');
  assert.match(leaf('packet-9').check, /amount\/duration\/collision claims cannot damage, kill or authorize rewards/);
  assert.match(leaf('combat-collision-matrix').expected, /Dead\/Paused, faction, ProtectFromProjectiles, tile cover and Continues memory; Invisible is not projectile immunity/);
  assert.match(leaf('combat-collision-matrix').check, /Two aligned targets, owner\/observer, Invisible pre-existing hostile shot, repeated victim and recreated identity/);
  const quivers = ['object-0a61-activation-0', 'object-0a62-activation-0', 'object-0a63-activation-1', 'object-0a64-activation-1', 'object-0a65-activation-1'].map(leaf);
  assert.equal(quivers.length, 5);
  assert.deepEqual(quivers.map(row => row.implementation), ['partial', 'partial', 'partial', 'partial', 'partial']);
  assert.ok(quivers.every(row => row.name.endsWith(': Shoot')));
  assert.ok(baselineLeaves.filter(row => row.id.endsWith('-journey')).every(row => row.implementation === 'partial' && !row.implementationSources.some(ref => refs.includes(ref))));
  for (const variant of ['original', 'repaired']) {
    const totals = countChecks(baseline, baselineLeaves, variant);
    assert.deepEqual(totals.implementation, {present: 892, partial: 5603, missing: 1752, 'not-inspected': 2641});
    assert.deepEqual(totals.functional, {'not-run': 10888, passed: 0, failed: 0});
    assert.deepEqual(totals.historical, {unresolved: 10864, verified: 0, differences: 24});
    assert.equal(totals.complete, false);
  }
});

test('quiver citations are immutable typed implementation evidence with separate public and prepared scopes', () => {
  const pin = '0205427d7d7609047b07c728c651780222f766c6';
  const tests = baseline.sources['impl-quiver-tests'], native = baseline.sources['impl-quiver-native'];
  assert.equal(baseline.implementationPin, '128bd1de03aaace23381b8705488494490e9061f');
  for (const [source, mode, file] of [[tests, 'test', 'quiver_runtime_tests.rs'], [native, 'native', 'world.rs']]) {
    assert.equal(source.kind, 'implementation'); assert.equal(source.mode, mode);
    assert.equal(source.url, `https://github.com/dginovker/Open-RotMG-Server/blob/${pin}/src/build100/${file}`);
    assert.doesNotMatch(JSON.stringify(source), /\u2014|\.local\/|\/home\/|guid=|credential|profile\/|\.db\b/i);
    validateSource(source, 'quiver');
    assert.throws(() => validateSource({...source, mode: 'source-only'}, 'quiver'), /evidence mode/);
    assert.throws(() => validateSource({...source, url: source.url.replace(pin, 'a'.repeat(40))}, 'quiver'), /Wrong implementation pin/);
    for (const kind of ['artifact', 'contemporary-production', 'contemporary-testing', 'earlier/later-comparator']) assert.throws(() => validateSource({...source, kind, mode: undefined}, 'quiver'), /not history/);
  }
  for (const symbol of ['quiver_runtime_native_paid_shoot8_then_nonpaying_use15_original_repaired', 'quiver_runtime_shared_native_ids_wrap_retired_reuse_live_and_reserved_burst_collisions', 'quiver_actor_sql_begin_at_each_phase_and_write_at8_preserve_actual_prephase', 'quiver_transport_encrypted_split_coalesced_serial_awaited_replies_no_adjacency_or_deadlock']) assert.ok(tests.selector.includes(symbol));
  for (const pattern of [/23 new.*357 total.*15 real Cargo/, /cloned root RNG.*not ATK or claimed damage/, /non-paying Use15.*ephemeral Room\/avatar marker/, /no waiting for15/, /pending bow bursts/, /failure at15 preserves committed8\/payment/, /fatal StorageFailure.*output loss never refund or replay/, /whole positive-on-entry.*equality/, /post-AI collision.*next advance/, /not duration255\/256 boundary acceptance/, /reconstruction.*not recovered July server policy/]) assert.match(tests.qualification, pattern);
  for (const symbol of ['Room::handle_at', 'Room::use_ability', 'Room::advance_shore', 'Room::advance', 'Room::entity_wire_stats', 'Room::publication']) assert.ok(native.selector.includes(symbol));
  for (const pattern of [/Actual public HTTPS\/WSS, normal HP5.*no fixture or relay/, /one60MP.*no caster echo.*one peer arrow.*server66 versus native68/, /XP1->3 each/, /Insufficient MP emitted no8\/15/, /HP5 deaths do not prove surviving Slowed/, /PREPARED private HP500/, /Reinforced starter override paid80MP.*native87\/server75/, /3030ms\/3129ms.*not exact historical timing/, /acquisition was prepared, not earned/, /PREPARED HP80.*downstream-only150ms.*no payload, Origin or RNG rewrite/, /native87\/Dead1 versus server72 leftHP8/, /Drop11->fresh Make10 same ID\/current HP8\/mask8.*peer not reset/, /Earlier native78\/server87 real death and XP8 were retained/, /no favorable-roll reset/, /Player Slowed admission\/held-key behavior/, /history remains unresolved/]) assert.match(native.qualification, pattern);
});

test('two-quiver evidence stays frozen alongside the scoped Iron increment', () => {
  const refs = ['impl-quiver-tests', 'impl-quiver-native'];
  const scopedIds = ['object-0a61-activation-0', 'object-0a62-activation-0', 'condition-4-wire', 'condition-4-lifecycle'];
  const scoped = baselineLeaves.filter(row => row.implementationSources.some(ref => refs.includes(ref)));
  assert.deepEqual(scoped.map(row => row.id).sort(), [...scopedIds].sort());
  for (const leaf of scoped) {
    assert.equal(leaf.implementation, 'partial');
    assert.deepEqual(leaf.implementationSources, [...(leaf.id.startsWith('object-') ? ['impl-world'] : []), ...refs]);
  }
  // These digests freeze the pre-increment expanded surface, not just the inventory counts.
  assert.equal(digest(JSON.stringify(beforeWoodenLeaves.filter(row => ![...scopedIds, 'object-0a63-activation-1', ...paralyzingIds].includes(row.id)))), 'e40513b5c35e3ac9ad832726bc95c9705c4db8a1c81d60fc3cf8fc011a8fccd7');
  assert.equal(digest(JSON.stringify(scoped.map(({implementation, implementationSources, check, unknowns, ...row}) => row))), '56a9176ab72bda4e4295bfb1c20953f41719e1d2ac47809132b9a723fbcea9c8');
  assert.equal(digest(JSON.stringify(baselineLeaves.filter(row => row.id.endsWith('-journey')))), 'e4ada9b5a32ff09e32be427e6d9ae438fbd1310d686a40423ddb05d9148b5d71');
  const leaf = id => baselineLeaves.find(row => row.id === id);
  assert.equal(leaf('condition-4-client').implementation, 'not-inspected');
  assert.deepEqual(leaf('condition-4-client').implementationSources, []);
  for (const id of ['condition-4-wire', 'condition-4-lifecycle']) assert.equal(leaf(id).expected, 'Movement early-return .005 before Berserk.');
  assert.match(leaf('condition-4-wire').check, /Damage9 enum4\/duration3.*stat29 mask8.*does not accept duration255\/256/);
  assert.match(leaf('condition-4-lifecycle').check, /Enemy-only transient.*overwrites remaining3s, not max\/stack.*whole positive-on-entry.*equality clear.*next-advance.*unchanged attack\/state clocks.*cleanup/);
  assert.match(leaf('condition-4-lifecycle').unknowns.join(' '), /Player admission\/held-key effects.*historical policy remain Unknown/);
  for (const id of ['object-0a64-activation-1', 'object-0a65-activation-1']) assert.equal(leaf(id).implementation, 'partial');
  assert.deepEqual(baseline.results, {});
  for (const variant of ['original', 'repaired']) {
    const totals = countChecks(baseline, baselineLeaves, variant);
    assert.deepEqual(totals.functional, {'not-run': 10888, passed: 0, failed: 0});
    assert.deepEqual(totals.historical, {unresolved: 10864, verified: 0, differences: 24});
    assert.equal(totals.complete, false);
  }
  assert.equal(baseline.roadmap.length, 7);
  assert.equal(baseline.roadmap.reduce((n, area) => n + area.requirements.length, 0), 30);
  const combat = baseline.roadmap.find(area => area.id === 'combat').requirements;
  assert.match(combat.find(row => row.title === 'Weapons, spells and projectiles').current, /Tattered normal public native.*Reinforced, Iron, Steel and Golden PREPARED private.*not earned.*Other abilities\/projectiles and original server rules remain unverified/);
  assert.match(combat.find(row => row.title === 'Conditions and their lifecycle').current, /Enemy Slowed and Paralyzed are partial.*Tattered\/Reinforced\/Iron.*Steel\/Golden.*Public HP5 deaths do not prove duration.*Player conditions.*history.*full class journeys.*unverified/);
});

test('Iron citations pin executed tests and prepared native scope without historical or public acceptance', () => {
  const pin = 'a0370a1d72c235c893e4f2b603816c5a57322c0f';
  const tests = baseline.sources['impl-iron-tests'], native = baseline.sources['impl-iron-native'];
  for (const [source, mode, file] of [[tests, 'test', 'quiver_runtime_tests.rs'], [native, 'native', 'world.rs']]) {
    assert.equal(source.kind, 'implementation'); assert.equal(source.mode, mode);
    assert.equal(source.url, `https://github.com/dginovker/Open-RotMG-Server/blob/${pin}/src/build100/${file}`);
    assert.doesNotMatch(JSON.stringify(source), /\u2014|\.local\/|\/home\/|guid=|credential|profile\/|\.db\b/i);
    validateSource(source, 'iron');
    assert.throws(() => validateSource({...source, mode: 'source-only'}, 'iron'), /evidence mode/);
    assert.throws(() => validateSource({...source, url: source.url.replace(pin, 'a'.repeat(40))}, 'iron'), /Wrong implementation pin/);
    for (const kind of ['artifact', 'contemporary-production', 'contemporary-testing', 'earlier/later-comparator']) assert.throws(() => validateSource({...source, kind, mode: undefined}, 'iron'), /not history/);
  }
  for (const symbol of ['quiver_runtime_iron_native8_paid_once_and_continuing_two_targets', 'quiver_runtime_continues_damage9_nonretiring_presentation_not_native_acceptance', 'quiver_runtime_iron_shape_visual_dex_and_noncontinuing_wire_unchanged', 'quiver_runtime_iron_separate_contacts_reentry_repair_tombstones_replacement_and_later_payment', 'quiver_runtime_iron_cover_entry_order_ties_tangency_t0_and_expiry_before_contacts', 'quiver_runtime_iron_buffered_dead_skip_keeps_reservation_and_once_rewards', 'quiver_runtime_iron_both_actual_victims_slow_next_step_overwrite_expiry_mask_cleanup', 'quiver_actor_iron_advance_actual_character_write_failure_installs_no_candidate_or_output', 'quiver_transport_encrypted_split_coalesced_serial_awaited_replies_no_adjacency_or_deadlock']) assert.ok(tests.selector.includes(symbol));
  for (const pattern of [/365 July tests\/15 Cargo guards.*clippy\/fmt\/release/, /Equipped Iron0a63 only: root\/nested90-110, MP80, DEX\+2, Green Arrow09, Slowed3s\+Continues/, /a61\/a62 unchanged, a64\/a65 and ordinary Continues rejected/, /equipped container, not shared09/, /Paid8 rolls root RNG once; nonpaying15 acknowledges/, /SQL commit precedes install\/publication/, /stable Room numeric-ID reservations occur at discovery.*view repair, removal and earlier buffered kills until retirement/, /entry\/lower ID within unchanged bullet\/reward ordering.*only Iron bypasses static OccupySquare cover/, /Only continuing enemy Damage9 uses presentation bullet0.*owner\/target\/damage\/Slowed4-duration3.*funded IDs1..96\/peer Shoot stay real/, /duplicate HP\/effect\/rewards, RNG, post-hit ledger and SQL rollback, not all-native/, /reconstruction, not an original historical sentinel/, /creation lifetimes retire independently.*no synchronized-retirement\/delivery claim/]) assert.match(tests.qualification, pattern);
  for (const symbol of ['Room::handle_at packet8/9/15', 'Room::use_ability', 'Room::advance_shore', 'Room::advance', 'Room::entity_wire_stats', 'Room::repairable_enemy', 'Room::publication']) assert.ok(native.selector.includes(symbol));
  for (const pattern of [/PREPARED HP500.*a63 starter override, unchanged repaired SWF.*one80MP arrow.*distinct authoritative victims once.*mask8->explicit0 in both views/, /Both green arrows remained rendered after actual first Damage9 processing, before a later genuine native-only\/offscreen contact/, /not an additional authoritative or rendered peer hit/, /PREPARED HP100.*same paid bullet1.*twice.*Drop11\/fresh Make10 at HP100.*fresh second instance.*both contacts preceded actual106-damage backend death and XP10 once each/, /Post-backend-hit living\/Slowed\/nonempty-ledger native recontact remains unobserved; deterministic tests cover that ledger separately/, /No Iron relay or outcome-driven reset; external host reboots restarted volatile Rooms\/RNG without restoring saved progress/, /Private ordinary a61 paid-arrow\/death.*PREPARED a62 positive-bullet Damage9\/moving-Slowed expiry regressions passed at this pin/, /not earned Iron or historical production proof; no public Iron\/full Archer journey acceptance/, /Original SWF functional checks remain not-run; history unresolved/, /not an original sentinel.*lifetimes are independent.*without synchronized retirement or delivery guarantees/]) assert.match(native.qualification, pattern);
});

test('Iron evidence remains frozen alongside the five-leaf Steel/Golden increment', () => {
  const refs = ['impl-iron-tests', 'impl-iron-native'];
  const leaf = id => baselineLeaves.find(row => row.id === id);
  const changedIds = ['object-0a63-activation-1', 'combat-collision-matrix'];
  assert.deepEqual(baselineLeaves.filter(row => row.implementationSources.some(ref => refs.includes(ref))).map(row => row.id), changedIds);
  assert.equal(digest(JSON.stringify(beforeWoodenLeaves.filter(row => ![...changedIds, ...paralyzingIds].includes(row.id)))), 'e5377351941214d444eb3d66e020d77d58b6786cf0f38f3ffe6c1d803ab7338f');
  const iron = leaf(changedIds[0]), matrix = leaf(changedIds[1]);
  assert.equal(iron.implementation, 'partial');
  assert.equal(iron.valuePath, 'Activate');
  assert.ok(iron.name.endsWith(': Shoot'));
  assert.deepEqual(iron.implementationSources, ['impl-world', ...refs]);
  const {implementation, implementationSources, ...ironFixed} = iron;
  assert.equal(digest(JSON.stringify(ironFixed)), 'e67bea5f6bb68dcbcb024bc582be65940b7d3d8409530b5dd5fbc40981dd55de');
  for (const [id, hash] of [['object-0a61-activation-0', '7f97b89153ceebb0f99184f29319f2ea54c36f4ef981b3b9d6420a2025a65098'], ['object-0a62-activation-0', '47da829feabcd96804a07bdc67d3490da9b9bac74dc4c89110520e83e78d3027'], ['object-0a63-activation-0', '09a3f5b84184ef55c9d90d36c3f1ade089b3225fbc072e4e547794071436baad']]) assert.equal(digest(JSON.stringify(leaf(id))), hash);
  assert.equal(leaf('object-0a63-activation-0').valuePath, 'ActivateOnEquip');
  assert.deepEqual(JSON.parse(leaf('object-0a63-activation-0').binding).attributes, {stat: '28', amount: '2'});
  for (const id of ['object-0a64-activation-1', 'object-0a65-activation-1']) {
    assert.equal(leaf(id).implementation, 'partial');
    assert.deepEqual(leaf(id).implementationSources, ['impl-world', ...paralyzingRefs]);
  }
  assert.equal(matrix.implementation, 'partial');
  assert.deepEqual(matrix.implementationSources, ['impl-combat', 'impl-prediction-repair-tests', 'impl-prediction-repair-native', ...refs, ...paralyzingRefs, ...woodenRefs]);
  const {check, unknowns, implementationSources: matrixRefs, ...matrixFixed} = matrix;
  assert.equal(digest(JSON.stringify(matrixFixed)), '77f1b565d75d03818b5f096bb91c1845d61b23166aab82a0299bb8c3ec532652');
  assert.match(check, /Iron0a63 and Golden0a65.*stable Room numeric IDs at discovery through retirement.*view repair\/removal and earlier buffered kills.*entry then lower ID without global ordinary bullet\/reward reordering/);
  assert.match(check, /Only these continuing quivers bypass static OccupySquare cover.*presentation bullet0.*owner\/target\/damage\/effect.*Slowed4 or Paralyzed14, duration3.*funded IDs1..96 and peer Shoot remain unchanged/);
  assert.match(unknowns.join(' '), /recontacts preceded backend collision, not a post-hit living\/Slowed\/nonempty-ledger test/);
  assert.match(unknowns.join(' '), /later native-only\/offscreen contact, not an additional authoritative or rendered peer hit/);
  assert.match(unknowns.join(' '), /lifetimes retire independently.*no synchronized retirement or delivery guarantee.*not establish an original historical bullet0 sentinel/);
  assert.equal(digest(JSON.stringify(Object.fromEntries(Object.entries(beforeWooden.sources).filter(([id]) => ![...refs, ...paralyzingRefs].includes(id))))), 'b06180da12d36b61b8422d6df6743184a2e5a69794325c3ecc32e45511f1ee9e');
  // Mask only the approved prose fields; every other parsed data value stays frozen.
  const frozen = structuredClone(beforeWooden);
  for (const ref of [...refs, ...paralyzingRefs]) delete frozen.sources[ref];
  frozen.systems = frozen.systems.filter(row => !['condition-14-wire', 'condition-14-lifecycle'].includes(row.id));
  const collision = frozen.systems.find(row => row.id === matrix.id);
  collision.check = null; collision.unknowns = null;
  collision.implementationSources = collision.implementationSources.filter(ref => ![...refs, ...paralyzingRefs].includes(ref));
  for (const area of frozen.roadmap) for (const row of area.requirements) if (area.id === 'combat' && ['Weapons, spells and projectiles', 'Conditions and their lifecycle'].includes(row.title)) row.current = null;
  assert.equal(digest(JSON.stringify(frozen)), 'cb61ee9f532245f80c400579a3c56c25fb85771cf15da44a79bf41d2bb663259');
  assert.deepEqual(baseline.results, {});
  for (const variant of ['original', 'repaired']) {
    assert.deepEqual(countChecks(baseline, baselineLeaves, variant).functional, {'not-run': 10888, passed: 0, failed: 0});
    assert.deepEqual(countChecks(baseline, baselineLeaves, variant).historical, {unresolved: 10864, verified: 0, differences: 24});
    assert.equal(countChecks(baseline, baselineLeaves, variant).complete, false);
  }
});

test('Steel/Golden citations pin test versus prepared native evidence and preserve critical limits', () => {
  const pin = '56db1f589f082670b2eac22e7667dedbee9a8aa6';
  const [tests, native] = paralyzingRefs.map(ref => baseline.sources[ref]);
  for (const [source, mode, file, words] of [[tests, 'test', 'quiver_runtime_tests.rs', 160], [native, 'native', 'world.rs', 210]]) {
    assert.equal(source.kind, 'implementation'); assert.equal(source.mode, mode);
    assert.equal(source.url, `https://github.com/dginovker/Open-RotMG-Server/blob/${pin}/src/build100/${file}`);
    assert.ok(source.qualification.split(/\s+/).length <= words);
    assert.doesNotMatch(JSON.stringify(source), /\u2014|\.local\/|\/home\/|guid=|credential|profile\/|\.db\b/i);
    validateSource(source, 'paralyzing');
    assert.throws(() => validateSource({...source, mode: 'source-only'}, 'probe'), /evidence mode/);
    assert.throws(() => validateSource({...source, url: source.url.replace(pin, 'a'.repeat(40))}, 'probe'), /Wrong implementation pin/);
    for (const kind of ['artifact', 'contemporary-production', 'contemporary-testing', 'earlier/later-comparator']) assert.throws(() => validateSource({...source, kind, mode: undefined}, 'probe'), /not history/);
  }
  for (const symbol of ['quiver_runtime_steel_golden_original_repaired_shapes_dex_and_fail_closed', 'quiver_runtime_paralyzed_whole_entry_step_chase_return_wander_clocks_and_resume', 'quiver_runtime_paid_slow_and_paralyzed_refresh_independently_without_stacking_or_pausing', 'quiver_actor_iron_steel_golden_advance_begin_write_failure_installs_no_candidate_or_output', 'quiver_actor_golden_paid_separate_contacts_real_advisory_repair_preserves_paralysis_and_ledger', 'quiver_transport_encrypted_split_coalesced_serial_awaited_replies_no_adjacency_or_deadlock']) assert.ok(tests.selector.includes(symbol));
  for (const pattern of [/371 July tests/, /Steel uses 110-130 damage, 80 MP, DEX\+3 and a noncontinuing Blue Arrow/, /Golden uses 130-170, 100 MP, DEX\+5 and a continuing Gold Arrow/, /three-second Paralyzed to enemies only \(enum14, mask8192\)/, /positive timer blocks the whole movement step before aging; refresh overwrites even a longer duration/, /Slowed ages independently, with paralysis taking precedence.*Targeting, attacks and clocks continue/, /Real actor tests cover SQL rollback and advisory repair/, /policy is reconstruction, not historical NPC behavior or Player condition support/, /RED reached Steel, not Golden independently/]) assert.match(tests.qualification, pattern);
  for (const symbol of ['Room::handle_at packet8/9/15', 'Room::advance_shore', 'enemy_movement_factor', 'Room::entity_wire_stats', 'Room::repairable_enemy', 'Room::publication']) assert.ok(native.selector.includes(symbol));
  for (const pattern of [/PREPARED starter-quiver\/HP500 overrides.*banners.*unchanged repaired SWF; no relay or instruction changes/, /Both native BEFORE cases were recorded before implementation/, /Steel paid 80 MP once.*surviving enemy.*Blue Arrow in both views.*server Damage9 retains a positive real bullet ID/, /Golden paid 100 MP once and damaged four distinct surviving enemies/, /Both showed moving enemies stop under mask8192, clear explicitly and resume/, /same gold arrow remained visible in both views after actual first bullet0 Damage9 processing and before a later genuine contact/, /offscreen contact also had authoritative damage, not rendered-peer far-hit evidence/, /Iron repair evidence remains pre-backend-hit.*post-backend-hit living\/Paralyzed\/nonempty-ledger native recontact remains unobserved/, /Failed opportunities and progress were retained.*external reboots restarted volatile Rooms\/RNG without restoring saved progress/, /Public bow\/Tattered and reconnect checks passed/, /Longer movement trials still produced movement-budget rejections and an unpaid quiver rejection; bounded recovery is not general movement acceptance/, /does not prove earned Steel\/Golden, authenticated history or a complete Archer journey.*Original SWF functional checks remain not-run/]) assert.match(native.qualification, pattern);
});

test('Steel/Golden evidence changes exactly five complete expanded leaves without promoting other surfaces', () => {
  const leaf = id => baselineLeaves.find(row => row.id === id);
  assert.deepEqual(baselineLeaves.filter(row => row.implementationSources.some(ref => paralyzingRefs.includes(ref))).map(row => row.id).sort(), [...paralyzingIds].sort());
  // These hashes come from the unedited main84 catalogue, not the new evidence values.
  assert.equal(digest(JSON.stringify(beforeWoodenLeaves.filter(row => !paralyzingIds.includes(row.id)))), '057fb9f7f419a558405dbeb8facc3328adc11743ac037c577434abea91594330');
  assert.equal(digest(JSON.stringify(Object.fromEntries(Object.entries(beforeWooden.sources).filter(([id]) => !paralyzingRefs.includes(id))))), '5dc9e42c6c4024efa0eae2b4ebf438fc926dbbdc45c5cec72621c2721f6c02b4');
  assert.equal(digest(JSON.stringify(baselineLeaves.filter(row => /^object-0a6[123]-/.test(row.id)))), '80d347b4f26551c8126f2852f53fbeb982eb93a048705d8038f6067e65198303');
  assert.equal(digest(JSON.stringify(baselineLeaves.filter(row => ['object-0a64-activation-0', 'object-0a65-activation-0'].includes(row.id)))), '21d898b7b976c05a8707598d900ba38554d217f2e28519dda14e0851d60bbd0b');
  const shoots = paralyzingIds.slice(0, 2).map(leaf);
  assert.equal(digest(JSON.stringify(shoots.map(({implementation, implementationSources, ...row}) => row))), '9571084be62f947970b0025b1698010de07e1cf684e0bbfff569ccd06cd14fa2');
  for (const [i, row] of shoots.entries()) {
    assert.equal(row.implementation, 'partial'); assert.equal(row.valuePath, 'Activate'); assert.ok(row.name.endsWith(': Shoot'));
    assert.deepEqual(row.implementationSources, ['impl-world', ...paralyzingRefs]);
    assert.deepEqual(JSON.parse(leaf(`object-0a6${i + 4}-activation-0`).binding).attributes, {stat: '28', amount: String(i ? 5 : 3)});
  }
  const projectile = owner => baseline.occurrences.projectile.find(row => row.owner === owner);
  for (const [owner, min, max, mp, visual, continues] of [['object-0a64', '110', '130', '80', 'Blue Arrow', false], ['object-0a65', '130', '170', '100', 'Gold Arrow', true]]) {
    const fields = baseline.members.find(row => row.id === owner).fields, p = projectile(owner);
    assert.deepEqual(p.attrs, {});
    for (const [tag, value] of [['MinDamage', min], ['MaxDamage', max]]) {
      assert.equal(fields.find(f => f[0] === tag)[1], value); assert.equal(p.fields.find(f => f[0] === tag)[1], value);
    }
    assert.equal(fields.find(f => f[0] === 'MpCost')[1], mp);
    assert.equal(p.fields.find(f => f[0] === 'ObjectId')[1], visual);
    assert.deepEqual(p.fields.find(f => f[0] === 'ConditionEffect'), ['ConditionEffect', 'Paralyzed', {duration: '3'}]);
    assert.equal(p.fields.some(f => f[0] === 'Continues'), continues);
    assert.deepEqual(p.fields.slice(-1)[0][0], continues ? 'Continues' : 'ConditionEffect');
    for (const patch of [{name: 'HealNova'}, {path: 'ActivateOnEquip'}, {owner: 'object-0a66'}]) {
      const d = catalogue(), row = d.occurrences.activation.find(r => r.owner === owner && r.path === 'Activate');
      const ordinal = row.ordinal; Object.assign(row, patch);
      assert.ok(!expandCatalogue(d).find(r => r.id === `${patch.owner ?? owner}-activation-${ordinal}`).implementationSources.some(ref => paralyzingRefs.includes(ref)));
    }
  }
  const systems = baseline.systems.filter(row => paralyzingIds.includes(row.id));
  assert.equal(digest(JSON.stringify(systems.map(({check, unknowns, implementationSources, implementation, ...row}) => row))), 'efefcdcc39c09faa4a041cf8686bdf6b78d736e3e739b414c0f9182dd9442771');
  for (const id of ['condition-14-wire', 'condition-14-lifecycle']) {
    assert.equal(leaf(id).implementation, 'partial'); assert.deepEqual(leaf(id).implementationSources, paralyzingRefs);
    assert.match(leaf(id).check, /Enemy-only/); assert.match(leaf(id).unknowns.join(' '), /Player.*Unknown/);
  }
  assert.match(leaf('condition-14-wire').check, /enum14\/duration3.*stat29 mask8192, not selector29.*8192\/8\/8200\/0.*explicit zero/);
  assert.match(leaf('condition-14-lifecycle').check, /whole positive-on-entry step.*aging\/clamp\/equality clear.*next advance.*shortening.*independently aging.*Attack\/target\/age\/world\/state clocks unchanged/);
  assert.equal(leaf('condition-14-client').implementation, 'not-inspected'); assert.deepEqual(leaf('condition-14-client').implementationSources, []);
  assert.equal(leaf('combat-collision-matrix').implementation, 'partial');
  assert.match(leaf('combat-collision-matrix').check, /Steel0a64 retains ordinary first-hit retirement\/cover and positive real-ID Damage9/);
  assert.match(leaf('combat-collision-matrix').unknowns.join(' '), /Golden SAME gold arrow.*post9Status13 and ordinal-matched Move5.*authoritative141 hit but was offscreen, not a rendered peer far hit/);
  const roadmap = structuredClone(baseline.roadmap);
  for (const area of roadmap) for (const row of area.requirements) if (area.id === 'combat' && ['Weapons, spells and projectiles', 'Conditions and their lifecycle'].includes(row.title)) row.current = null;
  assert.equal(digest(JSON.stringify(roadmap)), '82c16a69ed7468c92c7f67f8948a40f4d04ab3cb172142533ee84e84f08cfe9a');
  assert.deepEqual(baseline.results, {});
  for (const variant of ['original', 'repaired']) {
    assert.deepEqual(countChecks(baseline, baselineLeaves, variant).functional, {'not-run': 10888, passed: 0, failed: 0});
    assert.deepEqual(countChecks(baseline, baselineLeaves, variant).historical, {unresolved: 10864, verified: 0, differences: 24});
    assert.equal(countChecks(baseline, baselineLeaves, variant).complete, false);
  }
});

test('Wooden citations pin executed tests versus prepared native evidence without widening acceptance', () => {
  const pin = 'b70d95ff30fae59864f6271417ad997c918ff0f4';
  const [tests, native] = woodenRefs.map(ref => baseline.sources[ref]);
  for (const [source, mode, file, words] of [[tests, 'test', 'shield_runtime_tests.rs', 160], [native, 'native', 'world.rs', 210]]) {
    assert.equal(source.kind, 'implementation'); assert.equal(source.mode, mode);
    assert.equal(source.url, `https://github.com/dginovker/Open-RotMG-Server/blob/${pin}/src/build100/${file}`);
    assert.ok(source.qualification.split(/\s+/).length <= words);
    assert.doesNotMatch(JSON.stringify(source), /\u2014|\.local\/|\/home\/|guid=|credential|profile\/|\.db\b/i);
    validateSource(source, 'wooden');
    assert.throws(() => validateSource({...source, mode: 'source-only'}, 'probe'), /evidence mode/);
    assert.throws(() => validateSource({...source, url: source.url.replace(pin, 'a'.repeat(40))}, 'probe'), /Wrong implementation pin/);
    for (const kind of ['artifact', 'contemporary-production', 'contemporary-testing', 'earlier/later-comparator']) assert.throws(() => validateSource({...source, kind, mode: undefined}, 'probe'), /not history/);
  }
  for (const symbol of ['shield_runtime_original_repaired_exact_represented_shape_and_context_fail_closed', 'shield_runtime_mp_readiness_signed_carry_unscaled_rng_and_no_player_stun', 'shield_runtime_native_geometry_ids_wrapping_pending_weapons_and_receipts', 'shield_runtime_actual_pirate_and_turret_fire_suppression_clocks_existing_bullets_and_resume', 'shield_runtime_contact_after_ai_next_advance_overwrites_and_independent_timer_unions_clear', 'shield_runtime_continued_contacts_repair_reentry_tombstones_then_new_paid_projectile', 'shield_runtime_200ms_terminal_and_delayed_advances_retire_without_final_sweep', 'shield_actor_contact_begin_write_rollback_full_authority_and_fatal_dispatcher', 'quiver_actor_sql_begin_at_each_phase_and_write_at8_preserve_actual_prephase', 'quiver_and_wooden_shield_transport_encrypted_split_coalesced_serial_awaited_replies_no_adjacency_or_deadlock']) assert.ok(tests.selector.includes(symbol));
  for (const pattern of [/387 July tests, 15 real Cargo guards.*no automated PR checks/, /DEF\+2 already worked/, /typed canonical shape is not exhaustive raw-XML validation/, /one cloned root-unscaled RNG roll.*shared ID1\.\.96/, /nonpaying15, 500ms readiness, signed carry.*candidate->commit->install->publication/, /Actor BEGIN\/write failures.*never refund\/replay/, /Stunned7\/mask64.*whole positive-on-entry step/, /Protected\/absent-HP turret tests inject timers, not living damage eligibility/, /200ms lifetime retires terminal\/delayed advances without a final sweep/, /No Player Stunned, Iron\/higher shields/]) assert.match(tests.qualification, pattern);
  for (const symbol of ['Room::handle_at packet8/9/15', 'Room::use_ability', 'Room::advance_shore', 'Room::advance', 'Room::entity_wire_stats', 'Room::repairable_enemy', 'Room::publication']) assert.ok(native.selector.includes(symbol));
  for (const pattern of [/PREPARED PirateHP500, normal Knight starter gear and unchanged repaired SWF/, /genuinely earned Archer10\/client Knight unlock.*not ordinary acquisition/, /failed pre-cast permanent death and normal replacement/, /Living BEFORE preceded edits.*without saved restore\/refill\/reroll/, /Silver chevrons rendered in both views.*one80MP8->15.*native46 ignored\/server58/, /Both full streams.*18 mask64 samples, no new NPC shots, 1\.0664 tiles of movement, explicit0 and resumed fire/, /original live checker failed.*independent retained-stream decoding.*without replay/, /Load25\/lowMP\/sword-camera.*retained screenshot-name failure/, /Five native quivers regressed.*Reinforced paid80MP.*failed manifest checker/, /volatile Rooms\/NPC\/RNG, not saved progress/, /ordinary public bow\/Tattered.*not public Wooden, Knight unlock or condition-duration acceptance/, /No native post-backend-hit living\/nonempty-ledger recontact or later rendered contact/, /movement-budget Error20 remains unresolved.*not movement acceptance/, /Original SWF functional checks remain not-run.*history and full Knight\/game acceptance remain unverified/]) assert.match(native.qualification, pattern);
});

test('Wooden changes exactly four complete leaves and two source objects on fresh official main', () => {
  const leaf = id => baselineLeaves.find(row => row.id === id);
  assert.deepEqual(baselineLeaves.filter(row => row.implementationSources.some(ref => woodenRefs.includes(ref))).map(row => row.id).sort(), [...woodenIds].sort());
  assert.deepEqual(baselineLeaves.filter((row, i) => JSON.stringify(row) !== JSON.stringify(beforeWoodenLeaves[i])).map(row => row.id).sort(), [...woodenIds].sort());
  // Independently captured before editing: complete objects, including all prior refs and prose.
  assert.equal(digest(JSON.stringify(beforeWoodenLeaves)), 'b9a05e6fd8c1a4551a314e6e5e5dfb8a8fe6126697e2206b8f453cefcd989b0d');
  assert.equal(digest(JSON.stringify(baselineLeaves.filter(row => !woodenIds.includes(row.id)))), '872c889196ffa707b3359241de819c837b9620e2accc148ecb1e42225c2c241b');
  assert.equal(digest(JSON.stringify(beforeWooden.sources)), '52d0cd2d988f200ce1bfb52a2379dc0f1bb7cb530aa648726071743645eb5ee2');
  assert.equal(digest(JSON.stringify(baselineLeaves.filter(row => woodenIds.includes(row.id)).map(({implementation, implementationSources, check, unknowns, ...row}) => row))), 'fb4f4cff2cf658b2d5029797973798d4cc5ac5fd9b8b42be518f2d1b28986f2f');
  const reversed = structuredClone(beforeWooden);
  for (const area of reversed.roadmap) for (const row of area.requirements) if (area.id === 'combat' && ['Weapons, spells and projectiles', 'Conditions and their lifecycle'].includes(row.title)) row.current = null;
  assert.equal(digest(JSON.stringify(reversed)), 'fbd8ec0637de814721435753770fb7498a796c65b0977ad2349e250324fdf8ca');
  assert.equal(digest(JSON.stringify(leaf('object-0a08-activation-0'))), 'fc48fe84bfa23609043aa9d4e92496140e5d982ad585ac79caf8b84c399e33b5');
  assert.deepEqual(leaf('object-0a08-activation-0').implementationSources, ['impl-world']);
  assert.equal(digest(JSON.stringify(leaf('condition-7-client'))), 'a784195852cde4b776c5acd6a6476852e5efd0b85688183e0cd3e9d771cd80ca');
  assert.equal(digest(JSON.stringify(baselineLeaves.filter(row => /^object-0a6[12345]-/.test(row.id)))), 'ad49ce5b2bf59454038cb4f7d62ece7c6dfb2c95bc698cf916cd166b0d9860e2');
  for (const id of woodenIds) assert.equal(leaf(id).implementation, 'partial');
  assert.deepEqual(leaf(woodenIds[0]).implementationSources, ['impl-world', ...woodenRefs]);
  for (const id of ['condition-7-wire', 'condition-7-lifecycle']) assert.deepEqual(leaf(id).implementationSources, woodenRefs);
  assert.deepEqual(leaf('combat-collision-matrix').implementationSources, [...beforeWooden.systems.find(row => row.id === 'combat-collision-matrix').implementationSources, ...woodenRefs]);
  assert.equal(leaf('combat-collision-matrix').check.split(' Wooden0a08 continuing Shield').length, 2);
  assert.match(leaf('combat-collision-matrix').unknowns.at(-1), /no post-backend-hit living\/nonempty-ledger recontact or later rendered contact.*200ms terminal\/delayed non-sweep.*not fixed/);
  assert.match(leaf('condition-7-wire').check, /enum7\/duration3.*mask64, not Dazed6\/mask32.*64\/72\/8256\/8264\/0.*explicit zero/);
  assert.match(leaf('condition-7-lifecycle').check, /NEW Pirate.*tutorial-turret.*positive-on-entry.*next advance.*Movement.*continue.*no catch-up shots.*shortening.*independently/);
  assert.match(leaf('condition-7-lifecycle').unknowns.join(' '), /not a new living damage target.*timer-injection.*Player.*Unknown/);
  assert.deepEqual(baseline.results, {});
  for (const variant of ['original', 'repaired']) {
    const totals = countChecks(baseline, baselineLeaves, variant);
    assert.deepEqual(totals.functional, {'not-run': 10888, passed: 0, failed: 0});
    assert.deepEqual(totals.historical, {unresolved: 10864, verified: 0, differences: 24});
    assert.equal(totals.complete, false);
  }
});

test('Wooden activation binding admits only its exact owner, root path and Shoot action', () => {
  for (const patch of [{name: 'HealNova'}, {path: 'ActivateOnEquip'}, {path: 'Projectile/ActivateOnEquip'}, {owner: 'object-0a09'}]) {
    const d = catalogue(), row = d.occurrences.activation.find(r => r.owner === 'object-0a08' && r.path === 'Activate');
    const ordinal = row.ordinal; Object.assign(row, patch);
    assert.ok(!expandCatalogue(d).find(r => r.id === `${patch.owner ?? 'object-0a08'}-activation-${ordinal}`).implementationSources.some(ref => woodenRefs.includes(ref)));
  }
  const shield = baseline.members.find(row => row.id === 'object-0a08');
  const projectile = baseline.occurrences.projectile.find(row => row.owner === shield.id);
  assert.deepEqual(projectile.attrs, {});
  assert.deepEqual(projectile.fields.slice(-2), [['ConditionEffect', 'Stunned', {duration: '3'}], ['Continues', '', {}]]);
  for (const fields of [shield.fields, projectile.fields]) for (const [tag, value] of [['MinDamage', '30'], ['MaxDamage', '70']]) assert.equal(fields.find(f => f[0] === tag)[1], value);
  assert.equal(shield.fields.find(f => f[0] === 'NumProjectiles')[1], '1');
  assert.equal(shield.fields.some(f => f[0] === 'ArcGap'), false);
  assert.equal(projectile.fields.find(f => f[0] === 'LifetimeMS')[1], '200');
  assert.equal(projectile.fields.find(f => f[0] === 'Speed')[1], '160');
  const combat = baseline.roadmap.find(area => area.id === 'combat').requirements;
  assert.match(combat.find(row => row.title === 'Weapons, spells and projectiles').current, /Wooden0a08 alone.*PREPARED.*not ordinary acquisition or public Knight acceptance.*DEF\+2 already worked.*Iron\/higher shields remain unsupported.*200ms.*movement-budget diagnosis/);
  assert.match(combat.find(row => row.title === 'Conditions and their lifecycle').current, /Stunned7\/mask64.*new NPC shots suppressed while movement and clocks continue, unlike Slowed\/Paralyzed.*not ordinary public Wooden proof/);
});

test('archived healing testimony stays approximate testing evidence, not server authority', () => {
  const s = catalogue().sources['period-healing-20100807'];
  assert.equal(s.kind, 'contemporary-testing');
  assert.equal(s.confidence, 'medium');
  assert.equal(Object.hasOwn(s, 'mode'), false);
  assert.match(s.url, /20100807092328id_.*943#comment-5639$/);
  assert.match(s.qualification, /approximately 10 to 35 HP\/sec/);
  assert.match(s.qualification, /exact Healing arithmetic remain unknown/);
});

test('one executed result never passes a template, sibling, or other variant', () => {
  const d = catalogue(), first = baselineLeaves[0], second = baselineLeaves.find(l => l.template === first.template && l.id !== first.id);
  d.sources['fixture-test'] = {...d.sources['impl-content'], mode:'test', label:'Test-only executed evidence fixture'};
  d.results[first.id + '@original'] = {functional:'passed', historical:'unresolved', evidence:['fixture-test']};
  const leaves = validateCatalogue(d);
  assert.equal(leafState(d, first, 'original').functional, 'passed');
  assert.equal(leafState(d, second, 'original').functional, 'not-run');
  assert.equal(leafState(d, first, 'repaired').functional, 'not-run');
  assert.equal(countChecks(d, leaves, 'original').functional.passed, 1);
  assert.equal(countChecks(d, leaves, 'repaired').functional.passed, 0);
  assert.equal(countChecks(d, leaves, 'original').complete, false);
});

test('stale/orphan result and source-only pass evidence fail closed', () => {
  for (const id of ['deleted-member@original', baselineLeaves[0].id + '@future', baselineLeaves[0].id + '@original@extra']) {
    const d = catalogue(); d.results[id] = {functional:'passed', historical:'unresolved', evidence:['impl-content']};
    assert.throws(() => validateCatalogue(d), /Stale\/orphan/);
  }
  const d = catalogue(); d.results[baselineLeaves[0].id + '@original'] = {functional:'passed',historical:'unresolved',evidence:['impl-content']};
  assert.throws(() => validateCatalogue(d), /executed evidence/);
});

test('unknown local/global/category/repair/variant gates prohibit verified verdicts even with functional acceptance', () => {
  const d = catalogue(); d.sources['fixture-test'] = {...d.sources['impl-content'],mode:'test'};
  for (const leaf of [baselineLeaves[0], baselineLeaves.find(l => l.repair)]) {
    d.results = {[leaf.id + '@original']:{functional:'passed',historical:'verified',evidence:['fixture-test']}};
    assert.throws(() => validateCatalogue(d), /Unsupported historical acceptance/);
  }
  const leaf = {...baselineLeaves[0], unknowns:[], sources:['july']};
  const minimal = structuredClone(d); minimal.results = {[leaf.id + '@original']:{functional:'passed',historical:'verified',evidence:['fixture-test']}};
  minimal.questions = {global:[], categories:{[leaf.domain]:[]}, variants:{original:[],repaired:[]}};
  assert.equal(countChecks(minimal, [leaf], 'original').complete, true);
  for (const place of ['global','category','variant','local']) {
    const probe = structuredClone(minimal), row = structuredClone(leaf);
    if (place === 'global') probe.questions.global.push('Unknown provenance');
    if (place === 'category') probe.questions.categories[leaf.domain].push('Unknown category');
    if (place === 'variant') probe.questions.variants.original.push('Known repair');
    if (place === 'local') row.unknowns.push('Unknown facet');
    assert.equal(countChecks(probe, [row], 'original').complete, false, place);
  }
});

test('nearly100 rounding cannot turn an exact incomplete count green', () => {
  const d = catalogue(), leaf = {...baselineLeaves[0], unknowns:[]};
  d.questions = {global:[], categories:{[leaf.domain]:[]}, variants:{original:[],repaired:[]}}; d.results = {};
  const leaves = Array.from({length:10001}, (_, i) => ({...leaf,id:'round-'+i}));
  for (const row of leaves.slice(0,-1)) d.results[row.id+'@original'] = {functional:'passed',historical:'verified',evidence:[]};
  assert.equal((100*10000/10001).toFixed(1), '100.0');
  const counts = countChecks(d, leaves, 'original');
  assert.equal(counts.historical.verified, 10000); assert.equal(counts.complete, false);
});

test('variant details expose every selected repair without rewriting original inventory', () => {
  assert.equal(baseline.repairs.length,24);
  assert.equal(baseline.repairs.filter(r => r.field !== 'StatDescription').length,23);
  assert.equal(new Set(baseline.repairs.map(r => r.owner)).size,8);
  const leaf = baselineLeaves.find(l => l.group === 'object-0a00' && l.valuePath === 'MinDamage');
  assert.match(variantBinding(baseline,leaf,'original'), /MinDamage=400/);
  assert.match(variantBinding(baseline,leaf,'repaired'), /MinDamage=30/);
  const cloak=baselineLeaves.find(l=>l.group==='object-0a56'&&l.valuePath==='ConditionEffect');
  assert.match(variantBinding(baseline,cloak,'repaired'), /ConditionEffect\/@duration=3/);
  const action=baselineLeaves.find(l=>l.group==='object-0a55'&&l.template==='activation'&&l.valuePath==='Activate');
  assert.match(action.binding,/Healing/);assert.match(action.binding,/Damaging/);
  assert.equal(baselineLeaves.find(l=>l.group==='object-0701'&&l.template==='activation').implementation,'missing');
  assert.throws(() => variantBinding(baseline,leaf,'future'), /variant/);
});

test('search/domain/status counts are exact check counts, not overlapping member totals', () => {
  assert.equal(filterChecks(baseline,baselineLeaves,{status:'verified'}).length,0);
  assert.equal(filterChecks(baseline,baselineLeaves,{status:'not-run'}).length,10888);
  const all = Object.keys(baseline.domains).flatMap(domain => filterChecks(baseline,baselineLeaves,{domain}));
  assert.equal(new Set(all.map(l=>l.id)).size,10888);
  const matches = filterChecks(baseline,baselineLeaves,{query:'Red Fire',domain:'classes'});
  assert.ok(matches.length>0); assert.ok(matches.every(l=>l.domain==='classes'));
});

class Element {
  constructor(tag='div') {this.tagName=tag;this.children=[];this.events={};this.value='';this.hidden=true;this.open=false;this._text='';}
  set textContent(value) {this._text=String(value);this.children=[];}
  get textContent() {return this._text+this.children.map(c=>c.textContent).join('');}
  set innerHTML(_) {throw new Error('Untrusted HTML assignment');}
  append(...nodes) {this.children.push(...nodes);}
  replaceChildren(...nodes) {this._text='';this.children=[...nodes];}
  addEventListener(type,callback) {(this.events[type]??=[]).push(callback);}
  dispatch(type) {for (const fn of this.events[type]??[]) fn({preventDefault(){}});}
  showModal(){this.open=true;}
  close(){this.open=false;}
  scrollIntoView(){this.scrolled=true;}
}
const descendants = node => [node,...node.children.flatMap(descendants)];
function dom(hash='') {
  const ids=['search-form','check-dialog','check-close','check-title','check-status','check-content','domain','search','status','variant','clear','completion','implementation-summary','historical-summary','functional-summary','questions-summary','inventory-summary','visible-count','areas','checks','filters','global-gates','error','roadmap','roadmap-nav','roadmap-summary','technical'];
  const nodes = Object.fromEntries(ids.map(id=>[id,new Element()]));nodes.variant.value='original';
  const document={createElement:tag=>new Element(tag),getElementById:id=>nodes[id]??Object.values(nodes).flatMap(descendants).find(n=>n.id===id)};
  const window={location:{hash},events:{},addEventListener(type,callback){this.events[type]=callback;}};
  return {nodes,document,window};
}
const success = data => async()=>({ok:true,json:async()=>data});

test('native DOM seam renders every group with safe text, exact filters, details, close and stable check/member links', async () => {
  const d=catalogue(), hostile='<img src=x onerror=alert(1)>';d.systems[0].name=hostile;
  const env=dom('#check=condition-11-client&variant=repaired'), errors=[];
  const mounted=await mountCatalogue(env.document,success(d),env.window,{error:e=>errors.push(e)});
  assert.ok(mounted);assert.equal(errors.length,0);assert.equal(env.nodes.filters.disabled,false);
  assert.equal(env.nodes['check-dialog'].open,true);assert.match(env.nodes['check-content'].textContent, /-y,-x,-rotation/);
  assert.match(env.nodes['questions-summary'].textContent,/Global gates: 4 · category gates: 10 · repaired variant gates: 1 · leaf-local question bindings: 10890/);
  assert.equal(env.nodes.variant.value,'repaired');assert.match(env.nodes['visible-count'].textContent,/10888 \/ 10888/);
  assert.equal(descendants(env.nodes.checks).filter(n=>n.tagName==='details').length,new Set(baselineLeaves.map(l=>l.domain+':'+l.group)).size);
  assert.ok(env.nodes.checks.textContent.includes(hostile));assert.equal(descendants(env.nodes.checks).filter(n=>n.tagName==='img').length,0);
  env.nodes['check-close'].dispatch('click');assert.equal(env.nodes['check-dialog'].open,false);
  env.nodes.search.value='Falchion';env.nodes.search.dispatch('input');
  assert.match(env.nodes['visible-count'].textContent,new RegExp('^'+filterChecks(d,mounted.leaves,{query:'Falchion',variant:'repaired'}).length+' /'));
  const member=descendants(env.nodes.checks).find(n=>n.tagName==='details');member.open=true;member.dispatch('toggle');
  const anchors=descendants(member).filter(n=>n.tagName==='a');assert.ok(anchors.length>0);assert.ok(anchors.every(n=>n.href.startsWith('#check=')));
  env.nodes.status.value='verified';env.nodes.status.dispatch('change');assert.equal(env.nodes.checks.children.length,0);assert.match(env.nodes['visible-count'].textContent,/^0 \/ 10888/);
  env.nodes.clear.dispatch('click');assert.match(env.nodes['visible-count'].textContent,/^10888/);
  env.window.location.hash='#member=object-0212';env.window.events.hashchange();
  const oryx=env.document.getElementById('member-enemies-object-0212');assert.equal(oryx.open,true);assert.equal(oryx.scrolled,true);
  assert.ok(descendants(oryx).some(n=>n.href?.includes('object-0212-behavior-1')));
});

test('roadmap-first DOM keeps technical details collapsed, opens area/member links and preserves honest statuses under filters', async () => {
  const env = dom('#area=tutorial'), errors = [], data = catalogue();
  data.roadmap[0].requirements[0].current = '<img src=x onerror=alert(1)>';
  const mounted = await mountCatalogue(env.document, success(data), env.window, {error:error=>errors.push(error)});
  assert.equal(env.nodes.technical.open, false);
  assert.equal(env.nodes.roadmap.children.length, 7);
  assert.equal(env.document.getElementById('area-tutorial').open, true);
  assert.match(env.nodes.roadmap.textContent, /Map layout and object placement/);
  assert.ok(env.nodes.roadmap.textContent.includes('<img src=x onerror=alert(1)>'));
  assert.equal(descendants(env.nodes.roadmap).some(node => node.tagName === 'img'), false);
  assert.match(env.nodes['roadmap-summary'].textContent, /7 areas need research.*0 restored/);
  assert.equal(env.nodes.completion.textContent, 'Restoration incomplete');
  env.nodes.status.value='verified';env.nodes.status.dispatch('change');
  assert.match(env.nodes['visible-count'].textContent, /^0 \/ 10888/);
  assert.equal(env.nodes.completion.textContent, 'Restoration incomplete');
  assert.equal(env.document.getElementById('area-tutorial').open, true);
  env.window.location.hash='#member=object-0823';env.window.events.hashchange();
  assert.equal(env.nodes.technical.open, true);
  assert.equal(env.document.getElementById('member-terrain-object-0823').open, true);
  env.window.location.hash='#area=unknown';env.window.events.hashchange();
  assert.equal(env.nodes.error.hidden, false);
  env.window.location.hash='#area=realm';env.window.events.hashchange();
  assert.equal(env.nodes.error.hidden, true);
  assert.equal(env.document.getElementById('area-realm').open, true);
  assert.equal(mounted.roadmap.length, 7);
  assert.equal(errors.length, 1);
});

test('hash navigation from a check to empty/domain/member destinations closes the old modal', async () => {
  const env = dom('#check=condition-11-client'), errors = [];
  await mountCatalogue(env.document, success(catalogue()), env.window, {error:error=>errors.push(error)});
  for (const destination of ['', '#domain-combat', '#member=object-0823']) {
    env.window.location.hash = '#check=condition-11-client'; env.window.events.hashchange();
    assert.equal(env.nodes['check-dialog'].open, true);
    env.window.location.hash = destination; env.window.events.hashchange();
    assert.equal(env.nodes['check-dialog'].open, false, destination);
  }
  const sign = env.document.getElementById('member-terrain-object-0823');
  assert.equal(sign.open, true); assert.equal(sign.scrolled, true);
  assert.equal(errors.length, 0);
});

for (const [name, fetcher, message] of [
  ['HTTP', async()=>({ok:false,status:503}), /HTTP 503/],
  ['network', async()=>{throw new Error('connection refused');}, /connection refused/],
  ['parse', async()=>({ok:true,json:async()=>{throw new SyntaxError('invalid JSON');}}), /invalid JSON/],
  ['schema', success({target:'2012'}), /target/],
]) test(`fetch/parse/schema ${name} failures remain visible, no2012 fallback`, async()=>{
  const env=dom(),errors=[];const result=await mountCatalogue(env.document,fetcher,env.window,{error:e=>errors.push(e)});
  assert.equal(result,null);assert.equal(env.nodes.error.hidden,false);assert.match(env.nodes.error.textContent,message);
  assert.equal(errors.length,1);assert.equal(env.nodes.completion.textContent,'Catalogue unavailable');assert.equal(env.nodes.checks.children.length,0);
});

test('unknown deep links fail visibly instead of opening an arbitrary nearby check', async()=>{
  const env=dom('#check=absent'),errors=[];await mountCatalogue(env.document,success(catalogue()),env.window,{error:e=>errors.push(e)});
  assert.equal(env.nodes.error.hidden,false);assert.match(env.nodes.error.textContent,/Unknown check link/);assert.equal(errors.length,1);
});

test('2012 retains its own validated catalogue and year navigation',()=>{
  const bytes=readFileSync(new URL('../public/restoration/progress.json',import.meta.url));
  assert.equal(digest(bytes), 'c571a19c1c40799c3f82b6305faeba54309a85b37be0581d559a7bc2418f3ebe');
  assert.equal(digest(readFileSync(new URL('../public/restoration/evidence.json', import.meta.url))), '6f5ca458c1ecdde5fd0235f884b35f02de917e1a87964150cf5928b746966964');
  const data=JSON.parse(bytes);assert.equal(data.scope.target,'123.5.1');
  assert.equal(data.features.length,211);assert.equal(data.categories.length,9);validate2012(data);
  assert.match(read('public/restoration/index.html'),/aria-label="Restoration year"/);
  assert.equal(read('public/2010/index.html').split('href="https://openrotmg.org/restoration/2010/"').length-1,1);
  assert.match(read('public/2010/index.html'),/July 2010 Realm of the Mad God client with minimal server/);
  const html=read('public/restoration/2010/index.html');
  assert.doesNotMatch(html,/RESTORATION_PERCENT|\u2014|onsubmit=|onclick=/);
  for(const id of ['search','domain','status','variant','visible-count','error'])assert.ok(html.includes('id="'+id+'"'));
  assert.match(html,/role="alert"/);assert.match(html,/<dialog[^>]+aria-labelledby=/);
  for(const path of ['public/restoration/2010/app.js','public/restoration/2010/catalogue.js','public/restoration/2010/style.css']) assert.doesNotMatch(read(path),/\u2014|\.innerHTML|insertAdjacentHTML/);
});
