import {validateCatalogue, countChecks, filterChecks, leafState, blockers, variantBinding, implementationLabels, historicalLabels, evidenceLabels} from './catalogue.js';
import {validateRoadmap, restorationStage, stageLabels} from './roadmap.js';

export async function mountCatalogue(document, fetch, window, logger = console) {
  const $ = id => document.getElementById(id);
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const link = (text, href) => { const a = el('a', text); a.href = href; return a; };
  const list = items => { const ul = el('ul'); for (const item of items) ul.append(el('li', item)); return ul; };
  const section = (title, content) => { const node = el('section'); node.append(el('h3', title), typeof content === 'string' ? el('p', content) : content); return node; };
  const error = exception => {
    $('error').textContent = `Cannot load July100 restoration: ${exception.message}`;
    $('error').hidden = false;
    logger.error(exception);
  };
  $('search-form').addEventListener('submit', event => event.preventDefault());
  const dialog = $('check-dialog');
  $('check-close').addEventListener('click', () => dialog.close());
  try {
    const response = await fetch('catalogue.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json(), leaves = validateCatalogue(data), byId = new Map(leaves.map(leaf => [leaf.id, leaf]));
    const roadmap = validateRoadmap(data, leaves);
    const countsText = (counts, labels) => Object.entries(labels).map(([key, label]) => `${counts[key]} ${label.toLowerCase()}`).join(' · ');
    for (const [id, name] of Object.entries(data.domains)) {
      const option = el('option', name); option.value = id; $('domain').append(option);
    }
    function sourcesSection(refs) {
      const node = el('div');
      for (const ref of refs) {
        const source = data.sources[ref], p = el('p', undefined, 'citation');
        const a = link(source.label, source.url); a.rel = 'noopener noreferrer';
        p.append(el('strong', `${evidenceLabels[source.kind]} · ${source.confidence} confidence${source.mode ? ' · ' + source.mode : ''}: `), a, el('br'), el('span', source.selector), el('br'), el('span', source.qualification)); node.append(p);
      }
      return node;
    }
    function openCheck(leaf) {
      const variant = $('variant').value, state = leafState(data, leaf, variant);
      $('check-title').textContent = `${leaf.groupName}: ${leaf.name}`;
      $('check-status').textContent = `${implementationLabels[state.implementation]} · Functional check: ${state.functional} · ${historicalLabels[state.historical]} · ${variant}`;
      const contents = [section('Expected behavior / explicit unknown', leaf.expected)];
      if (leaf.binding) contents.push(section('Bound original declaration / selected variant', variantBinding(data, leaf, variant)));
      contents.push(section('Observable acceptance check', leaf.check), section('Original selector', `${leaf.selector}. Artifact SHA256 ${data.originalSha256}.`), section('Still unresolved for this check', list(leaf.unknowns)), section('Applicable completion gates', list(blockers(data, leaf, variant).filter(q => !leaf.unknowns.includes(q)))), section('Historical / artifact evidence', sourcesSection([...leaf.sources, ...(variant === 'repaired' && !leaf.sources.includes('reconstruction') ? ['reconstruction'] : [])])), section('Source implementation disposition (not a new test)', sourcesSection(leaf.implementationSources)));
      if (state.evidence.length) contents.push(section('Independent instance result evidence', sourcesSection(state.evidence)));
      const permalink = link('Link to this check', `#check=${encodeURIComponent(leaf.id)}&variant=${variant}`);
      contents.push(section('Stable check identity', permalink), el('p', leaf.id, 'citation'));
      $('check-content').replaceChildren(...contents);
      if (!dialog.open) dialog.showModal();
    }
    function checkLink(leaf) {
      const a = link(leaf.name, `#check=${encodeURIComponent(leaf.id)}&variant=${$('variant').value}`);
      a.addEventListener('click', () => openCheck(leaf));
      return a;
    }
    function renderRoadmap(variant) {
      const cards = [], navigation = [], stages = Object.fromEntries(stageLabels.map(label => [label, 0]));
      for (const area of roadmap) {
        const open = $('area-' + area.id)?.open === true;
        const rows = [...new Map([...area.leaves, ...area.requirements.flatMap(row => row.leaves)].map(leaf => [leaf.id, leaf])).values()];
        const stage = restorationStage(data, rows, variant); stages[stage]++;
        const card = el('details', undefined, 'roadmap-area'); card.id = 'area-' + area.id; card.open = open;
        const heading = el('summary');
        heading.append(el('span', area.title, 'area-title'), el('span', stage, 'stage'), el('span', area.summary, 'area-description'));
        card.append(heading, section('Current differences', area.current), section('Next research', area.next));
        for (const requirement of area.requirements) {
          const detail = el('details', undefined, 'requirement'), summary = el('summary');
          summary.append(el('span', requirement.title), el('span', restorationStage(data, requirement.leaves, variant), 'stage'));
          detail.append(summary, section('Historical target', requirement.target), section('Current difference', requirement.current), section('Research still needed', list([...new Set(requirement.leaves.flatMap(leaf => leaf.unknowns))])));
          const evidence = el('details', undefined, 'requirement-evidence');
          evidence.append(el('summary', 'Evidence and acceptance checks'));
          evidence.append(sourcesSection([...new Set(requirement.leaves.flatMap(leaf => [...leaf.sources, ...leaf.implementationSources]))]));
          const checks = el('ul');
          for (const leaf of requirement.leaves) {
            const item = el('li'); item.append(link(`${leaf.groupName}: ${leaf.name}`, `#check=${encodeURIComponent(leaf.id)}&variant=${variant}`), el('p', leaf.check)); checks.append(item);
          }
          evidence.append(checks); detail.append(evidence); card.append(detail);
        }
        cards.push(card); navigation.push(link(area.title, '#area=' + area.id));
      }
      $('roadmap').replaceChildren(...cards); $('roadmap-nav').replaceChildren(...navigation);
      $('roadmap-summary').textContent = `${stages['Needs research']} areas need research · ${stages['Ready to implement']} ready to implement · ${stages['Needs verification']} need verification · ${stages.Restored} restored. No parameter-count percentage.`;
    }
    function render() {
      const variant = $('variant').value, counts = countChecks(data, leaves, variant);
      renderRoadmap(variant);
      $('implementation-summary').textContent = countsText(counts.implementation, implementationLabels);
      $('historical-summary').textContent = `${counts.historical.verified} / ${counts.total} leaf checks accepted · ${counts.historical.unresolved} unresolved · ${counts.historical.differences} known differences`;
      $('functional-summary').textContent = `${counts.functional.passed} passed · ${counts.functional.failed} failed · ${counts.functional['not-run']} not run. Source inspection is not executed acceptance.`;
      $('questions-summary').textContent = `Global gates: ${data.questions.global.length} · category gates: ${Object.values(data.questions.categories).reduce((n, questions) => n + questions.length, 0)} · ${variant} variant gates: ${data.questions.variants[variant].length} · leaf-local question bindings: ${leaves.reduce((n, leaf) => n + leaf.unknowns.length, 0)}. These are separate units, not a summed fidelity score.`;
      $('completion').textContent = counts.complete ? 'Restoration complete' : 'Restoration incomplete';
      $('inventory-summary').textContent = '528 object identities · 115 ground identities · 7 classes · 161 equipment · 259 projectile definitions / 41 visuals · 779 ordered behaviors / 33 names · 52 Activate + 95 ActivateOnEquip · 723 Loot occurrences (4 empty). Subsets overlap; these are not a feature sum.';
      const visible = filterChecks(data, leaves, {query: $('search').value, domain: $('domain').value, status: $('status').value, variant});
      const groups = new Set(visible.map(leaf => leaf.domain + ':' + leaf.group));
      $('visible-count').textContent = `${visible.length} / ${leaves.length} leaf checks shown in ${groups.size} member/system groups`;
      const categories = [], areas = [];
      for (const [domain, name] of Object.entries(data.domains)) {
        const rows = visible.filter(leaf => leaf.domain === domain);
        if (!rows.length) continue;
        const category = el('section', undefined, 'category'); category.id = 'domain-' + domain;
        category.append(el('h2', `${name} (${rows.length} checks)`), section('Category gates', list(data.questions.categories[domain])));
        const grouped = new Map();
        for (const leaf of rows) {
          if (!grouped.has(leaf.group)) grouped.set(leaf.group, []);
          grouped.get(leaf.group).push(leaf);
        }
        for (const [id, checks] of grouped) {
          const details = el('details', undefined, 'member'); details.id = 'member-' + domain + '-' + id;
          details.append(el('summary', `${checks[0].groupName} · ${id} (${checks.length} checks)`));
          const ul = el('ul', undefined, 'check-list');
          let populated = false;
          const populate = () => {
            if (populated) return;
            for (const leaf of checks) {
              const state = leafState(data, leaf, variant), li = el('li');
              li.append(checkLink(leaf), el('span', `${implementationLabels[state.implementation]} · ${historicalLabels[state.historical]} · ${state.functional}`, 'audit-state'));
              ul.append(li);
            }
            populated = true;
          };
          details.addEventListener('toggle', () => { if (details.open) populate(); });
          details.populate = populate;
          details.append(ul); category.append(details);
        }
        const area = link(`${name} (${rows.length})`, '#domain-' + domain);
        areas.push(area); categories.push(category);
      }
      $('areas').replaceChildren(...areas);
      $('checks').replaceChildren(...categories);
    }
    function followHash() {
      const hash = new URLSearchParams(window.location.hash.slice(1));
      if (!hash.has('check') && dialog.open) dialog.close();
      if (hash.has('variant')) {
        if (!['original', 'repaired'].includes(hash.get('variant'))) throw new Error('Invalid deep-link variant');
        if ($('variant').value !== hash.get('variant')) { $('variant').value = hash.get('variant'); render(); }
      }
      if (hash.has('check')) {
        const leaf = byId.get(hash.get('check'));
        if (!leaf) throw new Error(`Unknown check link: ${hash.get('check')}`);
        openCheck(leaf);
      }
      if (hash.has('area')) {
        const id = hash.get('area');
        if (!roadmap.some(area => area.id === id)) throw new Error(`Unknown restoration area: ${id}`);
        const node = $('area-' + id); node.open = true; node.scrollIntoView();
      }
      if (window.location.hash.startsWith('#domain-')) $('technical').open = true;
      if (hash.has('member')) {
        $('technical').open = true;
        const id = hash.get('member'), memberLeaves = leaves.filter(leaf => leaf.group === id);
        if (!memberLeaves.length) throw new Error(`Unknown member link: ${id}`);
        $('search').value = ''; $('domain').value = ''; $('status').value = ''; render();
        const node = $('member-' + memberLeaves[0].domain + '-' + id);
        node.open = true; node.populate(); node.scrollIntoView();
      }
    }
    const guardedHash = () => { try { $('error').hidden = true; followHash(); } catch (exception) { error(exception); } };
    for (const id of ['search', 'domain', 'status', 'variant']) $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { render(); if (dialog.open) dialog.close(); });
    $('clear').addEventListener('click', () => { $('search').value = ''; $('domain').value = ''; $('status').value = ''; render(); });
    window.addEventListener('hashchange', guardedHash);
    $('global-gates').replaceChildren(list(data.questions.global));
    render(); guardedHash();
    $('filters').disabled = false;
    return {data, leaves, roadmap, render, openCheck};
  } catch (exception) {
    $('completion').textContent = 'Catalogue unavailable';
    $('checks').replaceChildren();
    $('roadmap').replaceChildren();
    $('roadmap-nav').replaceChildren();
    error(exception);
    return null;
  }
}
if (typeof document !== 'undefined') mountCatalogue(document, fetch, window);
