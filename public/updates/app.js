const discordId = value => typeof value === 'string' && /^[1-9]\d{16,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;
const timestamp = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
const renderedSources = new WeakMap();
export function validateFeed(feed) {
  if (!feed || (feed.synced_at === null ? feed.source !== null : !timestamp(feed.synced_at) || !feed.source || typeof feed.source !== 'object')) throw new Error('Malformed updates feed');
  if (feed.source === null) return feed;
  const {guild_id, channel_id, posts} = feed.source;
  if (!discordId(guild_id) || !discordId(channel_id) || !Array.isArray(posts) || posts.length > 100) throw new Error('Malformed updates source');
  let previous;
  for (const post of posts) {
    if (!discordId(post.id) || (previous && BigInt(post.id) >= BigInt(previous)) || typeof post.content !== 'string'
        || !post.content.trim() || post.content !== post.content.trim() || post.content.length > 8000
        || /[\x00-\x08\x0b-\x1f\x7f-\x9f\ufffe\uffff]/.test(post.content) || !timestamp(post.published_at)
        || !(post.edited_at === null || (timestamp(post.edited_at) && post.edited_at >= post.published_at))) throw new Error('Malformed update post');
    if (post.attachments !== undefined && (!Array.isArray(post.attachments) || post.attachments.length > 10
        || post.attachments.some(a => !a || typeof a.filename !== 'string' || !a.filename.trim() || a.filename.length > 256
          || typeof a.url !== 'string' || a.url.length > 2048 || !/^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\/[^\s#\x00-\x1f\x7f-\x9f]+$/.test(a.url)
          || !(a.content_type === null || (typeof a.content_type === 'string' && /^[\x20-\x7e]{1,128}$/.test(a.content_type)))))) throw new Error('Malformed update attachment');
    previous = post.id;
  }
  return feed;
}
export async function loadFeed(fetchImpl = globalThis.OpenRotMGBackend.fetch) {
  const response = await fetchImpl('/api/updates', {cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error(`Updates request failed (${response.status})`);
  return validateFeed(await response.json());
}
export function renderFeed(feed, document, now = Date.now()) {
  validateFeed(feed);
  const container = document.querySelector('#updates');
  const source = JSON.stringify(feed.source), changed = renderedSources.get(container) !== source, nodes = [];
  if (changed && feed.source) for (const post of feed.source.posts) {
    const article = document.createElement('article'), heading = document.createElement('h2'), permalink = document.createElement('a');
    const meta = document.createElement('p'), date = document.createElement('time'), original = document.createElement('a'), body = document.createElement('p');
    article.className = 'update'; article.id = post.id;
    const headline = post.content.split('\n', 1)[0];
    permalink.href = `#${post.id}`; permalink.textContent = headline; heading.append(permalink);
    date.dateTime = new Date(post.published_at * 1000).toISOString(); date.textContent = new Date(post.published_at * 1000).toLocaleDateString(undefined, {year: 'numeric', month: 'long', day: 'numeric'});
    meta.className = 'meta'; meta.append(date);
    if (post.edited_at !== null) meta.append(` · Edited ${new Date(post.edited_at * 1000).toLocaleDateString()}`);
    original.href = `https://discord.com/channels/${feed.source.guild_id}/${feed.source.channel_id}/${post.id}`; original.textContent = 'View original on Discord';
    meta.append(' · ', original);
    body.className = 'content'; body.textContent = post.content.slice(headline.length).trim();
    article.append(heading, meta, body);
    for (const attachment of post.attachments ?? []) {
      const figure = document.createElement('figure'), link = document.createElement('a');
      figure.className = 'attachment'; link.href = attachment.url; link.textContent = attachment.filename;
      let media;
      if (['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(attachment.content_type)) {
        media = document.createElement('img'); media.alt = attachment.filename; media.loading = 'lazy';
      } else if (['video/mp4', 'video/webm', 'video/ogg'].includes(attachment.content_type)) {
        media = document.createElement('video'); media.controls = true; media.preload = 'metadata'; media.playsInline = true;
        media.setAttribute('aria-label', attachment.filename);
      }
      if (media) {
        media.src = attachment.url;
        media.addEventListener('error', () => {
          const error = document.createElement('p'); error.setAttribute('role', 'status');
          error.textContent = `Unable to load attachment: ${attachment.filename}. The Discord URL may have expired; refresh the page to retry.`;
          figure.append(error);
        }, {once: true});
        figure.append(media);
      }
      figure.append(link); article.append(figure);
    }
    nodes.push(article);
  }
  // The minute polling must not replace a playing video when only synced_at changes.
  if (changed) {container.replaceChildren(...nodes); renderedSources.set(container, source);}
  document.querySelector('#status').textContent = feed.synced_at === null ? 'Updates have not been synced yet.'
    : `${feed.source.posts.length ? 'Recent updates' : 'No updates posted yet'}. Last synced ${new Date(feed.synced_at * 1000).toLocaleString()}.${now - feed.synced_at * 1000 > 300000 ? ' Sync is overdue; these posts may be out of date.' : ''}`;
}
async function start() {
  const refresh = async () => {
    try {renderFeed(await loadFeed(), document);}
    catch (error) {document.querySelector('#status').textContent = `${error.message}. Previously loaded posts may be out of date.`; console.error(error);}
  };
  await refresh();
  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView();
    else document.querySelector('#status').textContent += ' The linked update is not in the recent feed.';
  }
  setInterval(refresh, 60000);
}
if (typeof document !== 'undefined') void start();
