export function passwordValid(password) {
  const bytes = new TextEncoder().encode(password).length;
  return bytes >= 5 && bytes <= 128 && !/\p{Cc}/u.test(password);
}
export async function submitReset(token, password, fetchImpl = globalThis.OpenRotMGBackend.fetch) {
  if (!/^[a-f0-9]{64}$/.test(token) || !passwordValid(password)) throw new Error('Invalid reset link or password');
  const response = await fetchImpl('/api/account/recover', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({token, password}), credentials: 'omit', mode: 'cors', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(25000)});
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : `Reset rejected (${response.status})`);
  if (result.reset !== true) throw new Error('Invalid reset confirmation');
}
function start() {
  let token = location.hash.slice(1);
  const valid = /^[a-f0-9]{64}$/.test(token) && !location.search;
  history.replaceState(null, '', location.pathname);
  const status = document.querySelector('#status'), form = document.querySelector('#reset');
  if (!valid) {status.textContent = 'Open the private reset link from /recover in Discord. Use /link in Discord to enable recovery.';return;}
  status.textContent = 'This private link expires after 15 minutes and can only be used once.';
  form.hidden = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const password = document.querySelector('#password'), confirm = document.querySelector('#confirm'), button = form.querySelector('button');
    if (!passwordValid(password.value)) {status.textContent = 'Use 5–128 UTF-8 bytes without control characters.';return;}
    if (password.value !== confirm.value) {status.textContent = 'The passwords do not match.';return;}
    button.disabled = true;status.textContent = 'Saving your game session and resetting the password…';
    try {
      await submitReset(token, password.value);
      token = '';form.reset();form.hidden = true;
      status.textContent = 'Password reset. Sign into the game with your existing email and new password.';
    } catch (error) {
      status.textContent = `Completion could not be confirmed: ${error.message}. If the connection was interrupted, try signing in with the new password before requesting another reset link.`;
    } finally {button.disabled = false;}
  });
}
// A new fragment must not retain the previous form's grant or password.
if (typeof document !== 'undefined') {start();addEventListener('hashchange', () => location.reload());}
