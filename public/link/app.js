async function request(path, token, fetchImpl) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Run /link in Discord again.');
  // CORS mode preserves Origin under no-referrer: https://fetch.spec.whatwg.org/#append-a-request-origin-header
  const response = await fetchImpl(path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({token}), credentials: 'include', mode: 'cors', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000)});
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Linking unavailable (${response.status})`);
  return result;
}
export async function startLink(token, origin, fetchImpl = globalThis.OpenRotMGBackend.fetch) {
  const result = await request('/api/account/link/start', token, fetchImpl);
  if (result.state === 'signed_out') return result;
  if (result.state !== 'authorize') throw new Error('Invalid linking response');
  const url = new URL(result.url);
  if (url.origin !== 'https://discord.com' || url.pathname !== '/oauth2/authorize' || url.username || url.password || url.hash || url.searchParams.get('redirect_uri') !== origin + '/api/account/link/callback' || url.searchParams.get('scope') !== 'identify' || !/^[a-f0-9]{64}$/.test(url.searchParams.get('state'))) throw new Error('Invalid Discord authorization response');
  return {state: 'authorize', url: url.href};
}
export async function completeLink(token, fetchImpl = globalThis.OpenRotMGBackend.fetch) {
  const result = await request('/api/account/link/complete', token, fetchImpl);
  if (typeof result.name !== 'string' || !result.name) throw new Error('Link completion could not be confirmed.');
  return result.name;
}
async function start() {
  const hash = location.hash.slice(1), query = location.search;
  history.replaceState(null, '', location.pathname);
  const status = document.querySelector('#status'), error = document.querySelector('#error'), signin = document.querySelector('#signin');
  function failed(reason) {signin.hidden = true;status.textContent = 'Couldn’t link account';error.textContent = reason.message;error.hidden = false;}
  const result = new URLSearchParams(hash);
  if (!query && result.has('result')) {
    try {
      const name = await completeLink(result.get('result'));
      status.textContent = 'Account linked!';
      document.querySelector('#account-name').textContent = name;
      document.querySelector('#success').hidden = false;
    } catch (reason) {failed(reason);}
    return;
  }
  if (!query && result.has('error')) {failed(new Error(result.get('error')));return;}
  if (query || !/^[a-f0-9]{64}$/.test(hash)) {status.textContent = 'Run /link in Discord to get a new link.';return;}
  let busy = false, stopped = false, timer;
  async function check() {
    if (busy || stopped) return;
    busy = true;
    clearTimeout(timer);
    try {
      const result = await startLink(hash, location.origin);
      if (result.state === 'authorize') {stopped = true;location.replace(result.url);}
      else {status.textContent = 'Sign into OpenRotMG';signin.hidden = false;timer = setTimeout(check, 2000);}
    } catch (reason) {stopped = true;failed(reason);}
    finally {busy = false;}
  }
  document.addEventListener('visibilitychange', () => {if (!document.hidden) void check();});
  void check();
}
if (typeof document !== 'undefined') {void start();addEventListener('hashchange', () => location.reload());}
