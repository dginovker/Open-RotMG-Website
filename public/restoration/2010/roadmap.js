import {blockers, countChecks, signature} from './catalogue.js';

export const stageLabels = ['Needs research', 'Ready to implement', 'Needs verification', 'Restored'];
export function restorationStage(data, leaves, variant) {
  if (!leaves.length) throw new Error('Cannot accept an empty restoration requirement');
  if (countChecks(data, leaves, variant).complete) return 'Restored';
  if (leaves.some(leaf => blockers(data, leaf, variant).length > 0)) return 'Needs research';
  return leaves.every(leaf => ['missing', 'not-inspected'].includes(leaf.implementation)) ? 'Ready to implement' : 'Needs verification';
}
export function areaFor(data, leaf) {
  if (leaf.group.startsWith('object-08') || /^(tutorial-|system-tutorial-|overlay-)/.test(leaf.id) || leaf.id === 'preference-needsTutorial') return 'tutorial';
  if (leaf.group === 'object-0212' || /^(system-closure|system-oryx-)/.test(leaf.id)) return 'oryx';
  if (data.dungeons.some(dungeon => dungeon.roster.some(id => leaf.group === 'object-' + id))) return 'dungeons';
  if (['restoration-coverage', 'system-era'].includes(leaf.id)) return 'multiplayer';
  const areas = {classes:'combat', combat:'combat', authority:'combat', enemies:'realm', terrain:'realm', world:'realm', loot:'progression', dungeons:'dungeons', client:'multiplayer', network:'multiplayer'};
  if (!Object.hasOwn(areas, leaf.domain)) throw new Error(`Unassigned restoration area: ${leaf.id}`);
  return areas[leaf.domain];
}
export function validateRoadmap(data, leaves) {
  const text = value => typeof value === 'string' && value.trim().length > 0;
  const fail = message => { throw new Error(message); };
  if (!Array.isArray(data.roadmap) || data.roadmap.map(area => area.id).join(',') !== 'tutorial,realm,combat,progression,dungeons,oryx,multiplayer') fail('Missing or reordered game restoration areas');
  const byId = new Map(leaves.map(leaf => [leaf.id, leaf]));
  for (const area of data.roadmap) {
    if (![area.title, area.summary, area.current, area.next].every(text) || !Array.isArray(area.requirements) || !area.requirements.length) fail(`Incomplete restoration area: ${area.id}`);
    for (const requirement of area.requirements) {
      if (![requirement.title, requirement.target, requirement.current].every(text) || !Array.isArray(requirement.checks) || !requirement.checks.length || new Set(requirement.checks).size !== requirement.checks.length) fail(`Incomplete restoration requirement: ${area.id}`);
      for (const id of requirement.checks) if (!byId.has(id)) fail(`Missing restoration check: ${area.id}/${id}`);
      if (['stage', 'complete', 'passed'].some(key => Object.hasOwn(requirement, key))) fail(`Unsupported manual restoration status: ${area.id}`);
    }
  }
  if (signature(data.roadmap.map(area => [area.id, area.requirements.map(row => row.checks)])) !== '3fc66932') fail('Missing or replaced end-to-end restoration requirement');
  const areas = data.roadmap.map(area => ({...area, leaves:leaves.filter(leaf => areaFor(data, leaf) === area.id), requirements:area.requirements.map(row => ({...row, leaves:row.checks.map(id => byId.get(id))}))}));
  if (areas.reduce((count, area) => count + area.leaves.length, 0) !== leaves.length) fail('Unreconciled restoration area coverage');
  return areas;
}
