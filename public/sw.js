const CACHE = 'ld-v2';
const SHELL = ['/', '/app.js', '/qr.js', '/manifest.webmanifest', '/icon-192.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('ld-v') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

// 他のアプリからの「共有」を受け取り、ページに引き渡す
async function handleShare(req) {
  const fd = await req.formData(), c = await caches.open('ld-share');
  for (const k of await c.keys()) await c.delete(k);
  let i = 0;
  for (const f of fd.getAll('files')) if (typeof f !== 'string') await c.put('/shared/' + i++, new Response(f, { headers: { 'X-Name': encodeURIComponent(f.name), 'Content-Type': f.type || 'application/octet-stream' } }));
  const text = ['title', 'text', 'url'].map((k) => fd.get(k)).filter(Boolean).join('\n');
  if (text) await c.put('/shared-text', new Response(text));
  return Response.redirect('/?shared=1', 303);
}
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method === 'POST' && u.pathname === '/share-target') return e.respondWith(handleShare(e.request));
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow('/'))));
});
