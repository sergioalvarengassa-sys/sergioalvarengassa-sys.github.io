const version='contas-ccs-2';
const shell=['./','index.html','style.css','app.js','core.js','drive.js','import.js','fflate.js','config.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','privacidade.html'];
self.addEventListener('install', event => event.waitUntil(caches.open(version).then(cache => cache.addAll(shell))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(
  keys.filter(key => key.startsWith('contas-ccs-') && key!==version).map(key => caches.delete(key))
)).then(() => self.clients.claim())));
self.addEventListener('fetch',event => {
  const url=new URL(event.request.url);
  if (event.request.method!=='GET' || url.origin!==self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached=await caches.match(event.request);
    return cached || (event.request.mode==='navigate' ? caches.match('./') : Response.error());
  }));
});
