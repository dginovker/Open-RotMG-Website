import {implementationLabels,historicalLabels,functionalLabels,views,groups,dungeonGates,checks,validateEvidence,matches,workCounts,accepted} from './catalogue.js';

export async function mountCatalogue(document,fetch,window,logger=console) {
  const $=id=>document.getElementById(id);
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const link=(label,url)=>{const a=el('a',label);a.href=url;return a;};
  const list=items=>{const n=el('ul');for(const item of items)n.append(el('li',item));return n;};
  const section=(title,body)=>{const n=el('section');n.append(el('h3',title),typeof body==='string'?el('p',body):body);return n;};
  const dialog=$('feature-dialog');
  const error=exception=>{if(dialog.open)dialog.close();$('error').hidden=false;$('error').textContent=`Cannot load restoration: ${exception.message}`;logger.error(exception);};
  const close=()=>{dialog.close();const h=new URLSearchParams(window.location.hash.slice(1));if(h.has('feature')||h.has('check'))window.history.replaceState(null,'',window.location.pathname+window.location.search);};
  $('feature-close').addEventListener('click',close);
  dialog.addEventListener('click',e=>{const r=dialog.getBoundingClientRect();if(e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom))close();});
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  $('search-form').addEventListener('submit',e=>e.preventDefault());
  try {
    const load=async file=>{const response=await fetch(file);if(!response.ok)throw new Error(`${file}: HTTP ${response.status}`);return response.json();};
    const [data,evidence]=await Promise.all([load('progress.json'),load('evidence.json')]);
    const all=validateEvidence(data,evidence),byId=new Map(all.map(r=>[r.id,r])),componentCount=all.length-data.features.length;
    const icon=path=>{const n=el('img');n.src=path;n.alt='';n.className='sprite';return n;};
    const state=row=>{const n=el('span',undefined,'audit-state');n.append(el('span',implementationLabels[row.rule.implementation],`implementation-${row.rule.implementation}`),el('span',`Gameplay: ${functionalLabels[evidence.results[row.id].status]}`,`functional-${evidence.results[row.id].status}`),el('span',`History: ${historicalLabels[row.rule.historical]}`,`historical-${row.rule.historical}`));return n;};
    const historicalSources=sources=>{const n=el('div');for(const source of sources){const p=el('p',undefined,'citation');p.append(el('strong',source.label+': '),link(source.url,source.url));n.append(p);}return n;};
    function appendEvidence(node,refs) {
      for(const ref of refs){const s=evidence.sources[ref],p=el('p',undefined,'citation');p.append(el('strong',`${s.kind} · ${s.date} · revision ${s.revision}`),el('br'),link(s.url,s.url),el('br'),el('span',s.method),el('br'),el('span','Limits: '+s.limitations));node.append(p);}
    }
    function functionalProof(id) {
      const result=evidence.results[id],n=el('div'),refs=result.evidence.filter(ref=>evidence.sources[ref].kind!=='source');
      n.append(el('p',functionalLabels[result.status]));
      if(!refs.length)n.append(el('p','No executed acceptance result is bound to this ID. This does not assert that no prior testing exists.'));
      appendEvidence(n,refs);return n;
    }
    function openRecord(row) {
      const f=row.feature,r=row.rule,component=row.id!==f.id;
      $('feature-title').textContent=component?`${f.name}: ${r.name}`:f.name;
      $('feature-icon').hidden=!f.icon;if(f.icon)$('feature-icon').src=f.icon;else $('feature-icon').removeAttribute('src');
      $('feature-status').replaceChildren(state(row));
      const content=[section('Historical target / requirement',r.expected)];
      if(component)content.push(section('Observable acceptance check',r.acceptance));
      else if(f.category==='dungeons')content.push(section('Whole-dungeon acceptance',list(Object.entries(dungeonGates).map(([key,text])=>`${groups[key]}: ${text}`))));
      if(r.differences.length)content.push(section('Known / intentional differences',list(r.differences)));
      content.push(section('Historical research',r.unknowns.length?list(r.unknowns):r.historical==='unreviewed'?'This component has no independent historical sign-off. Parent questions and source qualifications still apply.':'No additional local questions recorded; this is not automatic historical acceptance.'));
      if(component&&f.audit.unknowns.length)content.push(section('Parent historical questions',list(f.audit.unknowns)));
      if(r.sources.length)content.push(section('Historical references',historicalSources(r.sources)));
      if(component)content.push(section('Parent research leads (not component sign-off)',historicalSources(f.audit.sources)));
      content.push(section('Recorded gameplay acceptance',functionalProof(row.id)));
      const review=evidence.sourceReview,source=el('div');source.append(el('p',`Last whole-catalogue source audit: server ${review.revision.slice(0,7)}, ${review.date}. ${review.qualification}`),link(review.url,review.url));appendEvidence(source,evidence.results[row.id].evidence.filter(ref=>evidence.sources[ref].kind==='source'));content.push(section('Implementation review provenance',source));
      content.push(section('Update this check',`For restoration-related PRs, identify ${row.id} in the PR comment. When source support changes, update this row's implementation and differences in progress.json. Bind executed evidence to that ID in the evidence ledger. Include tested revision, date, method, result and limitations. Source inspection cannot pass gameplay acceptance; a merged PR cannot establish historical accuracy.`));
      content.push(section('Stable check identity',link(row.id,`#${component?'check':'feature'}=${encodeURIComponent(row.id)}`)));
      if(!component)content.push(section('Feature completion',accepted(f,evidence)?'All recorded requirements and acceptance checks are satisfied.':'Not accepted. The parent and every component need source support, recorded gameplay acceptance and historical sign-off without unresolved questions or differences.'));
      $('feature-audit').replaceChildren(...content);if(!dialog.open)dialog.showModal();
    }
    function recordLink(row,cls) {
      const component=row.id!==row.feature.id,a=link(component?row.rule.name:row.feature.name,`#${component?'check':'feature'}=${encodeURIComponent(row.id)}`);a.className=cls;
      a.dataset[component?'check':'feature']=row.id;
      if(!component&&row.feature.icon){a.prepend(icon(row.feature.icon));if(row.feature.category==='conditions')a.firstChild.classList.add('condition-icon');}
      if(!component&&row.id==='dungeons:oryx-s-chamber')a.append(el('small','Oryx 1'));
      if(!component&&row.id==='dungeons:wine-cellar')a.append(el('small','Oryx 2'));
      return a;
    }
    function featureRow(f,visible) {
      const li=el('li'),parent=byId.get(f.id),body=el('div');body.append(recordLink(parent,'feature'));
      if(f.audit.differences.length)body.append(el('p',f.audit.differences[0],'work-note'));
      const children=checks(f);if(children.length)body.append(el('p',`Component work: ${children.filter(c=>c.implementation!=='present').length} implementation · ${children.filter(c=>evidence.results[c.id].status!=='passed').length} gameplay · ${children.filter(c=>c.historical!=='verified').length} history.`,'work-note'));
      const components=children.filter(c=>visible.some(r=>r.id===c.id));
      const sections=f.category==='dungeons'?Object.keys(dungeonGates):[...new Set(components.map(c=>c.group))];
      for(const key of sections){const members=components.filter(c=>c.group===key);if(!members.length&&$('search').value)continue;const details=el('details',undefined,'component-group');
        const heading=el('summary',`${groups[key]}${members.length?' ('+members.length+')':''}`);details.append(heading);
        if(f.category==='dungeons')details.append(el('p',dungeonGates[key],'work-note'));
        const ul=el('ul',undefined,'check-list');
        for(const c of members){const item=el('li'),row=byId.get(c.id);item.append(recordLink(row,'check'),state(row));ul.append(item);}
        if(members.length)details.append(ul);else details.append(el('p','Required as part of whole-dungeon acceptance; no matching separate component in this view.','work-note'));
        body.append(details);
      }
      li.append(body,state(parent));return li;
    }
    function render() {
      const view=$('view').value,query=$('search').value,category=$('category').value;
      const visible=all.filter(r=>(!category||r.feature.category===category)&&matches(r,evidence,view,query));
      const featureIds=new Set(visible.map(r=>r.feature.id));
      $('visible-count').textContent=`${featureIds.size} / ${data.features.length} feature groups; ${visible.filter(r=>r.id!==r.feature.id).length} / ${componentCount} component checks match. Counts are separate, not completion points.`;
      $('features').replaceChildren();
      for(const area of data.categories){const features=data.features.filter(f=>f.category===area.id&&featureIds.has(f.id));if(!features.length)continue;
        const d=el('details',undefined,'category');d.id=area.id;d.open=!!query||!!category;
        d.append(el('summary',`${area.name} (${features.length})`));
        const ul=el('ul',undefined,'forum-list');for(const f of features)ul.append(featureRow(f,visible));d.append(ul);
        if(area.unknowns?.length)d.append(section('Area historical questions',list(area.unknowns.map(q=>q.question))));
        $('features').append(d);
      }
      if(!visible.length)$('features').append(el('p','No matching requirements. Change the search or work type.'));
    }
    function roadmap() {
      const counts=workCounts(data.features,evidence);
      $('overview-summary').textContent=`${data.features.length} feature groups · ${componentCount} component checks · ${data.features.filter(f=>accepted(f,evidence)).length} accepted feature groups · ${all.filter(r=>evidence.results[r.id].status==='passed').length} / ${all.length} records passed gameplay checks, and ${all.filter(r=>evidence.results[r.id].status==='not-run'&&evidence.results[r.id].evidence.length).length} not-run records have bound evidence (scoped receipts, not completion)`;
      $('work-summary').textContent=`${counts.implementation} groups need implementation · ${counts.verification} need recorded gameplay verification · ${counts.research} need historical research · ${counts.differences} have differences. These overlap; they are not a fidelity percentage. Last whole-catalogue source audit: ${evidence.sourceReview.date} (server ${evidence.sourceReview.revision.slice(0,7)}); later row changes and executed receipts carry their own revisions.`;
      $('roadmap').replaceChildren();
      for(const area of data.categories){const fs=data.features.filter(f=>f.category===area.id),stats=workCounts(fs,evidence),card=el('article',undefined,'roadmap-area');
        const title=el('h3');title.append(icon(area.icon),el('span',area.name));card.append(title,el('p',area.summary));
        card.append(el('p',`Implementation: ${stats.implementation} · Verification: ${stats.verification} · Research: ${stats.research} · Differences: ${stats.differences}`,'area-counts'));
        const gaps=fs.flatMap(f=>f.audit.differences.map(text=>`${f.name}: ${text}`));
        if(gaps.length)card.append(section('Current differences',list(gaps.slice(0,2))));
        else card.append(el('p','No known implementation differences are recorded here. This does not establish completed verification.','work-note'));
        const next=all.filter(r=>r.feature.category===area.id&&matches(r,evidence,'implementation')).slice(0,3);
        if(next.length)card.append(section('Implementation checks to investigate',list(next.map(r=>r.id===r.feature.id?r.feature.name:r.rule.name))));
        const research=fs.flatMap(f=>f.audit.unknowns);if(research.length){const detail=el('details',undefined,'research-preview');detail.append(el('summary','Next historical research'),el('p',research[0]));card.append(detail);}
        const action=link('Open requirements','#area='+area.id);card.append(action);$('roadmap').append(card);
      }
    }
    function followHash() {
      const hash=window.location.hash.slice(1),params=new URLSearchParams(hash);
      if(params.has('check')||params.has('feature')){const key=params.has('check')?'check':'feature',row=byId.get(params.get(key));if(!row||(key==='check')===(row.id===row.feature.id))throw new Error(`Unknown ${key} link: ${params.get(key)}`);openRecord(row);return;}
      if(dialog.open)dialog.close();
      const area=params.has('area')?params.get('area'):hash;
      if(area){if(!data.categories.some(c=>c.id===area))throw new Error(`Unknown area link: ${area}`);$('category').value=area;$('view').value='all';$('search').value='';render();const node=$(area);node.open=true;node.scrollIntoView();}
    }
    for(const [value,label]of Object.entries(views)){const option=el('option',label);option.value=value;$('view').append(option);}
    for(const c of data.categories){const option=el('option',c.name);option.value=c.id;$('category').append(option);}
    for(const id of ['view','category','search'])$(id).addEventListener(id==='search'?'input':'change',render);
    $('clear').addEventListener('click',()=>{$('view').value='work';$('category').value='';$('search').value='';render();});
    window.addEventListener('hashchange',()=>{try{$('error').hidden=true;followHash();}catch(e){error(e);}});
    roadmap();render();followHash();$('filters').disabled=false;
    return {data,evidence,render,openRecord};
  }catch(exception){$('overview-summary').textContent='Catalogue unavailable';$('roadmap').replaceChildren();$('features').replaceChildren();error(exception);return null;}
}
if(typeof document!=='undefined')mountCatalogue(document,fetch,window);
