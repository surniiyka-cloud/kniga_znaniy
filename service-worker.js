const CACHE="tian-kb-v2-static-1";
const STATIC=["./","./index.html","./css/app.css","./js/app.js","./js/search.js","./js/router.js","./js/storage.js","./manifest.webmanifest"];
self.addEventListener("install",(event)=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",(event)=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("tian-kb-v2-")&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",(event)=>{
  const req=event.request;
  if(req.method!=="GET")return;
  const url=new URL(req.url);
  if(url.origin!==location.origin)return;
  if(url.pathname.includes("/data/")){
    event.respondWith(fetch(req).then(res=>{
      const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));return res;
    }).catch(()=>caches.match(req)));
    return;
  }
  if(url.pathname.includes("/img/photos/")){
    event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{
      const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));return res;
    })));
    return;
  }
  event.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(res=>{
    if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));}
    return res;
  })));
});
