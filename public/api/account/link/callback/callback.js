try {
  const target = OpenRotMGBackend.url('/api/account/link/callback');
  target.search = location.search;
  history.replaceState(null, '', location.pathname);
  location.replace(target.href);
} catch (error) {
  document.querySelector('#status').textContent = 'Could not complete account linking: ' + error.message;
}
