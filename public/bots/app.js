// Server-sent events: `data:` lines per message, messages separated by a blank line.
export function events(buffer) {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n'), rest = parts.pop();
  return [parts.flatMap(part => {
    const data = part.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(line.startsWith('data: ') ? 6 : 5)).join('\n');
    return data ? [JSON.parse(data)] : [];
  }), rest];
}

export function viewMessage(event, origin, source, bot) {
  const data = event.data;
  return event.origin === origin && source != null && event.source === source &&
    data !== null && typeof data === 'object' && !Array.isArray(data) &&
    Object.keys(data).every(key => ['type', 'bot', 'status', 'error'].includes(key)) &&
    data.type === 'openrotmg-bot-view' && data.bot === bot &&
    ['connecting', 'live', 'stale', 'disconnected', 'error'].includes(data.status) &&
    (data.error === undefined || typeof data.error === 'string') &&
    (data.status !== 'error' || (typeof data.error === 'string' && data.error.trim().length > 0));
}

function llm(status) {
  if (!status.enabled) return 'Disabled on this server.';
  if (status.budget_scope !== 'process-local' || status.budget_resets_on_restart !== true || status.budget_window_seconds !== 86400 || status.provider_quota !== 'unknown' ||
      !['daily_requests', 'daily_limit', 'requests_remaining', 'automatic_limit', 'automatic_remaining', 'budget_window_resets_in_seconds', 'local_capacity_denials'].every(key => Number.isInteger(status[key]) && status[key] >= 0) || status.budget_window_resets_in_seconds > status.budget_window_seconds) throw new Error('malformed language-model allowance');
  return `${status.model}: ${status.status}. Process-local fixed 24 h allowance: ${status.daily_requests} of ${status.daily_limit} requests used, ${status.requests_remaining} remaining (${status.automatic_remaining} of ${status.automatic_limit} left for bot-initiated speech). Resets in ${status.budget_window_resets_in_seconds} s and on server restart. Actual provider quota: unknown. ${status.successes} succeeded, ${status.failures} failed, ${status.in_flight} in flight. Local capacity denials since restart: ${status.local_capacity_denials} (no provider requests).` +
    (status.last_latency_ms === null ? '' : ` Last reply took ${status.last_latency_ms} ms.`) + (status.last_error ? ` Last error: ${status.last_error}.` : '');
}

export function start({document, window, backend, now = Date.now}) {
  const $ = selector => document.querySelector(selector);
  const origin = backend.url('/api/bots').origin;
  let selected = new URLSearchParams(window.location.search).get('bot'), active, refreshId = 0;
  const current = session => active === session && !session.controller.signal.aborted;
  function nativeStatus(session, status, error) {
    session.native = status;session.nativeAt = now();
    $('#view-status').textContent = `Native view: ${status}${error ? ` — ${error}` : '.'}`;
  }
  function telemetryStatus(session) {
    const elapsed = session.received === undefined ? 0 : now() - session.received;
    const state = session.telemetry === 'receiving' && elapsed > 5000 ? 'stale' : session.telemetry;
    const age = session.age === undefined ? 'No decision received.' : `Last decision ${Math.round((session.age + elapsed) / 1000)} s ago.`;
    $('#telemetry-status').textContent = `Telemetry: ${state}. ${age}`;
  }
  function stop() {
    active?.controller.abort();active = undefined;
    $('#view').replaceChildren();$('#thoughts').replaceChildren();$('#vitals').textContent = '';
    $('#view-status').textContent = 'Native view: disconnected.';
    $('#telemetry-status').textContent = 'Telemetry: disconnected. No decision received.';
  }
  function show(session, update) {
    const {frame, age_ms: age, thoughts} = update;
    if (!(frame === null || (frame && typeof frame === 'object')) || !Array.isArray(thoughts) || !(Number.isFinite(age) && age >= 0)) throw new Error('malformed bot telemetry');
    session.age = frame === null ? undefined : age;session.received = now();session.telemetry = 'receiving';
    if (frame === null) $('#vitals').textContent = `${session.name} has not made a decision since the server started.`;
    else $('#vitals').textContent = `${session.name}, level ${frame.level} ${frame.class} in ${frame.world}. HP ${frame.hp}/${frame.max_hp}, MP ${frame.mp}/${frame.max_mp}. ${frame.reason[0].toUpperCase()}${frame.reason.slice(1)}.${frame.aim === null ? '' : frame.fired ? ' Shooting.' : ' Aiming.'}`;
    for (const thought of thoughts) {
      const item = document.createElement('li');
      item.textContent = `${new Date(thought.at).toLocaleTimeString()} ${thought.text}`;$('#thoughts').prepend(item);
    }
    while ($('#thoughts').children.length > 50) $('#thoughts').lastChild.remove();
    telemetryStatus(session);
  }
  async function watch(session) {
    while (current(session)) {
      let reader;
      try {
        session.telemetry = 'connecting';telemetryStatus(session);
        const response = await backend.fetch(`/api/bots/${encodeURIComponent(session.name)}/stream`, {cache: 'no-store', redirect: 'error', signal: session.controller.signal});
        if (!current(session)) return;
        if (!response.ok) throw new Error(`stream refused (HTTP ${response.status}): ${await response.text()}`);
        if (!response.body) throw new Error('stream response has no body');
        reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        // Reconnection replays the server's bounded thought history.
        $('#thoughts').replaceChildren();
        let buffer = '';
        while (current(session)) {
          const {value, done} = await reader.read();
          if (!current(session)) return;
          if (done) throw new Error('the server closed the stream');
          let updates;[updates, buffer] = events(buffer + value);
          for (const update of updates) show(session, update);
        }
      } catch (error) {
        if (!current(session)) return;
        session.telemetry = `error — ${error.message}. Retrying in 5 s`;telemetryStatus(session);console.error(error);
      } finally {
        if (reader) await reader.cancel().catch(error => {if (current(session)) console.error(error);});
      }
      if (!current(session)) return;
      await new Promise(resolve => {
        const finish = () => {window.clearTimeout(timer);session.controller.signal.removeEventListener('abort', finish);resolve();};
        const timer = window.setTimeout(finish, 5000);
        session.controller.signal.addEventListener('abort', finish, {once: true});
      });
    }
  }
  function select(name) {
    stop();
    const session = active = {name, controller: new AbortController(), telemetry: 'connecting'};
    const iframe = session.iframe = document.createElement('iframe');
    iframe.title = `Read-only native gameplay for ${name}`;
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframe.setAttribute('allow', "autoplay 'none'; camera 'none'; microphone 'none'; fullscreen 'none'; gamepad 'none'");
    iframe.referrerPolicy = 'no-referrer';
    iframe.src = backend.url(`/api/bots/${encodeURIComponent(name)}/view`).href;
    iframe.addEventListener('error', () => {if (current(session)) nativeStatus(session, 'error', 'native page failed to load');});
    $('#view').replaceChildren(iframe);nativeStatus(session, 'connecting');telemetryStatus(session);
    void watch(session);
  }
  function message(event) {
    if (!active || !viewMessage(event, origin, active.iframe.contentWindow, active.name)) return;
    nativeStatus(active, event.data.status, event.data.error);
  }
  async function refresh() {
    const id = ++refreshId;
    try {
      const response = await backend.fetch('/api/bots', {cache: 'no-store', redirect: 'error'});
      if (id !== refreshId) return;
      if (!response.ok) throw new Error(`bot list failed (HTTP ${response.status}): ${await response.text()}`);
      const list = await response.json();
      if (id !== refreshId) return;
      if (!Array.isArray(list.bots) || !list.bots.every(bot => bot && typeof bot.name === 'string' && bot.name.length) || !list.llm || typeof list.llm !== 'object') throw new Error('malformed bot list');
      $('#llm').textContent = llm(list.llm);
      const picker = $('#bot');
      selected ??= list.bots[0]?.name;
      picker.replaceChildren(...list.bots.map(bot => {
        const option = document.createElement('option');option.value = bot.name;
        option.textContent = bot.frame ? `${bot.name} (level ${bot.frame.level} ${bot.frame.class}, ${bot.frame.reason})` : bot.name;
        return option;
      }));
      picker.value = selected ?? '';picker.disabled = !list.bots.length;
      if (!list.bots.some(bot => bot.name === selected)) {
        stop();$('#status').textContent = selected ? `Bot ${selected} is offline or unavailable. Pick another bot.` : 'No bots are running on this server.';return;
      }
      $('#status').textContent = `Selected ${selected}.`;
      if (active?.name !== selected) select(selected);
    } catch (error) {
      if (id !== refreshId) return;
      $('#status').textContent = `Bot list error: ${error.message}. Retrying in 10 s.`;console.error(error);
    }
  }
  function change(event) {
    selected = event.target.value;
    window.history.replaceState(null, '', `?bot=${encodeURIComponent(selected)}`);
    $('#status').textContent = `Selected ${selected}.`;select(selected);
  }
  $('#bot').addEventListener('change', change);window.addEventListener('message', message);
  const tick = window.setInterval(() => {
    if (!active) return;
    telemetryStatus(active);
    if (['live', 'connecting'].includes(active.native) && now() - active.nativeAt > 15000) nativeStatus(active, active.native === 'live' ? 'stale' : 'error', 'no native status received for 15 s');
  }, 1000);
  const polling = window.setInterval(() => {void refresh();}, 10000);
  void refresh();
  return () => {++refreshId;stop();window.clearInterval(tick);window.clearInterval(polling);window.removeEventListener('message', message);$('#bot').removeEventListener('change', change);};
}

if (typeof document !== 'undefined') start({document, window, backend: window.OpenRotMGBackend});
