(async () => {
  const base = new URL('./', location.href);
  const socket = new URL('game', base);
  socket.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const player = window.RufflePlayer.newest().createPlayer();
  document.querySelector('#game').append(player);
  player.addEventListener('loadeddata', () => { document.querySelector('#startup').hidden = true; }, {once: true});
  await player.ruffle().load({
    url: new URL('client-data-repaired.swf', base).href,
    autoplay: 'on', splashScreen: false, unmuteOverlay: 'hidden', openUrlMode: 'deny', allowScriptAccess: false,
    preferredRenderer: 'wgpu-webgl', logLevel: 'info',
    urlRewriteRules: [
      [/^http:\/\/www\.realmofthemadgod\.com\//, new URL('legacy/', base).href],
      [/^http:\/\/(?:rotmgtesting|realmofthemadgod)\.appspot\.com\//, new URL('legacy/', base).href]
    ],
    socketProxy: [{ host: '127.0.0.1', port: 2050, proxyUrl: socket.href }]
  });
})().catch(error => {
  document.querySelector('#startup').hidden = true;
  const notice = document.querySelector('#load-error');
  notice.textContent = `2010 preview failed to load: ${error.message}`;
  notice.hidden = false;
  console.error(error);
});
