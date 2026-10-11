const CACHE="finora-v10";
const ASSETS=["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./icon.svg","./supabase-config.js","./cloud.js","./icons.js","./fonts/manrope-cyrillic-wght-normal.woff2","./fonts/manrope-cyrillic-ext-wght-normal.woff2","./fonts/manrope-latin-wght-normal.woff2"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
/* свои файлы: сначала сеть (обновления видны сразу), офлайн — из кэша; библиотека Supabase с CDN: из кэша; запросы к API не трогаем */
self.addEventListener("fetch",e=>{
 const req=e.request;if(req.method!=="GET")return;
 const url=new URL(req.url);
 if(url.origin===location.origin){
  e.respondWith(fetch(req).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));}return r;}).catch(()=>caches.match(req).then(hit=>hit||caches.match("./index.html"))));
 }else if(url.hostname==="cdn.jsdelivr.net"){
  e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));return r;})));
 }
});
