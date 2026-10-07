import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
function files(directory, prefix) { return readdirSync(directory, { withFileTypes: true }).flatMap(file => file.isDirectory() ? files(resolve(directory, file.name), `${prefix}/${file.name}`) : [`${prefix}/${file.name}`]); }
const editorAssets = files(resolve(publicDir, 'editor'), '/editor');
const lazyAssets = editorAssets.filter(path => path.startsWith('/editor/speech/'));
// Public Help is part of the offline shell, including its search index and curated screenshots.
const helpAssets = files(resolve(publicDir, 'help'), '/help').map(path => path.endsWith('/index.html') ? path.slice(0, -10) : path);
// Product pages and their local fonts/styles/consent UI are available offline after editor consent.
const pageAssets = files(publicDir, '').filter(path => path.endsWith('/index.html') && !path.startsWith('/api/') && !path.startsWith('/editor/')).map(path => path.slice(0, -10));
const siteAssets = files(resolve(publicDir, 'site'), '/site');
// Both routes share the same browser-origin workspace; the public home never stores records.
const assets = [...new Set(['/', '/app/', '/appearance.js', '/error.html', '/privacy/', '/license/', ...pageAssets, ...siteAssets, ...helpAssets, ...editorAssets.filter(path => !lazyAssets.includes(path))])];
const hash = createHash('sha256'); for (const path of [...assets, ...lazyAssets]) hash.update(readFileSync(resolve(publicDir, path.endsWith('/') ? `${path.slice(1)}index.html` : path.slice(1))));
const cacheName = `visual-nerve-shell-${hash.digest('hex').slice(0, 12)}`;
writeFileSync(resolve(publicDir, 'sw.js'), `// Static assets only. Application data lives exclusively in browser IndexedDB.
const cacheName = ${JSON.stringify(cacheName)};
const assets = ${JSON.stringify(assets)};
const lazyAssets = ${JSON.stringify(lazyAssets)};
self.addEventListener('install', event => event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets))));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const path = url.pathname === '/app' || url.pathname === '/app/index.html' ? '/app/' : url.pathname === '/index.html' ? '/' : url.pathname;
  if (!assets.includes(path) && !lazyAssets.includes(path)) return;
  event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(path)) || fetch(event.request).then(response => { if (response.ok && lazyAssets.includes(path)) cache.put(path, response.clone()); return response; })));
});
`);
console.log(`Built offline application shell: ${assets.length} local assets.`);
