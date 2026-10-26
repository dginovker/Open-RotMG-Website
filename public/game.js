(async () => {
  if (!window.RufflePlayer) throw new Error('Pinned Ruffle runtime did not load.');
  const player = window.RufflePlayer.newest().createPlayer();
  document.querySelector('#game').append(player);
  const socketEndpoint = OpenRotMGBackend.url('/game');
  socketEndpoint.protocol = socketEndpoint.protocol === 'https:' ? 'wss:' : 'ws:';
  player.addEventListener('loadeddata', () => {
    document.querySelector('#game').dataset.loaded = 'true';
    document.querySelector('#startup').hidden = true;
  }, {once: true});
  window.OpenRotMGDiagnostics.start(socketEndpoint, player);
  const movies = {game: '/client.swf', editor: '/draw/native-texture-editor.swf'};
  const mode = document.querySelector('#game').dataset.mode;
  if (!Object.hasOwn(movies, mode)) throw new Error(`Unknown client mode: ${mode}`);
  if (mode === 'game') void OpenRotMGBackend.fetch('/health', {cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000)}).then(response => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }).catch(error => {
    const notice = document.querySelector('#load-error');
    notice.textContent = 'Game server unavailable. The website and client can still load. Try reconnecting shortly.';
    notice.hidden = false;
    console.error('Game server health check failed', error);
  });
  async function browserRequest(payload) {
    const response = await OpenRotMGBackend.fetch('/api/account/browser', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload), credentials: 'include', mode: 'cors', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000)});
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Invalid browser authentication error');
    if (result.state === 'waiting') return;
    if (result.tab !== payload.tab) throw new Error('Invalid browser authentication response');
    return result.tab;
  }
  const browser = mode === 'game' ? Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('') : null;
  const browserRules = browser ? [[/^https?:\/\/127\.0\.0\.1:8080\/char\/list$/, OpenRotMGBackend.url('/legacy-api/char/list').href + `?browser=${browser}`]] : [];
  await player.ruffle().load({
    url: new URL(movies[mode], document.baseURI).href,
    autoplay: 'on',
    splashScreen: false,
    unmuteOverlay: 'hidden',
    preferredRenderer: 'wgpu-webgl',
    openUrlMode: 'confirm',
    allowScriptAccess: false,
    logLevel: 'warn',
    credentialAllowList: [socketEndpoint.origin.replace(/^ws/, 'http')],
    socketProxy: [{ host: '127.0.0.1', port: 2050, proxyUrl: socketEndpoint.href }],
    urlRewriteRules: [
      ...browserRules,
      [/^https?:\/\/127\.0\.0\.1:8080\/(?=(?:char|account|fame|guild|picture)\/)/, OpenRotMGBackend.url('/legacy-api/').href],
      [/^https?:\/\/realmofthemadgod\.appspot\.com\/sfx\//, new URL('/sfx/', document.baseURI).href]
    ]
  });
  if (browser) {
    const timer = setInterval(() => void browserRequest({tab: browser}).catch(error => {
      clearInterval(timer);
      const notice = document.querySelector('#load-error');
      notice.textContent = 'Game connection failed: ' + error.message + '. The website and client are still available.';
      notice.hidden = false;
      console.error('Game browser authentication lost', error);
    }), 20000);
    addEventListener('pagehide', () => {
      clearInterval(timer);
      void OpenRotMGBackend.fetch('/api/account/browser/close', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({tab: browser}), credentials: 'include', mode: 'cors', keepalive: true}).catch(error => console.error('Browser sign-out could not be confirmed', error));
    }, {once: true});
  }
})().catch(error => {
  document.querySelector('#startup').hidden = true;
  const notice = document.querySelector('#load-error');
  notice.textContent = 'Client failed to load: ' + error.message;
  notice.hidden = false;
  console.error('Open RotMG client startup failed', error);
});
