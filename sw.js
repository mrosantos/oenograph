// Oenograph service worker: offline use + local bottle photos.
const V='oeno-v5',CORE=['./','./index.html','./standalone.js','./lang.js','./lang-es.js','./lang-es-b.js','./manifest.webmanifest','./fonts/italiana.woff2','./icon-oe-192.png','./icon-oe-512.png','./touch-oe.png'];
const idbGet=id=>new Promise((ok,no)=>{const r=indexedDB.open('oeno-photos',1);r.onupgradeneeded=()=>r.result.createObjectStore('p',{keyPath:'id'});
  r.onsuccess=()=>{const d=r.result,q=d.transaction('p').objectStore('p').get(id);q.onsuccess=()=>{d.close();ok(q.result)};q.onerror=()=>{d.close();no(q.error)}};r.onerror=()=>no(r.error)});
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  const m=u.pathname.match(/\/_blob\/([0-9a-f]+)$/);
  if(m){
    e.respondWith(idbGet(m[1]).then(r=>r&&r.blob?new Response(r.blob,{headers:{'content-type':r.blob.type||'image/jpeg','cache-control':'no-store'}}):new Response('',{status:404})).catch(()=>new Response('',{status:404})));
    return;
  }
  // Network first, so updates arrive as soon as you're online; cache when offline.
  e.respondWith(
    Promise.race([fetch(e.request,{cache:'no-cache'}),new Promise((_,no)=>setTimeout(no,4500))])
      .then(r=>{if(r&&r.ok){const c=r.clone();caches.open(V).then(x=>x.put(e.request,c))}return r})
      .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('./index.html')))
  );
});
