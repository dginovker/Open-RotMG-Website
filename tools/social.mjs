export function socialMetadata(html, image) {
  if (/<meta\b[^>]*name="robots"[^>]*content="[^"]*noindex/.test(html)) return html;
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  const description = html.match(/<meta name="description" content="([^"]+)"/m)?.[1];
  const url = html.match(/<link rel="canonical" href="([^"]+)"/m)?.[1];
  if (!title || !description || !url) throw new Error('Public pages require a title, description and canonical URL for sharing');
  const tags = [
    ['property', 'og:type', 'website'], ['property', 'og:site_name', 'Open RotMG'],
    ['property', 'og:title', title], ['property', 'og:description', description], ['property', 'og:url', url],
    ['property', 'og:image', image], ['property', 'og:image:width', '1200'], ['property', 'og:image:height', '630'],
    ['property', 'og:image:alt', 'Open RotMG amulet over historical Realm of the Mad God gameplay. Recreating the 2012 realm.'],
    ['name', 'twitter:card', 'summary_large_image'], ['name', 'twitter:title', title],
    ['name', 'twitter:description', description], ['name', 'twitter:image', image]
  ].map(([attribute, name, content]) => `<meta ${attribute}="${name}" content="${content.replaceAll('"', '&quot;')}">`).join('\n');
  return html.replace('</head>', `${tags}\n</head>`);
}
