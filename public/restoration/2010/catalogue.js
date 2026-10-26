export const target = 'july-2010-build100';
export const originalSha256 = 'ec031064b61d22e860de802ae1967ef1bb193b2c35d297ca1d25b1a96f76684e';
export const repairedSha256 = '68b9220aeee798db883db7c336fd0f09e3b12a8f9856b65a013379b00cfe6bfd';
export const implementationPin = '128bd1de03aaace23381b8705488494490e9061f';
// Keep the audit frozen while reviewed increments receive independent citations.
const implementationPins = new Set([implementationPin, '95dfd8cdfbb6de907d758c4c72073b338a6135c3', '143b32856987c5d494e9788ec8a7dad1f567ff84', 'ff285b5e970a2cd9f71b71c68b388d41cf4b5203', '376b6425eb402de2271950e142866227b874534a', '0205427d7d7609047b07c728c651780222f766c6', 'a0370a1d72c235c893e4f2b603816c5a57322c0f', '56db1f589f082670b2eac22e7667dedbee9a8aa6', 'b70d95ff30fae59864f6271417ad997c918ff0f4']);
export const inventorySignature = '590876b4';
export const implementationLabels = {present: 'Present in source', partial: 'Partial in source', missing: 'Missing in source', 'not-inspected': 'Not inspected'};
export const historicalLabels = {unresolved: 'Unresolved history', verified: 'Historically accepted', differences: 'Known differences'};
export const evidenceLabels = {artifact: 'Artifact', 'contemporary-production': 'Contemporary production', 'contemporary-testing': 'Contemporary testing', 'earlier/later-comparator': 'Earlier/later comparator', reconstruction: 'Reconstruction', unknown: 'Unknown', implementation: 'Implementation only'};
const text = x => typeof x === 'string' && x.trim().length > 0;
const strings = x => Array.isArray(x) && x.every(text);
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const fail = message => { throw new Error(message); };
const require = (valid, message) => { if (!valid) fail(message); };
const slug = /^[a-zA-Z0-9-]+$/;
const attributes = x => record(x) && Object.values(x).every(v => typeof v === 'string');
const fieldsValid = fields => Array.isArray(fields) && fields.every(f => Array.isArray(f) && f.length === 3 && text(f[0]) && typeof f[1] === 'string' && attributes(f[2]));
const format = value => JSON.stringify(value);
export function signature(value) {
  let hash = 2166136261;
  for (const character of JSON.stringify(value)) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
  return hash.toString(16).padStart(8, '0');
}
export const inventory = data => ({members: data.members, occurrences: data.occurrences, repairs: data.repairs});

export function validateSource(source, id) {
  require(record(source) && [source.label, source.selector, source.qualification].every(text) && Object.hasOwn(evidenceLabels, source.kind) && ['high', 'medium', 'low', 'unknown'].includes(source.confidence), `Invalid source/confidence: ${id}`);
  let url;
  try { url = new URL(source.url); } catch { fail(`Invalid source URL: ${id}`); }
  require(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !/\.local(?:\/|$)|\/home\//.test(url.pathname), `Unsafe source URL: ${id}`);
  require(![...url.searchParams.keys()].some(k => /token|password|secret|credential|signature|api.?key|authorization|guid/i.test(k)), `Sensitive source URL: ${id}`);
  const parts = url.pathname.split('/');
  const github = ['github.com', 'raw.githubusercontent.com'].includes(url.hostname);
  if (github) {
    const commit = url.hostname === 'github.com' ? parts[4] : parts[3];
    require(/^[a-f0-9]{40}$/.test(commit), `Unpinned code source: ${id}`);
  }
  const own = ['openrotmg.org', 'www.openrotmg.org'].includes(url.hostname) || (github && (parts[1].toLowerCase() === 'openrotmg' || /^open-rotmg-(server|website|client)$/i.test(parts[2])));
  const originalArtifact = source.kind === 'artifact' && source.url === 'https://www.openrotmg.org/2010/original-client.swf' && source.selector.includes(originalSha256);
  require(!own || source.kind === 'implementation' || originalArtifact || source.kind === 'reconstruction', `Project code is not history: ${id}`);
  if (source.kind === 'implementation') {
    require(['source', 'test', 'native'].includes(source.mode), `Missing implementation evidence mode: ${id}`);
    require(url.hostname === 'github.com' && parts[1] === 'dginovker' && parts[2] === 'Open-RotMG-Server' && parts[3] === 'blob' && implementationPins.has(parts[4]) && url.pathname.includes('/src/build100/'), `Wrong implementation pin/path: ${id}`);
  } else require(!Object.hasOwn(source, 'mode'), `Historical source has implementation mode: ${id}`);
}
function validateRule(rule, data, id) {
  require(record(rule) && text(rule.expected) && text(rule.check) && strings(rule.unknowns) && Object.hasOwn(implementationLabels, rule.implementation) && ['high', 'medium', 'low', 'unknown'].includes(rule.confidence), `Incomplete expected/check/status/confidence: ${id}`);
  for (const [key, implementation] of [['sources', false], ['implementationSources', true]]) {
    require(strings(rule[key]), `Invalid source references: ${id}`);
    for (const ref of rule[key]) require(Object.hasOwn(data.sources, ref) && (data.sources[ref].kind === 'implementation') === implementation, `Missing/mixed source reference: ${id}/${ref}`);
  }
  require(rule.implementation === 'not-inspected' || rule.implementationSources.length > 0, `Source disposition without proof: ${id}`);
  require(!Object.hasOwn(rule, 'functional') && !Object.hasOwn(rule, 'historical') && !Object.hasOwn(rule, 'passed'), `Template/system cannot pass instances: ${id}`);
}

// Fixed expansions keep common prose shared while every bound check has its own result key.
export function expandCatalogue(data) {
  const leaves = [];
  const add = (id, member, name, templateId, binding, selector, extra = {}) => {
    const template = data.templates[templateId];
    require(template, `Missing template: ${templateId}`);
    leaves.push({...template, id, name, group: member.id, groupName: member.name, domain: member.domain, binding, selector, template: templateId, ...extra});
  };
  const members = new Map(data.members.map(m => [m.id, m]));
  for (const m of data.members) {
    const selector = `${m.kind === 'Ground' ? 'GroundTypes/Ground' : 'Objects/Object'}[@type=0x${m.id.split('-')[1]}]`;
    for (const facet of ['identity', 'appearance', 'placement']) add(`${m.id}-${facet}`, m, facet, facet, facet === 'placement' && m.availability ? m.availability : `${m.id}: ${format(m.name)} / ${m.kind}`, selector);
    for (const tag of m.presentation ?? []) add(`${m.id}-presentation-${tag}`, m, `${tag}: sign / tooltip presentation`, 'presentation', tag, selector + '/' + tag, {valuePath: tag});
    if (m.whenClose) add(`${m.id}-when-close`, m, 'WhenClose: ordered UI boxes', 'when-close', format(m.whenClose), selector + '/WhenClose');
    for (const [index, field] of m.fields.entries()) {
      const clientOnly = ['Size', 'DrawOnGround', 'Z', 'Rotation', 'AngleCorrection', 'NoMiniMap', 'Usable', 'Animate', 'Texture', 'BlendPriority', 'RandomOffset', 'XOffset', 'YOffset', 'Color'].includes(field[0]);
      const unretained = ['NoSpawn', 'Group', 'Terrain', 'Flying', 'EnemyOccupySquare', 'Level', 'FullOccupy', 'BlocksSight', 'Named', 'Hero', 'IntergamePortal', 'ProtectFromProjectiles', 'ProjectileId', 'ProjectileDamage', 'DungeonName', 'ProtectFromGroundDamage', 'ProtectFromSink', 'Push'].includes(field[0]);
      add(`${m.id}-field-${index}`, m, field[0], clientOnly ? 'client-field' : unretained ? 'unretained-field' : 'field', format(field), selector + '/' + field[0], {valuePath: field[0]});
    }
    if (m.kind === 'Ground') add(`${m.id}-negative`, m, 'Absent mechanical flags', 'ground-negative', format(['NoWalk', 'Sink', 'Push', 'MinDamage', 'MaxDamage'].filter(flag => !m.fields.some(f => f[0] === flag))), selector);
    for (const [stat, start, cap] of m.stats ?? []) {
      add(`${m.id}-start-${stat}`, m, `${stat}: start`, 'start', start, selector + '/' + stat);
      add(`${m.id}-cap-${stat}`, m, `${stat}: cap`, 'cap', cap, selector + '/' + stat + '/@max');
    }
    for (const [stat, min, max] of m.growth ?? []) for (const [bound, value] of [['min', min], ['max', max]]) add(`${m.id}-growth-${stat}-${bound}`, m, `${stat}: growth ${bound}`, 'growth', value, selector + `/LevelIncrease[${stat}]/@${bound}`);
    for (const key of ['SlotTypes', 'Equipment']) for (const [index, value] of (m[key] ?? []).entries()) add(`${m.id}-${key}-${index}`, m, `${key} slot ${index}`, 'slot', value, selector + `/${key}[${index}]`);
    if (m.fields.some(f => f[0] === 'Enemy')) {
      for (const facet of ['targeting', 'motor', 'lifecycle']) add(`${m.id}-${facet}`, m, facet, facet, format(m.fields), selector);
      add(`${m.id}-absent-stats`, m, 'Absent stat/placement declarations', 'field', format(['MaxHitPoints', 'Defense', 'XpMult', 'Terrain', 'NoSpawn'].filter(key => !m.fields.some(f => f[0] === key))), selector);
    }
    if (m.stats || m.fields.some(f => ['Enemy', 'XpMult'].includes(f[0]))) add(`${m.id}-xp-source`, m, 'Structural XP candidate', 'xp-source', format(m.fields.filter(f => ['MaxHitPoints', 'XpMult', 'Enemy'].includes(f[0]))), selector);
    for (const [i, binding] of (m.audio ?? []).entries()) add(`${m.id}-audio-${i}`, m, `Audio: ${binding[0]}`, 'audio', format(binding), selector + '/' + binding[0]);
  }
  for (const [family, rows] of Object.entries(data.occurrences)) for (const row of rows) {
    const m = members.get(row.owner);
    require(m, `Orphan occurrence: ${row.owner}`);
    const id = `${row.owner}-${family}-${row.ordinal}`, selector = `Objects/Object[@type=0x${row.owner.slice(7)}]/${row.path}[occurrence=${row.ordinal}]`;
    const binding = format({name: row.name, attributes: row.attrs, ...(family === 'activation' ? {itemContext: m.fields.filter(f => ['MpCost', 'Consumable', 'Usable', 'ConditionEffect', 'MinDamage', 'MaxDamage', 'NumProjectiles', 'ArcGap'].includes(f[0])), scope: row.path === 'Projectile/ActivateOnEquip' ? 'Nested projectile declaration, not a root equipped-player bonus' : 'Root declaration'} : {})});
    if (family === 'projectile') {
      add(id + '-identity', m, `Projectile ${row.ordinal}: identity/selector`, 'projectile', format(row.attrs), selector);
      for (const [i, field] of row.fields.entries()) add(id + '-field-' + i, m, `Projectile ${row.ordinal}: ${field[0]}`, 'projectile', format(field), selector + '/' + field[0], {valuePath: 'Projectile/' + field[0]});
      add(id + '-negative', m, `Projectile ${row.ordinal}: absent flags`, 'projectile-negative', format(['Continues', 'Wavy', 'Amplitude', 'ConditionEffect'].filter(flag => !row.fields.some(f => f[0] === flag))), selector);
    } else {
      const template = family === 'behavior' ? 'behavior-' + row.name : family === 'loot' && row.item === null ? 'loot-marker' : family;
      const priestHeal = family === 'activation' && row.path === 'Activate' && row.name === 'HealNova' && ['object-0a31', 'object-0a32', 'object-0a33'].includes(row.owner);
      const quiver = family === 'activation' && row.path === 'Activate' && row.name === 'Shoot' && ['object-0a61', 'object-0a62', 'object-0a63', 'object-0a64', 'object-0a65'].includes(row.owner);
      const woodenShield = family === 'activation' && row.owner === 'object-0a08' && row.path === 'Activate' && row.name === 'Shoot';
      const unsupportedAction = family === 'activation' && row.path === 'Activate' && !(priestHeal || quiver || woodenShield || (row.name === 'BulletNova') || (row.name === 'IncrementStat' && row.owner === 'object-0a22') || (row.name === 'ConditionEffectSelf' && row.owner !== 'object-0a5a' && m.fields.some(f => f[0] === 'ConditionEffect' && f[1] === 'Invisible')));
      const unmatchedChild = family === 'behavior' && row.attrs.childId && !data.members.some(member => member.name === row.attrs.childId);
      add(id, m, `${family} ${row.ordinal}: ${row.name || 'empty marker'}`, template, binding, selector, {valuePath: row.path, ...(priestHeal ? {implementation: 'present', implementationSources: ['impl-priest-heals', ...(row.owner === 'object-0a31' ? ['impl-priest-starter-native'] : [])], sources: [...data.templates[template].sources, 'period-healing-20100807']} : quiver ? {implementation: 'partial', implementationSources: ['impl-world', ...(['object-0a64', 'object-0a65'].includes(row.owner) ? ['impl-paralyzing-tests', 'impl-paralyzing-native'] : row.owner === 'object-0a63' ? ['impl-iron-tests', 'impl-iron-native'] : ['impl-quiver-tests', 'impl-quiver-native'])]} : woodenShield ? {implementation: 'partial', implementationSources: ['impl-world', 'impl-wooden-tests', 'impl-wooden-native']} : unsupportedAction ? {implementation: 'missing', implementationSources: ['impl-world']} : {}), ...(unmatchedChild ? {unknowns: [...data.templates[template].unknowns, `No exact object-name match for childId ${format(row.attrs.childId)}. Preserve the mismatch; whitespace repair is not authenticated history.`]} : {})});
      if (family === 'behavior') {
        add(id + '-qa', m, `Attribute QA ${row.ordinal}: ${row.name}`, 'attribute-qa', binding, selector);
        if (row.name === 'Shoot') add(id + '-binding', m, `Shoot ${row.ordinal}: projectile binding`, 'shoot-binding', format({selector: row.attrs.projectileId ?? 'ABSENT', candidates: data.occurrences.projectile.filter(p => p.owner === row.owner).map(p => ({occurrence: p.ordinal, declaredId: p.attrs.id ?? 'ABSENT', fields: p.fields}))}), selector);
      }
    }
  }
  for (const repair of data.repairs) {
    const m = members.get(repair.owner);
    require(m, `Orphan repair: ${repair.id}`);
    add(repair.id, {...m, domain: 'authority'}, `${m.name}: repair ${repair.field}`, 'repair', format({field: repair.field, original: repair.original, repaired: repair.repaired}), `Objects/Object[@type=0x${repair.owner.slice(7)}]/${repair.field}`, {repair: true});
  }
  for (const system of data.systems) {
    if (system.id === 'class-journeys') {
      for (const m of data.members.filter(member => member.kind === 'Player')) {
        const startingItems = m.Equipment.slice(0, 2).map(item => 'object-' + Number(item).toString(16).padStart(4, '0'));
        const ability = members.get(startingItems[1]);
        const binding = {
          class: m.id, slots: m.SlotTypes, loadout: m.Equipment,
          ability: {id: ability.id, name: ability.name, fields: ability.fields, actions: data.occurrences.activation.filter(row => row.owner === ability.id)},
          startingItemRepairs: data.repairs.filter(repair => startingItems.includes(repair.owner))
        };
        leaves.push({...system, implementationSources: m.id === 'object-0310' ? [...system.implementationSources, 'impl-priest-starter-native'] : system.implementationSources, id: m.id + '-journey', group: m.id, groupName: m.name, name: 'Ordinary class journey', binding: format(binding), selector: `Objects/Object[@type=0x${m.id.slice(7)}]/Equipment; starting ability ${ability.id}`, template: null});
      }
    } else leaves.push({...system, group: system.id, groupName: system.name, binding: '', template: null});
  }
  return leaves;
}
export function variantBinding(data, leaf, variant) {
  require(['original', 'repaired'].includes(variant), 'Invalid variant');
  const repairs = data.repairs.filter(r => r.owner === leaf.group && (leaf.template === 'activation' || r.field === leaf.valuePath || r.field.startsWith(leaf.valuePath + '/')));
  return leaf.binding + (repairs.length ? `\n${variant} variant: ${repairs.map(r => `${r.field}=${r[variant]}`).join('; ')}` : '');
}
export function leafState(data, leaf, variant) {
  const result = data.results[`${leaf.id}@${variant}`];
  return {implementation: leaf.implementation, functional: result?.functional ?? 'not-run', historical: result?.historical ?? (leaf.repair ? 'differences' : 'unresolved'), evidence: result?.evidence ?? []};
}
export function blockers(data, leaf, variant) {
  return [...data.questions.global, ...data.questions.categories[leaf.domain], ...data.questions.variants[variant], ...leaf.unknowns];
}
export function countChecks(data, leaves, variant) {
  const implementation = Object.fromEntries(Object.keys(implementationLabels).map(key => [key, 0]));
  const historical = Object.fromEntries(Object.keys(historicalLabels).map(key => [key, 0]));
  const functional = {'not-run': 0, passed: 0, failed: 0};
  for (const leaf of leaves) {
    const state = leafState(data, leaf, variant);
    implementation[state.implementation]++; historical[state.historical]++; functional[state.functional]++;
  }
  const complete = leaves.length > 0 && leaves.every(leaf => leafState(data, leaf, variant).historical === 'verified' && leafState(data, leaf, variant).functional === 'passed' && leaf.implementation === 'present' && blockers(data, leaf, variant).length === 0);
  return {total: leaves.length, implementation, historical, functional, complete};
}
export function filterChecks(data, leaves, {query = '', domain = '', status = '', variant = 'original'} = {}) {
  const term = query.toLocaleLowerCase().trim();
  return leaves.filter(leaf => {
    const state = leafState(data, leaf, variant);
    return (!domain || leaf.domain === domain) && (!status || Object.values(state).includes(status)) && (!term || [leaf.id, leaf.name, leaf.groupName, leaf.expected, leaf.check, variantBinding(data, leaf, variant), ...leaf.unknowns].join(' ').toLocaleLowerCase().includes(term));
  });
}
export function validateCatalogue(data) {
  require(record(data) && data.target === target && data.originalSha256 === originalSha256 && data.repairedSha256 === repairedSha256 && data.implementationPin === implementationPin, 'Invalid July100 target/artifact/implementation pin');
  require(record(data.sources) && record(data.templates) && record(data.domains) && record(data.results) && Array.isArray(data.members) && Array.isArray(data.systems) && Array.isArray(data.repairs) && record(data.occurrences), 'Invalid catalogue collections');
  const ids = new Set();
  const unique = id => { require(text(id) && slug.test(id) && !ids.has(id), `Invalid/duplicate identifier: ${id}`); ids.add(id); };
  for (const [id, source] of Object.entries(data.sources)) validateSource(source, id);
  for (const [id, rule] of Object.entries(data.templates)) validateRule(rule, data, id);
  for (const system of data.systems) { unique(system.id); validateRule(system, data, system.id); require(Object.hasOwn(data.domains, system.domain) && text(system.name) && text(system.selector), `Invalid system: ${system.id}`); }
  for (const member of data.members) {
    unique(member.id);
    require(text(member.name) && ['Projectile', 'Player', 'Character', 'Container', 'Portal', 'Equipment', 'GameObject', 'Wall', 'Ground'].includes(member.kind) && Object.hasOwn(data.domains, member.domain) && fieldsValid(member.fields), `Invalid member: ${member.id}`);
    if (member.presentation !== undefined) require(strings(member.presentation) && new Set(member.presentation).size === member.presentation.length && member.presentation.every(tag => ['Text', 'Description', 'StatDescription'].includes(tag)), `Invalid presentation selectors: ${member.id}`);
    if (member.whenClose !== undefined) require(record(member.whenClose) && text(member.whenClose.radius) && Array.isArray(member.whenClose.boxes) && member.whenClose.boxes.length === 2 && member.whenClose.boxes.every(box => Array.isArray(box) && box.length === 2 && text(box[0]) && strings(box[1]) && box[1].length === 4), `Invalid WhenClose binding: ${member.id}`);
    for (const key of ['stats', 'growth']) if (member[key] !== undefined) require(member.kind === 'Player' && member[key].length === 8 && member[key].every(row => Array.isArray(row) && row.length === 3 && row.every(text)), `Invalid class ${key}: ${member.id}`);
    for (const key of ['SlotTypes', 'Equipment']) if (member[key] !== undefined) require(strings(member[key]) && member[key].length === (member.kind === 'Player' ? 12 : 8), `Invalid slots: ${member.id}`);
  }
  const members = new Map(data.members.map(m => [m.id, m]));
  for (const member of data.members) for (const item of member.Equipment ?? []) if (item !== '-1') require(members.get('object-' + Number(item).toString(16).padStart(4, '0'))?.kind === 'Equipment', `Missing loadout reference: ${member.id}/${item}`);
  for (const [family, expected] of [['behavior', 779], ['projectile', 259], ['activation', 147], ['loot', 723]]) {
    const rows = data.occurrences[family], ordinals = new Map();
    require(Array.isArray(rows) && rows.length === expected, `Wrong ${family} inventory`);
    for (const row of rows) {
      require(members.has(row.owner) && Number.isInteger(row.ordinal) && row.ordinal === (ordinals.get(row.owner) ?? 0) && typeof row.name === 'string' && attributes(row.attrs) && text(row.path), `Invalid owner/order/parameters: ${family}`);
      ordinals.set(row.owner, row.ordinal + 1);
      if (family === 'behavior') require(Object.hasOwn(data.templates, 'behavior-' + row.name), `Missing behavior template: ${row.name}`);
      if (family === 'projectile') require(fieldsValid(row.fields) && row.fields.some(f => f[0] === 'ObjectId' && data.members.some(m => m.kind === 'Projectile' && m.name === f[1])), `Missing projectile visual reference: ${row.owner}`);
      if (family === 'activation') require(['Activate', 'ActivateOnEquip', 'Projectile/ActivateOnEquip'].includes(row.path), `Invalid activation path: ${row.owner}`);
      if (family === 'loot') require((row.item === null && row.name === '') || (members.get('object-' + row.item)?.kind === 'Equipment' && members.get('object-' + row.item).name === row.name), `Missing loot reference: ${row.owner}`);
    }
  }
  // Known original text/proximity surfaces must survive independently of the chosen scalar projection.
  for (const [tag, expected] of [['Text', 16], ['Description', 168], ['StatDescription', 79]]) require(data.members.filter(member => member.presentation?.includes(tag)).length === expected, `Missing original ${tag} presentation coverage`);
  const signIds = data.members.filter(member => member.presentation?.includes('Text')).map(member => member.id).sort();
  require(signIds.join(',') === Array.from({length: 16}, (_, i) => 'object-' + (0x816 + i).toString(16).padStart(4, '0')).join(','), 'Missing original sign identity coverage');
  const proximity = data.members.filter(member => member.whenClose !== undefined);
  require(proximity.length === 1 && proximity[0].id === 'object-0823', 'Missing original WhenClose coverage');
  require(data.inventorySignature === inventorySignature && signature(inventory(data)) === inventorySignature, 'Original inventory/occurrence binding mismatch');
  require(signature(data.systems.map(row => [row.id, row.domain])) === '87ec182f', 'Missing/replaced non-DATA system requirement');
  require(Array.isArray(data.conditions) && data.conditions.join('|') === 'Nothing|Dead|Quiet|Weak|Slowed|Sick|Dazed|Stunned|Blind|Hallucinating|Drunk|Confused|Knockback|Invisible|Paralyzed|Jumpy|Bleeding|Armor Pierce|Healing|Damaging|Berserk|Paused', 'Wrong-era conditions');
  require(Array.isArray(data.packetIds) && data.packetIds.join(',') === '0,1,3,5,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29', 'Wrong-era protocol');
  for (const [id, expected] of [['packet-13', 'i16 status count then statuses only; no tickTime or tickId'], ['packet-18', 'objectId i32, x f32, y f32; exactly 12 body bytes. Relocates that object; no GOTO ACK.'], ['packet-28', 'target objectId i32; exactly 4 body bytes. Pending suppresses Move until29.'], ['packet-29', 'empty body; exactly 0 body bytes. Clears pending only, not success flag or position.']]) require(data.systems.find(row => row.id === id)?.expected === expected, `Wrong-era protocol body: ${id}`);
  for (const dungeon of data.dungeons) require(dungeon.roster.every(id => members.has('object-' + id)) && members.has('object-' + dungeon.boss) && (dungeon.key === null || members.get('object-' + dungeon.key)?.kind === 'Equipment'), `Missing dungeon reference: ${dungeon.id}`);
  require(record(data.questions) && strings(data.questions.global) && record(data.questions.categories) && record(data.questions.variants) && ['original', 'repaired'].every(v => strings(data.questions.variants[v])) && Object.keys(data.domains).every(d => strings(data.questions.categories[d])), 'Invalid global/category/variant questions');
  const leaves = expandCatalogue(data), byId = new Map();
  for (const leaf of leaves) { require(!byId.has(leaf.id), `Duplicate leaf: ${leaf.id}`); byId.set(leaf.id, leaf); }
  for (const [id, result] of Object.entries(data.results)) {
    const [leafId, variant, extra] = id.split('@'), leaf = byId.get(leafId);
    require(leaf && !extra && ['original', 'repaired'].includes(variant), `Stale/orphan instance result: ${id}`);
    require(record(result) && Object.keys(result).every(k => ['functional', 'historical', 'evidence'].includes(k)) && ['not-run', 'passed', 'failed'].includes(result.functional) && Object.hasOwn(historicalLabels, result.historical) && strings(result.evidence), `Invalid independent status: ${id}`);
    for (const ref of result.evidence) require(Object.hasOwn(data.sources, ref), `Missing result evidence: ${id}`);
    if (result.functional === 'passed') require(result.evidence.some(ref => data.sources[ref].kind === 'implementation' && ['test', 'native'].includes(data.sources[ref].mode)), `Pass without executed evidence: ${id}`);
    if (result.historical === 'verified') require(blockers(data, leaf, variant).length === 0 && leaf.implementation === 'present' && result.functional === 'passed' && leaf.confidence === 'high' && leaf.sources.some(ref => data.sources[ref].kind === 'contemporary-production'), `Unsupported historical acceptance: ${id}`);
  }
  return leaves;
}
