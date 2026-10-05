const CACHE="tian-kb-v2-42";
const CORE=["./","./index.html","./css/app.css","./css/admin.css","./js/app.js","./js/admin.js","./js/router.js","./js/search.js","./js/storage.js","./assets/brand/favicon.svg"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  const isFreshAsset=url.pathname.includes("/data/")||/\.(?:js|css|html)$/i.test(url.pathname);
  if(event.request.mode==="navigate"||isFreshAsset){
    const cacheKey=new Request(url.origin+url.pathname);
    event.respondWith(fetch(event.request,{cache:"no-store"}).then(r=>{
      const copy=r.clone();caches.open(CACHE).then(c=>c.put(cacheKey,copy));return r;
    }).catch(()=>caches.match(cacheKey).then(x=>x||caches.match("./index.html"))));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return r;})));
});
