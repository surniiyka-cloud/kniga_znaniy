const CACHE="tian-kb-v2-92";
const CORE=["./","./index.html","./css/app.css","./css/admin.css","./js/app.js","./js/admin.js","./js/router.js","./js/search.js","./js/storage.js","./assets/brand/favicon.svg"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  const isImage=url.pathname.includes("/img/photos/")||event.request.destination==="image";
  if(isImage){
    // Фото всегда проверяем в сети первым. Раньше service worker возвращал
    // успешную картинку из кэша бесконечно, поэтому замена файла в GitHub
    // могла не появляться ни в редакторе, ни в самой Книге знаний.
    event.respondWith(caches.open(CACHE).then(async cache=>{
      const key=new Request(url.origin+url.pathname);
      try{
        const response=await fetch(event.request,{cache:"no-store"});
        if(response.ok&&/image\//i.test(response.headers.get("content-type")||"")){
          event.waitUntil(cache.put(key,response.clone()).catch(()=>{}));
          return response;
        }
        const cached=await cache.match(key);
        return cached&&cached.ok?cached:response;
      }catch(err){
        const cached=await cache.match(key);
        if(cached&&cached.ok)return cached;
        throw err;
      }
    }).catch(()=>fetch(event.request,{cache:"no-store"})));
    return;
  }
  const isFreshAsset=url.pathname.includes("/data/")||/\.(?:js|css|html)$/i.test(url.pathname);
  if(event.request.mode==="navigate"||isFreshAsset){
    const cacheKey=new Request(url.origin+url.pathname);
    event.respondWith(fetch(event.request,{cache:"no-store"}).then(response=>{
      if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(cacheKey,copy)).catch(()=>{}));}
      return response;
    }).catch(()=>caches.match(cacheKey).then(x=>x||(event.request.mode==="navigate"?caches.match("./index.html"):Response.error()))));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit=>hit&&hit.ok?hit:fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{}));}
    return response;
  })));
});