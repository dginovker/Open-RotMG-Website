export const boards = {
  stars: {title: 'Stars', description: 'Class stars earned from each class’s best fame.'},
  collection: {title: 'Collection', description: 'Items personally picked up from enemy drops'},
  total_fame: {title: 'Total fame', description: 'Available account fame. Earned from dead characters and reduced when spent.'},
  base_fame: {title: 'Living fame', description: 'Highest fame of an alive character per account.'},
  quests: {title: 'Quests completed', description: 'Assigned quests completed by all of an account’s characters, alive or dead.'}
};
export function ranked(players, board) {
  if (!Object.hasOwn(boards, board)) throw new Error('Unknown hiscore category');
  if (!Array.isArray(players)) throw new Error('Malformed hiscores response');
  const seen = new Set();
  for (const p of players) {
    if (!Number.isSafeInteger(p.account) || p.account < 1 || seen.has(p.account) || typeof p.name !== 'string' || !Number.isSafeInteger(p[board]) || p[board] < 0) throw new Error('Malformed hiscores player');
    seen.add(p.account);
  }
  const sorted = [...players].sort((a, b) => b[board] - a[board] || a.account - b.account);
  let rank = 0, previous;
  return sorted.map((player, i) => {if (previous !== player[board]) rank = i + 1; previous = player[board]; return {...player, rank};});
}
// Keep English names in natural order regardless of browser locale: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Collator
const itemNames = new Intl.Collator('en', {numeric: true, sensitivity: 'base'});
export function collectionOrder(items, found, order) {
  const modes = {
    name: () => 0,
    missing: (a, b) => Number(found.has(a.id)) - Number(found.has(b.id)),
    recent: (a, b) => Number(found.has(b.id)) - Number(found.has(a.id)) || (found.has(a.id) && found.has(b.id) ? found.get(b.id) - found.get(a.id) : 0)
  };
  if (!Object.hasOwn(modes, order)) throw new Error('Unknown collection sort');
  return [...items].sort((a, b) => modes[order](a, b) || itemNames.compare(a.name, b.name) || a.id - b.id);
}
async function json(path) {
  const target = path.startsWith('/api/') ? OpenRotMGBackend.url(path) : path;
  const response = await fetch(target, {cache: 'no-store', redirect: 'error'});
  if (!response.ok) throw new Error(`Hiscores request failed (${response.status})`);
  return response.json();
}
async function start() {
  const params = new URLSearchParams(location.search), board = params.get('board') ?? 'collection', account = params.get('player');
  if (!Object.hasOwn(boards, board)) throw new Error('Unknown hiscore category');
  const title = document.querySelector('#title'), status = document.querySelector('#status'), search = document.querySelector('#search');
  title.textContent = boards[board].title;document.querySelector('#metric').textContent = boards[board].title;
  document.querySelector('#description').textContent = boards[board].description;
  if (account !== null) {
    if (!/^[1-9]\d*$/.test(account)) throw new Error('Invalid player');
    const [profile, catalog, scores] = await Promise.all([json(`/api/collection/${account}`), json('items.json'), json('/api/hiscores')]);
    if (!Array.isArray(scores.collectible_items) || !Array.isArray(profile.items) || profile.account !== Number(account) || typeof profile.name !== 'string') throw new Error('Malformed collection response');
    const eligible = new Set(scores.collectible_items), found = new Map(profile.items.map(item => [item.item, item.found_at]));
    const items = catalog.filter(item => eligible.has(item.id));
    if (items.length !== eligible.size || [...found.keys()].some(id => !eligible.has(id))) throw new Error('Collection catalogue does not match the server');
    title.textContent = `${profile.name}’s collection`;
    document.querySelector('#scores').hidden = true;document.querySelector('#collection').hidden = false;
    document.querySelector('#description').textContent = boards.collection.description;
    document.querySelector('#collected').textContent = `${found.size} / ${items.length} items obtained`;
    const grid = document.querySelector('#items'), tiles = new Map(), sort = document.querySelector('#sort');
    for (const item of items) {
      const tile = document.createElement('div'), sprite = document.createElement('span'), name = document.createElement('span'), state = document.createElement('span');
      tile.className = 'item';tile.dataset.name = item.name.toLowerCase();name.textContent = item.name;
      sprite.className = found.has(item.id) ? 'sprite' : 'sprite missing';sprite.setAttribute('aria-hidden', 'true');
      sprite.style.backgroundPosition = `${-item.x}px ${-item.y}px`;
      state.textContent = found.has(item.id) ? `Obtained ${new Date(found.get(item.id) * 1000).toLocaleDateString()}` : 'Not obtained';
      tile.append(sprite, name, state);tiles.set(item.id, tile);
    }
    const render = () => grid.replaceChildren(...collectionOrder(items, found, sort.value).map(item => tiles.get(item.id)));
    sort.addEventListener('change', render);render();
    search.addEventListener('input', () => {for (const tile of grid.children) tile.hidden = !tile.dataset.name.includes(search.value.toLowerCase());});
    status.textContent = 'Black silhouettes are items not yet obtained.';
    return;
  }
  let rows = [];
  const render = () => {
    const body = document.querySelector('tbody');body.replaceChildren();
    for (const player of rows.filter(row => row.name.toLowerCase().includes(search.value.toLowerCase()))) {
      const row = document.createElement('tr'), rank = document.createElement('td'), name = document.createElement('td'), value = document.createElement('td'), link = document.createElement('a');
      rank.textContent = player.rank;link.textContent = player.name;link.href = `?board=collection&player=${player.account}`;name.append(link);value.textContent = player[board].toLocaleString();row.append(rank, name, value);body.append(row);
    }
  };
  search.addEventListener('input', render);
  const refresh = async () => {
    try {
      const scores = await json('/api/hiscores');rows = ranked(scores.players, board);render();
      status.textContent = rows.length ? '' : 'No ranked players yet.';
    } catch (error) {status.textContent = `Update failed: ${error.message}. Previously loaded records may be stale.`;}
  };
  await refresh();setInterval(refresh, 60000);
}
if (typeof document !== 'undefined') start().catch(error => {document.querySelector('#status').textContent = error.message;console.error(error);});
