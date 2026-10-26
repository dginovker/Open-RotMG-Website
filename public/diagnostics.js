window.OpenRotMGDiagnostics = {
  start(socketEndpoint, player) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const key = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    socketEndpoint.searchParams.set('diagnostics', key);
    if (window.OpenRotMGBugReport) window.OpenRotMGBugReport.start(key, player);
    // Startup downloads must not compete with telemetry for the same connection.
    player.addEventListener('loadeddata', () => {
      let build = 'pending';
      fetch(new URL('/diagnostics-build.json', document.baseURI), {cache: 'no-store'})
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        }).then(value => {
          for (const [field, length] of [['website', 40], ['client', 40], ['runtime', 16]]) {
            if (typeof value[field] !== 'string' || !new RegExp(`^[a-f0-9]{${length}}$`).test(value[field])) throw new Error(`Invalid diagnostic identity: ${field}`);
          }
          if (typeof value.dirty !== 'boolean' || (value.local_client !== undefined && value.local_client !== true)) throw new Error('Invalid diagnostic source qualification');
          // The server bounds the identity string, not the complete release-selection manifest.
          build = JSON.stringify({website: value.website, client: value.client, runtime: value.runtime, dirty: value.dirty,
            ...(value.local_client === true ? {local_client: true} : {})});
        })
        .catch(error => { build = 'unavailable'; console.error('Bug diagnostics build lookup failed', error); });

      // A separate probe cannot establish which renderer Ruffle actually uses.
      let renderer = null;
      let renderer_status;
      const canvas = document.createElement('canvas');
      try {
        const gl = canvas.getContext('webgl');
        if (!gl) renderer_status = 'webgl-unavailable';
        else {
          const info = gl.getExtension('WEBGL_debug_renderer_info');
          renderer_status = info ? 'separate-webgl-probe' : 'renderer-info-unavailable';
          if (info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)).slice(0, 512);
          gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
      } catch (error) {
        renderer_status = 'probe-error';
        console.error('Bug diagnostics graphics probe failed', error.name);
      }
      let frames = 0;
      let maxGap = 0;
      let previous = null;
      let longTasks = null;
      let longTaskMs = null;
      if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
        longTasks = 0;
        longTaskMs = 0;
        new PerformanceObserver(list => {
          for (const entry of list.getEntries()) { longTasks++; longTaskMs += entry.duration; }
        }).observe({type: 'longtask', buffered: false});
      }
      function frame(time) {
        if (previous !== null) maxGap = Math.max(maxGap, time - previous);
        previous = time;
        frames++;
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
      let hiddenDuringInterval = document.hidden;
      document.addEventListener('visibilitychange', () => { hiddenDuringInterval ||= document.hidden; });
      let since = performance.now();
      setInterval(async () => {
        const now = performance.now();
        const sample = {
          build, renderer, renderer_status, width: canvasWidth(), height: canvasHeight(),
          pixel_ratio: devicePixelRatio, hidden: document.hidden, hidden_during_interval: hiddenDuringInterval, frames,
          max_frame_gap_ms: maxGap, long_tasks: longTasks, long_task_ms: longTaskMs,
          elapsed_ms: now - since
        };
        since = now; frames = 0; maxGap = 0; hiddenDuringInterval = document.hidden;
        if (longTasks !== null) { longTasks = 0; longTaskMs = 0; }
        try {
          const response = await OpenRotMGBackend.fetch(`/api/diagnostics/${key}`, {
            method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(sample),
            signal: AbortSignal.timeout(3000), redirect: 'error'
          });
          // Title screens and world-transfer gaps do not have an active game socket.
          if (response.status !== 409 && !response.ok) console.error('Bug diagnostics upload rejected', response.status);
        } catch (error) { console.error('Bug diagnostics upload failed', error.name); }
      }, 5000);
      function canvasWidth() { return Math.round(document.querySelector('ruffle-player').getBoundingClientRect().width); }
      function canvasHeight() { return Math.round(document.querySelector('ruffle-player').getBoundingClientRect().height); }
    }, {once: true});
  }
};
