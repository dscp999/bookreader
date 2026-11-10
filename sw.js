const C='reader-v12';const A=['./','index.html','style.css','app.js','manifest.json','jszip.min.js','epub.min.js','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(A.map(u=>new Request(u,{cache:'reload'})))));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C&&x!=='share').map(x=>caches.delete(x)))));self.clients.claim()});
// Web Share Target: receive an image shared from another app (e.g. Google Images long-press > share)
async function handleShare(req){
  try{const fd=await req.formData();const sc=await caches.open('share');
    const f=fd.get('image');
    if(f&&f.size)await sc.put('shared-image',new Response(f,{headers:{'Content-Type':f.type||'image/jpeg'}}));
    const txt=[fd.get('url'),fd.get('text'),fd.get('title')].filter(Boolean).join(' ');
    if(txt)await sc.put('shared-url',new Response(txt));
  }catch(e){}
  return Response.redirect(new URL('index.html?shared=1',self.registration.scope).href,303);
}
// network-first: always try the latest files, fall back to cache when offline
self.addEventListener('fetch',e=>{const r=e.request;const u=new URL(r.url);
 if(r.method==='POST'&&u.pathname.endsWith('/share-target')){e.respondWith(handleShare(r));return}
 if(r.method!=='GET'||u.origin!==location.origin)return;
 e.respondWith(fetch(r.url,{cache:'no-cache'}).then(res=>{if(res.ok){const c=res.clone();caches.open(C).then(x=>x.put(r,c))}return res}).catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||caches.match('index.html'))))});