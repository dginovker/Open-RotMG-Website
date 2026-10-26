window.OpenRotMGBugReport = {
  start(key, player) {
    const panel = document.querySelector('#bug-report');
    const form = document.querySelector('#bug-form');
    const description = document.querySelector('#bug-description');
    const image = document.querySelector('#bug-screenshot');
    const status = document.querySelector('#bug-status');
    const submit = form.querySelector('button[type="submit"]');
    const refresh = document.querySelector('#bug-refresh');
    const link = document.querySelector('a[href="/#bug-report"]');
    let screenshot, reportId, loaded = false, submitting = false;
    async function capture() {
      if (submitting || reportId) return;
      submit.disabled = true;
      if (!loaded) { status.textContent = 'Waiting for the game image…'; return; }
      status.textContent = 'Capturing your game…';
      try {
        screenshot = await new Promise((resolve, reject) => requestAnimationFrame(() => {
          try {
            const canvas = player.shadowRoot.querySelector('canvas');
            if (!canvas || !canvas.width || !canvas.height) throw new Error('Game image is not available yet.');
            const copy = document.createElement('canvas');
            copy.width = canvas.width; copy.height = canvas.height;
            copy.getContext('2d').drawImage(canvas, 0, 0);
            resolve(copy.toDataURL('image/png'));
          } catch (error) { reject(error); }
        }));
        if (screenshot.length > 1_400_022) throw new Error('Game screenshot exceeds 1 MiB.');
        image.src = screenshot;
        image.hidden = false;
        submit.disabled = false;
        status.textContent = '';
      } catch (error) {
        screenshot = undefined;
        submit.disabled = true;
        image.hidden = true;
        status.textContent = 'Screenshot failed: ' + error.message + ' Use Refresh screenshot to try again.';
      }
    }
    function open() {
      panel.hidden = false;
      link.setAttribute('aria-expanded', 'true');
      void capture();
      panel.scrollIntoView({block: 'nearest'});
    }
    refresh.addEventListener('click', () => void capture());
    player.addEventListener('loadeddata', () => {
      loaded = true;
      setTimeout(() => {
        if (!panel.hidden && !screenshot) void capture();
      }, 0);
    }, {once: true});
    link.setAttribute('aria-controls', 'bug-report');
    link.setAttribute('aria-expanded', 'false');
    link.addEventListener('click', event => { event.preventDefault(); open(); });
    if (location.hash === '#bug-report') open();
    async function publication() {
      const deadline = Date.now() + 60000;
      status.textContent = 'Report saved. Creating the GitHub issue…';
      while (Date.now() < deadline) {
        const response = await OpenRotMGBackend.fetch(`/api/bug-reports/${reportId}/status`, {
          cache: 'no-store', signal: AbortSignal.timeout(5000), redirect: 'error'
        });
        if (!response.ok) throw new Error(`Publication lookup failed (HTTP ${response.status}).`);
        const result = await response.json();
        if (result.url !== null) {
          if (typeof result.url !== 'string' || !/^https:\/\/github\.com\/OpenRotMG\/Open-RotMG-Server\/issues\/[1-9]\d*$/.test(result.url)) throw new Error('Invalid GitHub issue link.');
          const issue = document.createElement('a');
          issue.href = result.url;
          issue.textContent = 'View GitHub issue #' + result.url.split('/').at(-1);
          status.replaceChildren(issue);
          description.value = '';
          reportId = undefined;
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      throw new Error('GitHub publication is taking longer than expected.');
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submit.disabled || submitting) return;
      submitting = true;
      submit.disabled = true;
      refresh.disabled = true;
      description.disabled = true;
      status.textContent = 'Submitting report…';
      try {
        if (!reportId) {
          if (!description.value.trim()) throw new Error('Describe the bug before submitting.');
          if (!screenshot) throw new Error('Refresh the game screenshot before submitting.');
          const response = await OpenRotMGBackend.fetch(`/api/diagnostics/${key}/report`, {
            method: 'POST', headers: {'content-type': 'application/json'},
            body: JSON.stringify({message: description.value, screenshot: screenshot.slice('data:image/png;base64,'.length)}),
            signal: AbortSignal.timeout(35000), redirect: 'error'
          });
          const result = await response.json();
          if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Report rejected (HTTP ${response.status}).`);
          if (!/^[a-f0-9]{24}$/.test(result.id)) throw new Error('Invalid submission confirmation; check the bug backlog before retrying.');
          reportId = result.id;
        }
        await publication();
      } catch (error) {
        status.textContent = reportId
          ? 'Your report is saved. ' + error.message + ' Use Check report link to check again without resubmitting.'
          : 'Could not confirm submission: ' + error.message + ' Your description has been kept.';
      } finally {
        submitting = false;
        submit.disabled = false;
        description.disabled = Boolean(reportId);
        refresh.disabled = Boolean(reportId);
        submit.textContent = reportId ? 'Check report link' : 'Submit bug report';
      }
    });
  }
};
