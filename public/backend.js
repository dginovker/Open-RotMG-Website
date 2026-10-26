(() => {
  const configured = document.querySelector('meta[name="openrotmg-api"]');
  if (!configured) throw new Error('Game API origin is missing from this page.');
  const origin = new URL(configured.content);
  const url = path => {
    const target = new URL(path, origin);
    if (target.origin !== origin.origin) throw new Error('Game API request changed origin.');
    return target;
  };
  window.OpenRotMGBackend = {url, fetch: (path, options) => fetch(url(path), options)};
})();
