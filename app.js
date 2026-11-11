'use strict';
const $=s=>document.querySelector(s);
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
// ---- IndexedDB ----
const dbp=new Promise((res,rej)=>{const r=indexedDB.open('reader',3);
  r.onupgradeneeded=e=>{const db=r.result;
    if(!db.objectStoreNames.contains('books'))db.createObjectStore('books',{keyPath:'id'});
    if(!db.objectStoreNames.contains('files'))db.createObjectStore('files',{keyPath:'id'});
    if(!db.objectStoreNames.contains('covers'))db.createObjectStore('covers',{keyPath:'id'});
    if(e.oldVersion===1){const t=r.transaction,bs=t.objectStore('books'),fl=t.objectStore('files');
      bs.openCursor().onsuccess=ev=>{const c=ev.target.result;if(!c)return;const v=c.value;if(v.data){fl.put({id:v.id,data:v.data});delete v.data;c.update(v)}c.continue()}}};
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
async function tx(stores,mode,fn){const db=await dbp;return new Promise((res,rej)=>{const t=db.transaction(stores,mode);let q;try{q=fn(...[].concat(stores).map(s=>t.objectStore(s)))}catch(e){rej(e);return}t.oncomplete=()=>res(q&&q.result);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)})}
const dbAll=()=>tx('books','readonly',s=>s.getAll());
async function dbGet(id){const m=await tx('books','readonly',s=>s.get(id));if(!m)return m;const f=await tx('files','readonly',s=>s.get(id));if(f)m.data=f.data;return m}
const dbPut=b=>{const m=Object.assign({},b);delete m.data;return tx('books','readwrite',s=>s.put(m))};
const dbAdd=(m,data)=>tx(['books','files'],'readwrite',(b,f)=>{f.put({id:m.id,data});return b.put(m)});
const dbDel=id=>tx(['books','files'],'readwrite',(b,f)=>{f.delete(id);return b.delete(id)});
const CV=new Map();
const cvGet=id=>CV.has(id)?CV.get(id):null;
function cvSet(id,u){CV.set(id,u);tx('covers','readwrite',s=>s.put({id,data:u})).catch(()=>{})}
function cvDel(id){if(!CV.has(id))return;CV.delete(id);tx('covers','readwrite',s=>s.delete(id)).catch(()=>{})}
const cvReady=(async()=>{try{await dbp;const all=await tx('covers','readonly',s=>s.getAll());for(const r of all||[])CV.set(r.id,r.data);
  const mig=Object.keys(localStorage).filter(k=>k.startsWith('c_'));
  for(const k of mig){const id=k.slice(2),v=localStorage.getItem(k);if(v!=null){if(!CV.has(id)){CV.set(id,v);await tx('covers','readwrite',s=>s.put({id,data:v})).catch(()=>{})}localStorage.removeItem(k)}}
}catch(e){}})();
function toast(msg,sticky){let t=document.getElementById('toast');if(!t){t=document.createElement('div');t.id='toast';document.body.appendChild(t)}t.textContent=msg;t.style.display='block';clearTimeout(t._h);if(!sticky)t._h=setTimeout(()=>t.style.display='none',2200)}
// ---- settings ----
const APP_NUM=35;
const S=Object.assign({theme:'dark',fs:20,lh:1.7,mg:20,ff:'serif',flow:'paginated',spread:'auto',coverSize:'M',space:'n',join:'auto',comicMode:'auto',comicDir:'ltr'},JSON.parse(localStorage.getItem('rs')||'{}'));
let resetScrollOnce=false,pendingScrollY=null,libY=0;
let curShelf=Math.max(0,Math.min(3,+localStorage.getItem('curShelf')||0));
const saveS=()=>localStorage.setItem('rs',JSON.stringify(S));
function applyTheme(){document.body.className='t-'+S.theme}
applyTheme();
const getP=id=>{try{return JSON.parse(localStorage.getItem('p_'+id)||'null')}catch(_){return null}};
const setP=()=>{if(cur)localStorage.setItem('p_'+cur.id,JSON.stringify({pos:cur.pos,pct:cur.pct,sig:cur.sig}))};
const saveBM=()=>localStorage.setItem('b_'+cur.id,JSON.stringify(cur.bookmarks||[]));
// ---- library ----
let view=localStorage.getItem('view')||'shelf',sortBy=localStorage.getItem('sort')||'recent',editMode=false,coverBusy=false;
function hueOf(s){let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))%360;return h}
const STY=[['#8e2de2','#4a00e0'],['#c31432','#240b36'],['#134e5e','#71b280'],['#d38312','#a83279'],['#1e3c72','#2a5298'],['#0f2027','#2c5364'],['#614385','#516395'],['#b92b27','#1565c0'],['#4b6cb7','#182848'],['#3a1c71','#d76d77'],['#355c7d','#c06c84'],['#232526','#5a5a5a']];
function styBg(n){const s=STY[n%STY.length];return 'linear-gradient(135deg,'+s[0]+','+s[1]+')'}
function coverEl(b){
  const d=document.createElement('div');d.className='cover';const c=cvGet(b.id);
  if(c&&c.startsWith('style:')){d.style.background=styBg(+c.slice(6));d.classList.add('fr');const s=document.createElement('span');s.textContent=b.title;d.appendChild(s)}
  else if(c&&c!=='none'&&c!=='x'){d.style.backgroundImage='url("'+c+'")';d.classList.add('img')}
  else{const h=hueOf(b.title);d.style.background='linear-gradient(135deg,hsl('+h+',45%,38%),hsl('+((h+30)%360)+',50%,22%))';const s=document.createElement('span');s.textContent=b.title;d.appendChild(s)}
  return d;
}
async function epubInfo(data){
  let url=null,title=null;const T=ms=>new Promise(r=>setTimeout(()=>r(null),ms));
  try{const bk=ePub(data.slice(0));
    try{const md=await Promise.race([bk.loaded.metadata,T(6000)]);title=md&&md.title?String(md.title).trim():null}catch(_){}
    try{const u=await Promise.race([bk.coverUrl(),T(6000)]);if(u){const bl=await (await fetch(u)).blob();url=await blobToCover(bl)}}catch(_){}
    bk.destroy()}catch(_){}
  return {url,title};
}
async function blobToCover(bl){const im=await createImageBitmap(bl);const w=240,h=Math.round(im.height*w/im.width);
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').drawImage(im,0,0,w,h);return cv.toDataURL('image/jpeg',0.82)}
async function urlToCover(u){try{const r=await fetch(u);if(!r.ok)throw 0;const bl=await r.blob();if(bl.size<500)throw 0;return await blobToCover(bl)}catch(_){return u}}
// ---- online cover search ----
const norm=s=>(s||'').toLowerCase().replace(/[\s\-_.,:;!?'"()\[\]{}~·]+/g,'');
function cleanTitle(t){let s=String(t).replace(/\.(txt|epub|zip|cbz)$/i,'');const orig=s;let prev;
  do{prev=s;s=s.replace(/[(\[（［【〔][^()\[\]（）［］【】〔〕]*[)\]）］】〕]/g,' ')}while(s!==prev);
  s=s.replace(/[(\[（［【〔][^)\]）］】〕]*$/,' ');
  s=s.replace(/[(\[（）［］【】〔〕)\]]/g,' ');
  s=s.replace(/\d+\s*[-~]\s*\d+\s*(화|권|부)?/g,' ').replace(/(완결|외전포함|외전|합본|전권|최종본|무삭제)/g,' ').replace(/_+/g,' ').replace(/\s+/g,' ').trim();
  return s||orig.replace(/[(\[（）［］【】〔〕)\]]/g,' ').replace(/\s+/g,' ').trim()}
function variants(t){const c=cleanTitle(t);const v=[c,c.replace(/\s*\d+\s*(권|화|부)?$/,'').trim(),c.split(/\s[-–:]\s/)[0].trim()];return [...new Set(v.filter(x=>x&&x.length>=2))]}
async function searchCovers(q){
  const out=[];let netErr=false;
  const J=async u=>{try{const r=await fetch(u);if(!r.ok){netErr=true;return null}return await r.json()}catch(_){netErr=true;return null}};
  const [g,ol,wk]=await Promise.all([
    J('https://www.googleapis.com/books/v1/volumes?maxResults=10&printType=books&q='+encodeURIComponent(q)),
    J('https://openlibrary.org/search.json?limit=8&fields=title,cover_i&q='+encodeURIComponent(q)),
    J('https://ko.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=4&gsrsearch='+encodeURIComponent(q)+'&prop=pageimages&piprop=thumbnail&pithumbsize=300')]);
  for(const i of (g&&g.items)||[]){const l=i.volumeInfo&&i.volumeInfo.imageLinks;if(l&&(l.thumbnail||l.smallThumbnail))out.push({src:'g',title:i.volumeInfo.title||'',url:(l.thumbnail||l.smallThumbnail).replace('http:','https:').replace('&edge=curl','').replace('zoom=1','zoom=2')})}
  for(const d of (ol&&ol.docs)||[])if(d.cover_i)out.push({src:'o',title:d.title||'',url:'https://covers.openlibrary.org/b/id/'+d.cover_i+'-M.jpg'});
  for(const p of Object.values((wk&&wk.query&&wk.query.pages)||{}))if(p.thumbnail&&!/\.svg/i.test(p.thumbnail.source))out.push({src:'w',title:p.title,url:p.thumbnail.source});
  return {list:out,netErr};
}
function bestMatch(list,q){const n=norm(q);let best=null,bs=0;
  for(const r of list){const t=norm(r.title);let sc=0;if(t===n)sc=4;else if(t.includes(n)||(t.length>=2&&n.includes(t)))sc=3;else if(r.src!=='w'&&n.length>=3&&t.startsWith(n.slice(0,3)))sc=1;
    if(r.src==='w'&&sc<4)sc=0;if(sc>bs){bs=sc;best=r}}
  return best;}
async function autoCoverFor(title){
  let err=false;
  for(const v of variants(title)){const {list,netErr}=await searchCovers(v);if(netErr)err=true;const b=bestMatch(list,v);if(b)return {url:await urlToCover(b.url)};}
  return {url:null,err};
}
const autoOn=()=>localStorage.getItem('autocover')!=='0';
const triedSess=new Set();
let _rr;const softRender=()=>{clearTimeout(_rr);_rr=setTimeout(()=>{if(!$('#lib').hidden)renderLib(true)},400)};
let coverRerun=false;
const nativeOK=()=>!!(window.Android&&typeof Android.autoCover==='function');
function bumpStat(ok){let s={ok:0,fail:0};try{s=JSON.parse(localStorage.getItem('autoStat')||'')||s}catch(_){}ok?s.ok++:s.fail++;localStorage.setItem('autoStat',JSON.stringify(s))}
const getFail=id=>{try{return JSON.parse(localStorage.getItem('f_'+id)||'null')}catch(_){return null}};
const failWait=n=>(n<=1?1:n===2?3:14)*86400000;
function markFail(id,n){const f=getFail(id)||{n:0};localStorage.setItem('f_'+id,JSON.stringify({t:Date.now(),n:n||f.n+1}))}
const needCover=b=>{const c=cvGet(b.id);if(c&&c!=='none')return false;if(triedSess.has(b.id))return false;const f=getFail(b.id);return !(f&&f.n>=2)};
const needManual=b=>{if(b.type==='comic')return false;const c=cvGet(b.id);if(c&&c!=='none')return false;const f=getFail(b.id);return !!(f&&f.n>=2)};
async function ensureCovers(){
  if(!autoOn())return;
  if(coverBusy){coverRerun=true;return}
  const hasNative=nativeOK();
  if(hasNative&&localStorage.getItem('autoMig2')!=='1'){for(const b of libCache){if(cvGet(b.id)==='x'&&localStorage.getItem('k_'+b.id)!=='1')cvDel(b.id);localStorage.removeItem('f_'+b.id)}localStorage.setItem('autoMig2','1')}
  const todo=libCache.filter(needCover);
  if(!todo.length)return;
  coverBusy=true;let k=0,done=0;const total=todo.length;toast('표지 찾는 중 0/'+total,true);
  const w=async()=>{while(k<todo.length){const b=todo[k++];triedSess.add(b.id);
    try{let u=null,err=false,nt=false;
      if(b.type==='epub'){const full=await dbGet(b.id);if(full){const info=await epubInfo(full.data);u=info.url;
        if(info.title&&info.title!==b.title){const m=libCache.find(x=>x.id===b.id);if(m){m.title=info.title;await dbPut(m)}}}}
      if(!u&&b.type==='comic'){const full=await dbGet(b.id);if(full)u=await comicCover(full.data)}
      if(!u&&b.type!=='comic'&&hasNative){nt=true;u=await nativeAuto(b);bumpStat(!!u)}
      if(!u&&b.type!=='comic'){const r=await autoCoverFor(b.title);u=r.url;err=r.err&&!u}
      if(u){try{cvSet(b.id,u)}catch(_){}localStorage.removeItem('f_'+b.id)}
      else if(!err&&!nt)markFail(b.id,2);
      else markFail(b.id);
      softRender();
    }catch(_){}
    done++;toast('표지 찾는 중 '+done+'/'+total,true);
    await new Promise(r=>setTimeout(r,120))}};
  try{await Promise.all([w(),w(),w()]);toast('표지 검색 완료')}
  finally{coverBusy=false;
    const again=coverRerun||libCache.some(needCover);coverRerun=false;
    if(again)setTimeout(ensureCovers,400)}
}
// ---- manual cover picker ----
let covBook=null;
function openCovSheet(b){covBook=b;$('#covSkip').hidden=!manualOn;$('#cov').hidden=false;$('#act').hidden=true;$('#covT').textContent='표지 선택 · '+b.title;buildStyles();$('#covQ').value=cleanTitle(b.title)||b.title;$('#covRes').innerHTML='';$('#covGo').click()}
$('#covGo').onclick=async()=>{
  const q=$('#covQ').value.trim();if(!q)return;$('#covMsg').textContent='검색 중...';$('#covRes').innerHTML='';
  const {list,netErr}=await searchCovers(q);
  $('#covMsg').textContent=list.length?'표지를 눌러 적용하세요 ('+list.length+'건)':(netErr?'결과가 없어요. 일부 검색 서버가 응답하지 않을 수 있으니 제목을 바꾸거나 잠시 후 다시 시도하세요.':'결과가 없어요. 제목을 바꿔서 검색해 보세요.');
  for(const r of list){const f=document.createElement('figure');f.innerHTML='<img loading="lazy"><figcaption></figcaption>';f.querySelector('img').src=r.url;f.querySelector('figcaption').textContent=r.title;
    f.onclick=async()=>{$('#covMsg').textContent='적용 중...';const u=await urlToCover(r.url);setCover(covBook.id,u,true);$('#cov').hidden=true;renderLib(true)};$('#covRes').appendChild(f)}
};
$('#covQ').addEventListener('keydown',e=>{if(e.key==='Enter')$('#covGo').click()});
$('#covClose').onclick=()=>{$('#cov').hidden=true;manualOn=false;manualQ=[]};
$('#covDel').onclick=()=>{setCover(covBook.id,'x',false);$('#cov').hidden=true;renderLib(true)};
$('#covFile').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;try{const u=await blobToCover(f);setCover(covBook.id,u,true)}catch(_){uiAlert('이미지를 불러오지 못했어요')}$('#cov').hidden=true;renderLib(true)};
$('#autoBtn').onclick=()=>{localStorage.setItem('autocover',autoOn()?'0':'1');triedSess.clear();renderLib(true)};
let libCache=[];
async function renderLib(useCache){
  if(!useCache)libCache=await dbAll();
  const counts=[0,0,0,0];libCache.forEach(b=>counts[(b.shelf||0)%4]++);renderShelfTabs(counts);
  const books=libCache.filter(b=>((b.shelf||0)%4)===curShelf).map(b=>{const p=getP(b.id);return Object.assign({},b,{pct:p?p.pct||0:0,opened:+localStorage.getItem('o_'+b.id)||0})});
  books.sort((a,b)=>sortBy==='title'?a.title.localeCompare(b.title,'ko'):sortBy==='pct'?b.pct-a.pct:sortBy==='added'?b.added-a.added:(b.opened-a.opened)||(b.added-a.added));
  $('#sort').value=sortBy;$('#viewBtn').textContent=view==='shelf'?'목록':'책꽂이';$('#editBtn').textContent=editMode?'완료':'편집';$('#autoBtn').hidden=!editMode;$('#sizeBtn').hidden=!editMode;$('#rebuildBtn').hidden=!editMode;$('#sizeBtn').textContent='표지 크기: '+({S:'작게',M:'보통',L:'크게'})[S.coverSize];$('#updBtn2').hidden=!editMode;$('#autoBtn').textContent='자동표지: '+(autoOn()?'켬':'끔');
  $('#empty').hidden=books.length>0;renderNeedBar(books);const dupInfo=computeDups();renderDupBar(dupInfo);const g=$('#grid');const se=document.scrollingElement||document.documentElement;const keepY=resetScrollOnce?0:(pendingScrollY!=null?pendingScrollY:se.scrollTop);resetScrollOnce=false;pendingScrollY=null;g.style.minHeight=g.offsetHeight+'px';g.innerHTML='';g.className=view;
  const tagOf=b=>{const t=document.createElement('div');t.className='tag'+(b.pct<=0&&!b.opened?' new':'');t.textContent=b.pct<=0&&!b.opened?'NEW':Math.round(b.pct*100)+'%';return t};
  const covBtn=b=>{const x=document.createElement('button');x.className='cb';x.textContent=view==='shelf'?'표':'표지';x.onclick=e=>{e.stopPropagation();openCov(b)};return x};
  const delBtn=b=>{const x=document.createElement('button');x.className='del';x.textContent='×';x.onclick=e=>{e.stopPropagation();deleteBook(b)};return x};
  if(view==='shelf'){
    const bw=({S:70,M:92,L:124})[S.coverSize]||92;g.style.setProperty('--bw',bw+'px');const cols=Math.max(2,Math.floor((g.clientWidth||innerWidth-12)/(bw+20)));g.style.gridTemplateColumns='repeat('+cols+',1fr)';
    for(const b of books){
      const s=document.createElement('div');s.className='slot';const k=document.createElement('div');k.className='bk';
      k.appendChild(coverEl(b));k.appendChild(tagOf(b));if(dupInfo.of[b.id]){const db=document.createElement('div');db.className='dupb';db.textContent='중복';k.appendChild(db)}if(needManual(b)){const nb=document.createElement('button');nb.className='nb';nb.textContent='표지 선택';nb.onclick=e=>{e.stopPropagation();openCov(b)};k.appendChild(nb)}if(editMode){k.appendChild(delBtn(b));k.appendChild(covBtn(b))}
      bindBook(k,b);s.appendChild(k);g.appendChild(s)}
    const rows=Math.max(4,Math.ceil(books.length/cols));for(let i=books.length;i<rows*cols;i++){const s=document.createElement('div');s.className='slot';g.appendChild(s)}
  }else{
    g.style.gridTemplateColumns='';
    for(const b of books){
      const d=document.createElement('div');d.className='li';d.appendChild(coverEl(b));
      const inf=document.createElement('div');inf.className='info';inf.innerHTML='<b></b><small></small><div class="bar2"><i></i></div>';
      inf.querySelector('b').textContent=b.title;inf.querySelector('small').textContent=({epub:'EPUB',txt:'TXT',comic:'만화'})[b.type]+(dupInfo.of[b.id]?' · 중복 '+dupInfo.of[b.id]:'')+' · '+Math.round(b.pct*100)+'%'+(b.opened?' · '+new Date(b.opened).toLocaleDateString('ko-KR'):' · 새 책');
      inf.querySelector('i').style.width=Math.round(b.pct*100)+'%';d.appendChild(inf);if(!editMode&&needManual(b)){const cb=covBtn(b);cb.textContent='표지 선택';d.appendChild(cb)}if(editMode){d.appendChild(covBtn(b));d.appendChild(delBtn(b))}
      bindBook(d,b);g.appendChild(d)}
  }
  se.scrollTop=keepY;requestAnimationFrame(()=>{se.scrollTop=keepY;g.style.minHeight='';requestAnimationFrame(()=>{se.scrollTop=keepY})});
  ensureCovers(books);
}
$('#sort').onchange=e=>{sortBy=e.target.value;localStorage.setItem('sort',sortBy);renderLib(true)};
$('#viewBtn').onclick=()=>{view=view==='shelf'?'list':'shelf';localStorage.setItem('view',view);renderLib(true)};
$('#editBtn').onclick=()=>{editMode=!editMode;renderLib(true)};
let _rz;window.addEventListener('resize',()=>{clearTimeout(_rz);_rz=setTimeout(()=>{if(!$('#lib').hidden)renderLib(true);else if(cur&&cur.type==='comic'&&cm&&cm.mode==='page')buildPage(cm.idx)},200)});
const zipName=b=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(b)}catch(_){return new TextDecoder('euc-kr').decode(b)}};
async function expandZip(f,notes){
  if(/\.cbz$/i.test(f.name))return [{name:f.name.replace(/\.cbz$/i,''),kind:'comic',get:()=>f.arrayBuffer()}];
  const z=await JSZip.loadAsync(await f.arrayBuffer(),{decodeFileName:zipName});
  const ents=Object.values(z.files).filter(x=>!x.dir&&!/(^|\/)(__MACOSX|\.)/.test(x.name)&&/\.(epub|txt)$/i.test(x.name));
  ents.sort((p,q)=>p.name.localeCompare(q.name,'ko',{numeric:true}));
  const base=n=>n.split('/').pop();const out=[];
  if(!ents.length&&Object.values(z.files).some(x=>!x.dir&&!/(^|\/)(__MACOSX|\.)/.test(x.name)&&IMG_RE.test(x.name)))return [{name:f.name.replace(/\.zip$/i,''),kind:'comic',get:()=>f.arrayBuffer()}];
  const epubs=ents.filter(x=>/\.epub$/i.test(x.name)),txts=ents.filter(x=>/\.txt$/i.test(x.name));
  for(const x of epubs)out.push({name:base(x.name),kind:'epub',get:()=>x.async('arraybuffer')});
  if(txts.length>1){
    const merge=await uiDlg('"'+f.name+'" 안에 TXT가 '+txts.length+'개 있어요.\n한 권으로 합칠까요? (이름순으로 이어 붙여요)',{ok:'한 권으로 합치기',no:'각각 따로'});
    if(merge){out.push({name:f.name.replace(/\.zip$/i,'')+'.txt',kind:'txt',get:async()=>{let s='';for(let i=0;i<txts.length;i++){const t=decodeText(await txts[i].async('arraybuffer')).replace(/\r\n?/g,'\n').trim();s+=(i?'\n\n':'')+'■ '+base(txts[i].name).replace(/\.txt$/i,'')+'\n\n'+t}return new TextEncoder().encode(s).buffer}});return out}
  }
  for(const x of txts)out.push({name:base(x.name),kind:'txt',get:()=>x.async('arraybuffer')});
  if(!out.length)notes.push(f.name+': 안에 EPUB/TXT가 없어요 ');
  return out;
}
async function importFiles(all,fromDir){
  if(!all.length)return;
  const kindOf=f=>{const n=f.name,t=f.type||'';if(/\.epub$/i.test(n)||t==='application/epub+zip')return 'epub';if(/\.txt$/i.test(n)||t==='text/plain')return 'txt';if(/\.(zip|cbz)$/i.test(n)||/zip/i.test(t))return 'zip';if(IMG_RE.test(n)||/^image\//.test(t))return 'img';return null};
  const relOf=f=>f.webkitRelativePath||f._rel||f.name;
  const notes=[],items=[],imgs=[];let skipped=0;
  for(const f of all){const k=kindOf(f);
    if(!k){skipped++;continue}
    if(k==='zip'){toast('ZIP 여는 중: '+f.name,true);try{(await expandZip(f,notes)).forEach(x=>{x.rel=relOf(f)+'|'+x.name;x.size=f.size;items.push(x)})}catch(err){notes.push(f.name+': ZIP을 열 수 없어요 ('+((err&&err.message)||err)+')')}}
    else if(k==='img')imgs.push(f);
    else items.push({name:f.name,kind:k,rel:relOf(f),size:f.size,get:()=>f.arrayBuffer()})}
  if(fromDir&&imgs.length){const groups={};for(const im of imgs){const rp=relOf(im);const d=rp.includes('/')?rp.slice(0,rp.lastIndexOf('/')):'';(groups[d]=groups[d]||[]).push(im)}
    for(const d of Object.keys(groups)){const g=groups[d];if(g.length<2){skipped+=g.length;continue}g.sort((p,q)=>p.name.localeCompare(q.name,'ko',{numeric:true}));const nm=(d.split('/').pop()||'만화');
      items.push({name:nm,kind:'comic',rel:d+'/*',size:g.length,get:async()=>{const z=new JSZip();for(const im of g)z.file(im.name,im,{compression:'STORE',binary:true});return await z.generateAsync({type:'arraybuffer',compression:'STORE'})}})}}
  else if(imgs.length){const stem=(imgs[0].name.replace(IMG_RE,'').replace(/[\s_\-.]*\d+$/,'')||'만화');
    const title=await uiPrompt('이미지 '+imgs.length+'장을 한 권의 만화로 등록해요.\n만화 제목',stem);
    if(title&&title.trim()){imgs.sort((p,q)=>p.name.localeCompare(q.name,'ko',{numeric:true}));toast('이미지 묶는 중...',true);const z=new JSZip();for(const im of imgs)z.file(im.name,im,{compression:'STORE',binary:true});
      const zbuf=await z.generateAsync({type:'arraybuffer',compression:'STORE'});items.push({name:title.trim(),kind:'comic',get:async()=>zbuf})}}
  let dup=0;if(fromDir){const seen=new Set(libCache.map(b=>b.src).filter(Boolean));for(let i=items.length-1;i>=0;i--){if(seen.has(items[i].rel+'#'+items[i].size)){items.splice(i,1);dup++}}}
  if(!items.length){const tt=document.getElementById('toast');if(tt)tt.style.display='none';uiAlert(notes.length?notes.slice(0,3).join('\n'):(dup?'이 폴더의 책 '+dup+'권은 이미 모두 등록돼 있어요.':'선택한 파일 '+all.length+'개가 EPUB/TXT/ZIP/이미지 형식이 아니라서 등록하지 않았어요.\n(예: '+all[0].name+')'));return}
  if(navigator.storage&&navigator.storage.persist)navigator.storage.persist().catch(()=>{});
  const target=curShelf,tname=shelfNames()[target];const fails=[];
  const total=items.length;let idx=0,done=0;toast('책 등록 중 0/'+total+' → '+tname,true);
  const worker=async()=>{while(idx<total){const it=items[idx++];
    try{const data=await it.get();const nid=Date.now()+Math.random().toString(36).slice(2,7);
      await dbAdd({id:nid,title:it.name.replace(/\.(epub|txt)$/i,'')||it.name,type:it.kind,pos:null,pct:0,bookmarks:[],shelf:target,src:it.rel?it.rel+'#'+it.size:undefined,added:Date.now()+idx},data);
      if(it.kind==='comic'){try{const cu=await comicCover(data);if(cu)cvSet(nid,cu)}catch(_){}}}
    catch(err){console.error(err);fails.push(it.name+': '+((err&&err.message)||err))}
    done++;toast('책 등록 중 '+done+'/'+total,true);if(done%6===0)await renderLib()}};
  await Promise.all([worker(),worker(),worker()]);
  await renderLib();ensureCovers();
  const okN=done-fails.length;toast(okN+'권을 "'+tname+'"에 등록했어요'+(fails.length?' (실패 '+fails.length+'권)':'')+(skipped?' (형식 불일치 '+skipped+'개 제외)':'')+(dup?' (이미 있던 '+dup+'권 제외)':''));
  if(fails.length||notes.length){let st='';if(fails.length){try{const q=await navigator.storage.estimate();st='\n저장공간: 사용 '+Math.round(q.usage/1048576)+'MB / 한도 '+Math.round(q.quota/1048576)+'MB'}catch(_){}}
    uiAlert('확인이 필요한 항목이 있어요.\n'+fails.concat(notes).slice(0,4).join('\n')+st)}
}
$('#file').onchange=e=>{const a=[...e.target.files];e.target.value='';importFiles(a,false)};
$('#dirFile').onchange=e=>{const a=[...e.target.files];e.target.value='';if(!a.length){uiAlert('이 기기에서는 폴더 선택이 지원되지 않을 수 있어요.\n안 되면 폴더를 ZIP으로 묶어서 "+ 책 추가"로 넣어 주세요.');return}importFiles(a,true)};
async function pickDirectory(){
  if(window.showDirectoryPicker){try{const root=await showDirectoryPicker();const out=[];
    const walk=async(h,p)=>{for await(const [n,e] of h.entries()){if(e.kind==='directory')await walk(e,p+n+'/');else{const f=await e.getFile();f._rel=p+n;out.push(f)}}};await walk(root,root.name+'/');importFiles(out,true);return}catch(e){if(e&&e.name==='AbortError')return}}
  $('#dirFile').click();
}
$('#dirBtn').onclick=pickDirectory;

// ---- reader state ----
let cur=null,book=null,rend=null,txtW=0,txtPages=1,txtPage=0,locReady=false;
const FF={serif:'"Noto Serif KR","Nanum Myeongjo",serif','sans-serif':'"Noto Sans KR","Nanum Gothic",sans-serif',monospace:'monospace',book:'serif'};
function decodeText(buf){
  const u=new Uint8Array(buf);
  if(u[0]===0xFF&&u[1]===0xFE)return new TextDecoder('utf-16le').decode(buf);
  if(u[0]===0xFE&&u[1]===0xFF)return new TextDecoder('utf-16be').decode(buf);
  const cnt=s=>{let n=0,i=-1;while((i=s.indexOf('\uFFFD',i+1))!==-1)n++;return n};
  const a=new TextDecoder('utf-8').decode(buf);const ba=cnt(a);
  if(ba===0)return a;
  const b=new TextDecoder('euc-kr').decode(buf);const bb=cnt(b);
  return ba<=bb?a:b;
}
async function openBook(id){
  cur=await dbGet(id);localStorage.setItem('o_'+id,Date.now());const pr=getP(id);if(pr){cur.pos=pr.pos;cur.pct=pr.pct||0}else if(cur.type==='txt'){cur.pos=0;cur.pct=0}
  try{const bm=JSON.parse(localStorage.getItem('b_'+id)||'null');if(bm)cur.bookmarks=bm}catch(_){}
  libY=(document.scrollingElement||document.documentElement).scrollTop;$('#lib').hidden=true;$('#reader').hidden=false;$('#reader').classList.remove('hide');
  $('#title').textContent=cur.title;locReady=false;
  $('#comic').hidden=true;$('#stage').classList.remove('noz');$('#zoomBtn').hidden=true;
  if(cur.type==='epub')await openEpub();else if(cur.type==='comic')await openComic();else openTxt();
  syncUI();
}
async function openEpub(){
  $('#txt').hidden=true;$('#viewer').hidden=false;$('#viewer').innerHTML='';
  book=ePub(cur.data.slice(0));
  rend=book.renderTo('viewer',{width:'100%',height:'100%',flow:S.flow,spread:S.spread==='2'?'both':S.spread==='1'?'none':'auto',minSpreadWidth:800,allowScriptedContent:false});
  applyEpubStyle();
  rend.on('relocated',loc=>{
    cur.pos=loc.start.cfi;
    if(locReady){cur.pct=book.locations.percentageFromCfi(loc.start.cfi)}
    else if(loc.start.percentage!=null)cur.pct=loc.start.percentage;
    showPct();setP();
  });
  rend.hooks.content.register(contents=>{if(S.space!=='off')compactDoc(contents.document)});
  rend.on('keyup',keyNav);
  rend.on('click',()=>{if($('#stage').classList.contains('noz'))$('#reader').classList.toggle('hide')});
  await rend.display(cur.pos||undefined);
  book.ready.then(()=>book.locations.generate(1200)).then(()=>{locReady=true;if(cur&&rend){const l=rend.currentLocation();if(l&&l.start){cur.pct=book.locations.percentageFromCfi(l.start.cfi);showPct()}}}).catch(()=>{});
}
let epubFFApplied=null,epubSpApplied=null;
function compactDoc(d){try{
  const empt=el=>!el.querySelector('img,svg,image,video,audio,hr,table,canvas,object,iframe')&&!/\S/.test((el.textContent||'').replace(/[\u00a0\u3000\u200b]/g,''));
  d.querySelectorAll('p,div').forEach(el=>{if(el.tagName==='DIV'&&!Array.from(el.children).every(c=>/^(BR|SPAN|P)$/.test(c.tagName)))return;if(empt(el))el.style.display='none'});
  d.querySelectorAll('br').forEach(br=>{let n=br.nextSibling;while(n&&n.nodeType===3&&!/\S/.test(n.nodeValue))n=n.nextSibling;if(n&&n.nodeName==='BR')br.remove()});
  d.querySelectorAll('p').forEach(p=>{let n=p.firstChild;while(n&&n.nodeType===1&&n.childNodes.length===1&&n.firstChild)n=n.firstChild;if(n&&n.nodeType===3)n.nodeValue=n.nodeValue.replace(/^[\u00a0\u3000 \t]+/,'')});
}catch(e){}}
function applyEpubStyle(){
  if(!rend)return;const cs=getComputedStyle(document.body);
  rend.flow(S.flow);$('#stage').classList.toggle('noz',S.flow==='scrolled');rend.spread(S.spread==='2'?'both':S.spread==='1'?'none':'auto',800);
  const bg=cs.getPropertyValue('--bg'),fg=cs.getPropertyValue('--fg');
  const ffRule=S.ff==='book'?{}:{'font-family':FF[S.ff]+' !important'};
  const rules={body:Object.assign({background:bg+' !important',color:fg+' !important','line-height':S.lh+' !important',padding:'0 '+S.mg+'px !important'},ffRule),'p,div,span,li':{color:fg+' !important','line-height':S.lh+' !important'},a:{color:'#6aa9ff !important'}};
  if(S.ff!=='book')rules['html body *:not(#_f)']=ffRule;
  const pm=S.space==='s'?{'margin-top':'0 !important','margin-bottom':'0 !important','text-indent':'0.5em !important'}:S.space==='n'?{'margin-top':'0 !important','margin-bottom':'0.35em !important','text-indent':'1em !important'}:null;
  if(pm)rules['html body p:not(#_f)']=pm;epubSpApplied=S.space;
  rend.themes.default(rules);epubFFApplied=S.ff;
  rend.themes.fontSize(S.fs+'px');
}
// TXT (section-based pagination for large files)
let paras=[],cum=[],total=1,secs=[0],curSec=0,ps=[],pageOf=[],txtStep=1;
const esc=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function secOf(pi){let lo=0,hi=secs.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(secs[m]<=pi)lo=m;else hi=m-1}return lo}
function paraOf(f){let lo=0,hi=paras.length-1;const x=f*total;while(lo<hi){const m=(lo+hi+1)>>1;if(cum[m]<=x)lo=m;else hi=m-1}return lo}
const prepSig=()=>S.join+'|'+S.space+'|2';
function buildParas(text){
  let lines=text.split('\n');
  lines=lines.map(l=>S.space!=='off'?l.replace(/[ \t\u3000\u00a0]{2,}/g,' ').trim():l.trim());
  let join=false,P95=0;
  if(S.join!=='off'){const ne=lines.filter(Boolean);
    if(ne.length>=20){const lens=ne.map(l=>l.length).sort((x,y)=>x-y);P95=lens[Math.floor(lens.length*0.95)];
      const near=ne.filter(l=>l.length>=P95*0.85&&l.length<=P95+2).length;
      join=S.join==='on'?true:(P95>=25&&P95<=130&&near/ne.length>0.4)}}
  const out=[];let curp='',lastLen=0;const END=/[.!?。？！…"'”’」』)\]>]$/;
  for(const l of lines){
    if(!l){if(curp){out.push(curp);curp=''}lastLen=0;continue}
    if(join&&curp&&lastLen>=P95*0.85&&!END.test(curp)){curp+=((/[A-Za-z0-9,;:]$/.test(curp)&&/^[A-Za-z0-9]/.test(l))?' ':'')+l}
    else{if(curp)out.push(curp);curp=l}
    lastLen=l.length}
  if(curp)out.push(curp);
  return out.length?out:['(빈 파일)'];
}
function loadParas(){
  const text=decodeText(cur.data).replace(/\r\n?/g,'\n');
  paras=buildParas(text);
  cum=[];let t=0;for(const p of paras){cum.push(t);t+=p.length}total=Math.max(1,t);
  secs=[0];let acc=0;for(let i=0;i<paras.length;i++){acc+=paras[i].length;if(acc>6000&&i+1<paras.length){secs.push(i+1);acc=0}}
  cur.sig=prepSig();
}
function openTxt(){
  $('#viewer').hidden=true;$('#txt').hidden=false;
  const pr=getP(cur.id);const oldSig=pr&&pr.sig;
  loadParas();
  let pi;if(oldSig===cur.sig&&typeof cur.pos==='number'&&cur.pos>=0)pi=Math.min(cur.pos|0,paras.length-1);else pi=paraOf(cur.pct||0);
  layoutTxt(pi);
}
function layoutTxt(pi,last){
  const t=$('#txt'),i=$('#txtin'),cs=getComputedStyle(document.body);
  const paged=S.flow==='paginated';$('#stage').classList.toggle('noz',!paged);t.classList.toggle('scroll',!paged);i.classList.toggle('sc',!paged);i.classList.remove('sp-off','sp-n','sp-s');i.classList.add('sp-'+S.space);
  const padH=S.mg+8,padV=24;t.style.padding=padV+'px '+padH+'px';t.style.background=cs.getPropertyValue('--bg');
  const base='font-size:'+S.fs+'px;line-height:'+S.lh+';font-family:'+FF[S.ff]+';color:'+cs.getPropertyValue('--fg')+';';
  pi=Math.max(0,Math.min(paras.length-1,pi|0));
  if(paged){
    curSec=secOf(pi);i.style.cssText=base;renderSec(last?'last':pi,base);
  }else{
    i.style.cssText=base+'width:auto;height:auto;';
    i.innerHTML=paras.map((p,k)=>'<p data-i="'+k+'">'+esc(p)+'</p>').join('');ps=i.children;
    t.scrollTop=0;requestAnimationFrame(()=>{t.scrollTop=ps[pi]?ps[pi].offsetTop-padV:0});
  }
}
function renderSec(target,base){
  const t=$('#txt'),i=$('#txtin');const padH=S.mg+8,padV=24;
  const a=secs[curSec],b=secs[curSec+1]??paras.length;
  let h='';for(let k=a;k<b;k++)h+='<p data-i="'+k+'">'+esc(paras[k])+'</p>';
  const w=t.clientWidth-2*padH,hh=t.clientHeight-2*padV;
  const two=S.spread==='2'||(S.spread==='auto'&&t.clientWidth>=800&&t.clientWidth>t.clientHeight);const gp=two?Math.max(2*padH,32):2*padH;
  i.style.cssText=(base||i.style.cssText)+'height:'+hh+'px;column-count:'+(two?2:1)+';column-gap:'+gp+'px;column-fill:auto;width:'+w+'px;';
  i.innerHTML=h;t.scrollLeft=0;txtStep=w+gp;window._gp=gp;
  requestAnimationFrame(()=>{
    ps=i.children;txtPages=Math.max(1,Math.round((i.scrollWidth+window._gp)/txtStep));
    pageOf=[];for(const p of ps)pageOf.push(Math.max(0,Math.floor((p.offsetLeft-padH+2)/txtStep)));
    let pg=0;if(target==='last')pg=txtPages-1;else if(pageOf[target-a]!=null)pg=pageOf[target-a];
    goTxt(pg);
  });
}
function goTxt(p){
  const t=$('#txt');txtPage=Math.max(0,Math.min(txtPages-1,p));t.scrollLeft=txtPage*txtStep;
  let k=pageOf.findIndex(x=>x>=txtPage);if(k<0)k=pageOf.length-1;else if(pageOf[k]>txtPage&&k>0)k--;
  const pi=secs[curSec]+Math.max(0,k);cur.pos=pi;cur.pct=cum[pi]/total;showPct();setP();
}
$('#txt').addEventListener('scroll',()=>{if(S.flow!=='scrolled'||!cur||cur.type!=='txt'||!ps.length)return;clearTimeout(window._st);window._st=setTimeout(()=>{
  const t=$('#txt');let lo=0,hi=ps.length-1;const y=t.scrollTop+24;while(lo<hi){const m=(lo+hi+1)>>1;if(ps[m].offsetTop<=y)lo=m;else hi=m-1}
  cur.pos=lo;cur.pct=cum[lo]/total;showPct();setP()},150)});
function txtMove(d){
  if(S.flow==='paginated'){
    if(d>0){if(txtPage<txtPages-1)goTxt(txtPage+1);else if(curSec<secs.length-1){curSec++;renderSec(secs[curSec])}}
    else{if(txtPage>0)goTxt(txtPage-1);else if(curSec>0){curSec--;renderSec('last')}}
  }else{const t=$('#txt');t.scrollBy({top:d*t.clientHeight*0.9,behavior:'smooth'})}
}
function txtSeek(f){const pi=paraOf(f);if(S.flow==='paginated'){curSec=secOf(pi);renderSec(pi)}else{$('#txt').scrollTop=ps[pi].offsetTop-24}}
// navigation
function move(d){
  if(!cur)return;
  if(cur.type==='comic'){comicMove(d);return}
  if(cur.type==='epub'){d>0?rend.next():rend.prev()}
  else txtMove(d);
}
function keyNav(e){if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' ')move(1);else if(e.key==='ArrowLeft'||e.key==='PageUp')move(-1)}
document.addEventListener('keyup',keyNav);
document.querySelectorAll('.zone').forEach(z=>z.addEventListener('click',()=>{
  if(z.classList.contains('c'))$('#reader').classList.toggle('hide');
  else{$('#reader').classList.add('hide');move(+z.dataset.d)}
}));
// swipe
let sx=null;$('#stage').addEventListener('touchstart',e=>{sx=e.touches[0].clientX},{passive:true});
$('#stage').addEventListener('touchend',e=>{if(sx==null)return;const dx=e.changedTouches[0].clientX-sx;sx=null;if(Math.abs(dx)>60&&(cur.type==='comic'?(cm&&cm.mode==='page'&&!cm.zoom):S.flow==='paginated')){move(dx<0?1:-1)}});
function showPct(){if(!cur)return;const p=Math.round((cur.pct||0)*1000);$('#seek').value=p;$('#pct').textContent=(p/10).toFixed(1)+'%'}
$('#seek').onchange=e=>{
  const f=e.target.value/1000;
  if(cur.type==='comic'){comicSeek(f);return}
  if(cur.type==='epub'){if(locReady)rend.display(book.locations.cfiFromPercentage(f))}
  else txtSeek(f);
};
$('#back').onclick=async()=>{setP();if(rend){rend.destroy();book.destroy();rend=book=null}cmCleanup();$('#comic').hidden=true;$('#stage').classList.remove('noz');cur=null;$('#reader').hidden=true;$('#lib').hidden=false;pendingScrollY=libY;renderLib(true)};
// panels
function syncUI(){
  $('#fs').value=S.fs;$('#lh').value=S.lh;$('#mg').value=S.mg;$('#ff').value=S.ff;$('#flow').value=S.flow;$('#spread').value=S.spread;$('#cmMode').value=S.comicMode;$('#cmDir').value=S.comicDir;$('#space').value=S.space;$('#joinSel').value=S.join;$('#ver').textContent='v'+APP_NUM;showPct();
}
function relayout(){applyTheme();if(!cur)return;if(cur.type==='comic'){cmRelayout();return}if(cur.type==='epub'){if((epubFFApplied!==null&&(S.ff==='book')!==(epubFFApplied==='book'))||(epubSpApplied!==null&&epubSpApplied!==S.space)){try{rend.destroy();book.destroy()}catch(_){}rend=book=null;epubFFApplied=epubSpApplied=null;openEpub();return}applyEpubStyle()}else{if(prepSig()!==cur.sig){const f=cur.pct||0;loadParas();layoutTxt(paraOf(f))}else layoutTxt(cur.pos||0)}}
$('#setBtn').onclick=()=>{$('#panel').hidden=false;$('#list').hidden=true};
$('#closeP').onclick=()=>$('#panel').hidden=true;$('#closeL').onclick=()=>$('#list').hidden=true;
document.querySelectorAll('#themes button').forEach(b=>b.onclick=()=>{S.theme=b.dataset.t;saveS();relayout()});
for(const [id,k] of [['fs','fs'],['lh','lh'],['mg','mg']])$('#'+id).oninput=e=>{S[k]=+e.target.value;saveS();relayout()};
$('#ff').onchange=e=>{S.ff=e.target.value;saveS();relayout()};
$('#spread').onchange=e=>{S.spread=e.target.value;saveS();relayout()};
$('#space').onchange=e=>{S.space=e.target.value;saveS();relayout()};
$('#joinSel').onchange=e=>{S.join=e.target.value;saveS();relayout()};
$('#flow').onchange=e=>{S.flow=e.target.value;saveS();relayout()};
window.addEventListener('resize',()=>{if(cur&&cur.type==='txt')layoutTxt(cur.pos||0)});
// list: toc + bookmarks
$('#bmBtn').onclick=async()=>{
  cur.bookmarks=cur.bookmarks||[];
  cur.bookmarks.push({pos:cur.pos,pct:cur.pct||0,t:new Date().toLocaleString('ko-KR')});saveBM();
  $('#bmBtn').textContent='★ 저장됨';setTimeout(()=>$('#bmBtn').textContent='★',1200);
};
$('#listBtn').onclick=async()=>{
  const body=$('#listbody');body.innerHTML='';$('#panel').hidden=true;$('#list').hidden=false;
  const h=t=>{const e=document.createElement('h4');e.textContent=t;body.appendChild(e)};
  h('북마크');
  (cur.bookmarks||[]).forEach((b,i)=>{
    const d=document.createElement('div');d.className='item';d.innerHTML='<span></span><button>삭제</button>';
    d.firstChild.textContent=Math.round(b.pct*1000)/10+'% · '+b.t;
    d.firstChild.onclick=()=>{$('#list').hidden=true;gotoPos(b.pos)};
    d.lastChild.onclick=async e=>{e.stopPropagation();cur.bookmarks.splice(i,1);saveBM();$('#listBtn').click()};
    body.appendChild(d);
  });
  if(!(cur.bookmarks||[]).length){const p=document.createElement('p');p.textContent='없음';p.style.opacity=.6;body.appendChild(p)}
  if(cur.type==='epub'){
    h('목차');const nav=await book.loaded.navigation;
    const walk=(items,lv)=>items.forEach(it=>{
      const d=document.createElement('div');d.className='item';d.style.paddingLeft=(4+lv*16)+'px';d.textContent=it.label.trim();
      d.onclick=()=>{$('#list').hidden=true;rend.display(it.href)};body.appendChild(d);if(it.subitems)walk(it.subitems,lv+1)});
    walk(nav.toc,0);
  }
};
function gotoPos(p){if(cur.type==='comic'){comicSeek(p,true);return}if(cur.type==='epub')rend.display(p);else{const pi=Math.max(0,Math.min(paras.length-1,p|0));if(S.flow==='paginated'){curSec=secOf(pi);renderSec(pi)}else $('#txt').scrollTop=ps[pi].offsetTop-24}}
cvReady.then(()=>renderLib());

// ---- update check ----
async function hardReload(){try{for(const k of await caches.keys())await caches.delete(k)}catch(_){}
  try{for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister()}catch(_){}
  location.reload()}
async function checkUpdate(){
  try{
    const t=await (await fetch('sw.js?'+Date.now(),{cache:'no-store'})).text();const n=+((t.match(/reader-v(\d+)/)||[])[1]||0);
    if(n>APP_NUM){await uiAlert('새 버전(v'+n+')이 있어요. 지금 업데이트합니다.');await hardReload()}
    else if(await uiConfirm('최신 버전입니다 (v'+APP_NUM+').\n그래도 저장된 앱 캐시를 지우고 다시 불러올까요? (책과 읽던 위치는 유지됩니다)'))await hardReload();
  }catch(e){uiAlert('업데이트를 확인하지 못했어요. 인터넷 연결을 확인하세요.')}
}
$('#updBtn').onclick=checkUpdate;$('#updBtn2').onclick=checkUpdate;

// ---- Moon+ style: long-press menu, built-in covers, rebuild, size ----
function setCover(id,u,lock){if(manualOn)setTimeout(nextManual,500);cvSet(id,u);if(lock)localStorage.setItem('k_'+id,'1');else localStorage.removeItem('k_'+id)}
function buildStyles(){const box=$('#covStyles');box.innerHTML='';STY.forEach((s,i)=>{const d=document.createElement('div');d.className='sty';d.style.background=styBg(i);d.onclick=()=>{setCover(covBook.id,'style:'+i,true);$('#cov').hidden=true;renderLib(true)};box.appendChild(d)})}
$('#covAuto').onclick=()=>{cvDel(covBook.id);localStorage.removeItem('f_'+covBook.id);localStorage.removeItem('k_'+covBook.id);triedSess.delete(covBook.id);$('#cov').hidden=true;renderLib(true)};
async function deleteBook(b){if(!(await uiConfirm('"'+b.title+'" 삭제할까요?')))return;await dbDel(b.id);['p_','b_','o_','k_','f_'].forEach(k=>localStorage.removeItem(k+b.id));cvDel(b.id);$('#act').hidden=true;renderLib()}
function openAct(b){
  $('#actT').textContent=b.title;const body=$('#actBody');body.innerHTML='';
  const add=(label,fn,cls)=>{const x=document.createElement('button');x.textContent=label;if(cls)x.className=cls;x.onclick=fn;body.appendChild(x)};
  add('열기',()=>{$('#act').hidden=true;openBook(b.id)});
  add('표지 선택...',()=>openCov(b));
  if(window.Android&&Android.openCoverSearch)add('내장 표지 / 내 이미지로 선택...',()=>openCovSheet(b));
  add('표지 자동으로 다시 만들기',()=>{cvDel(b.id);localStorage.removeItem('f_'+b.id);localStorage.removeItem('k_'+b.id);triedSess.delete(b.id);$('#act').hidden=true;renderLib(true)});
  add('이름 바꾸기',async()=>{const t=await uiPrompt('책 이름',b.title);if(t&&t.trim()){const m=libCache.find(x=>x.id===b.id);if(m){m.title=t.trim();await dbPut(m)}$('#act').hidden=true;renderLib(true)}});
  add('다른 책장으로 이동...',()=>pickShelf(b));
  add('삭제',()=>deleteBook(b),'danger');
  add('닫기',()=>$('#act').hidden=true);
  $('#act').hidden=false;
}
function bindBook(el,b){
  let t=null;const stop=()=>{clearTimeout(t);t=null};
  const fire=()=>{el._lp=true;setTimeout(()=>el._lp=false,700);openAct(b)};
  el.addEventListener('touchstart',()=>{stop();t=setTimeout(()=>{t=null;if(navigator.vibrate)navigator.vibrate(15);fire()},550)},{passive:true});
  ['touchend','touchmove','touchcancel'].forEach(ev=>el.addEventListener(ev,stop,{passive:true}));
  el.addEventListener('contextmenu',e=>{e.preventDefault();stop();if(!el._lp)fire()});
  el.onclick=()=>{if(el._lp)return;openBook(b.id)};
}
$('#rebuildBtn').onclick=async()=>{if(!(await uiConfirm('직접 고른 표지를 제외한 모든 표지를 다시 만들까요?')))return;
  for(const b of libCache){if(localStorage.getItem('k_'+b.id)!=='1')cvDel(b.id);localStorage.removeItem('f_'+b.id)}triedSess.clear();toast('표지를 다시 만드는 중...');renderLib(true)};
$('#sizeBtn').onclick=()=>{S.coverSize=S.coverSize==='M'?'L':S.coverSize==='L'?'S':'M';saveS();renderLib(true)};

// ---- Moon+ style: pick cover from Google Images (via clipboard / URL) ----
let gOpened=false;
function covDone(u){setCover(covBook.id,u,true);$('#cov').hidden=true;gOpened=false;renderLib(true);toast('표지를 적용했어요')}
async function applyUrl(url){
  $('#covMsg').textContent='이미지 불러오는 중...';
  const u=await urlToCover(url);
  if(u.startsWith('data:')){covDone(u);return true}
  const ok=await new Promise(r=>{const im=new Image();im.onload=()=>r(true);im.onerror=()=>r(false);im.src=u;setTimeout(()=>r(false),8000)});
  if(ok){covDone(u);return true}
  $('#covMsg').textContent='이미지를 불러오지 못했어요. 다른 이미지를 복사해 보세요.';return false;
}
async function pasteCover(silent){
  try{
    const items=await navigator.clipboard.read();
    for(const it of items){const t=it.types.find(x=>x.startsWith('image/'));
      if(t){const bl=await it.getType(t);covDone(await blobToCover(bl));return true}}
    for(const it of items){if(it.types.includes('text/plain')){const tx=(await (await it.getType('text/plain')).text()).trim();if(/^https?:\/\/\S+$/.test(tx))return await applyUrl(tx)}}
    if(!silent)$('#covMsg').textContent='클립보드에 이미지가 없어요. 구글 이미지에서 이미지를 길게 눌러 "이미지 복사"를 하세요.';
  }catch(e){if(!silent)$('#covMsg').textContent='클립보드를 읽을 수 없어요. 권한을 허용하거나 아래에 이미지 주소를 붙여넣으세요.'}
  return false;
}
$('#covG').onclick=()=>{if(window.Android&&Android.openCoverSearch){Android.openCoverSearch(covBook.id,cleanTitle(covBook.title)||covBook.title);return}const q=(cleanTitle(covBook.title)||covBook.title)+' 책 표지';gOpened=true;localStorage.setItem('pendingCover',JSON.stringify({id:covBook.id,t:Date.now()}));
  $('#covMsg').textContent='구글 이미지에서 표지를 길게 눌러 "공유" > 북리더를 고르면 바로 표지가 돼요. (복사했다면 이 앱으로 돌아오세요)';
  window.open('https://www.google.com/search?tbm=isch&q='+encodeURIComponent(q),'_blank')};
$('#covPaste').onclick=()=>pasteCover(false);
$('#covUrlGo').onclick=()=>{const v=$('#covUrl').value.trim();if(/^https?:\/\//.test(v))applyUrl(v);else $('#covMsg').textContent='http로 시작하는 이미지 주소를 입력하세요.'};
const backFromGoogle=()=>{if(gOpened&&!document.hidden&&!$('#cov').hidden)setTimeout(()=>pasteCover(true),300)};
document.addEventListener('visibilitychange',backFromGoogle);window.addEventListener('focus',backFromGoogle);

// ---- receive shared image (Google Images long-press > Share > this app) ----
async function consumeShared(){
  try{
    const c=await caches.open('share');const r=await c.match('shared-image');const u=await c.match('shared-url');
    if(!r&&!u){if(location.search.includes('shared'))history.replaceState(null,'',location.pathname);return}
    const blob=r?await r.blob():null;const url=u?await u.text():null;
    await c.delete('shared-image');await c.delete('shared-url');
    if(location.search.includes('shared'))history.replaceState(null,'',location.pathname);
    if(!$('#reader').hidden)$('#back').click();
    const apply=async id=>{let data=null;
      try{if(blob&&blob.size>200)data=await blobToCover(blob);else if(url){const m=url.match(/https?:\/\/\S+/);if(m)data=await urlToCover(m[0])}}catch(_){}
      if(!data){toast('공유된 이미지를 읽지 못했어요');return}
      setCover(id,data,true);localStorage.removeItem('pendingCover');$('#cov').hidden=true;$('#act').hidden=true;renderLib(true);toast('표지를 적용했어요')};
    let pend=null;try{pend=JSON.parse(localStorage.getItem('pendingCover')||'null')}catch(_){}
    if(!libCache.length)libCache=await dbAll();
    if(pend&&Date.now()-pend.t<30*60000&&libCache.some(b=>b.id===pend.id)){await apply(pend.id);return}
    $('#actT').textContent='이 이미지를 표지로 쓸 책을 고르세요';const body=$('#actBody');body.innerHTML='';
    for(const b of libCache.filter(b=>!shelfHidden()[(b.shelf||0)%4])){const x=document.createElement('button');x.textContent=b.title;x.onclick=()=>apply(b.id);body.appendChild(x)}
    const cl=document.createElement('button');cl.textContent='취소';cl.onclick=()=>$('#act').hidden=true;body.appendChild(cl);$('#act').hidden=false;
  }catch(e){}
}
(async()=>{await dbp;await new Promise(r=>setTimeout(r,700));if(!libCache.length)libCache=await dbAll();consumeShared()})();

// ---- settings button on library screen ----
const SZ={S:'작게',M:'보통',L:'크게'};
function syncLibPanel(){updateStat();syncHiddenRow();syncShelfColorSel();$('#pAuto').textContent=autoOn()?'켬':'끔';$('#pSize').textContent=SZ[S.coverSize]||'보통'}
$('#setLibBtn').onclick=()=>{syncUI();syncLibPanel();$('#list').hidden=true;$('#panel').hidden=false};
$('#setBtn').addEventListener('click',syncLibPanel);
$('#pAuto').onclick=()=>{localStorage.setItem('autocover',autoOn()?'0':'1');triedSess.clear();syncLibPanel();renderLib(true)};
$('#pSize').onclick=()=>{S.coverSize=S.coverSize==='M'?'L':S.coverSize==='L'?'S':'M';saveS();syncLibPanel();renderLib(true)};
$('#pRebuild').onclick=()=>{$('#panel').hidden=true;$('#rebuildBtn').click()};
$('#updBtn').addEventListener('click',()=>{});

// ---- native app bridge (WebView app): long-press an image in Google Images -> cover ----
window.onNativeCover=(id,data)=>{if(!data)return;if(manualOn)setTimeout(nextManual,500);setCover(id,data,true);$('#cov').hidden=true;renderLib(true);toast('표지를 적용했어요')};
window.__onBack=()=>{
  for(const s of ['#cov','#act','#panel','#list']){const e=$(s);if(e&&!e.hidden){e.hidden=true;return true}}
  if(!$('#reader').hidden){$('#back').click();return true}
  if(editMode){editMode=false;renderLib(true);return true}
  return false;
};
if(window.Android&&Android.openCoverSearch){const m=document.querySelector('#cov .msg');if(m)m.innerHTML='"Google 이미지 열기"를 누르고 마음에 드는 표지를 <b>탭하면</b> 바로 적용돼요.'}

// "표지 선택": in the native app go straight to Google Images
function openCov(b){
  if(window.Android&&Android.openCoverSearch){covBook=b;$('#act').hidden=true;$('#cov').hidden=true;Android.openCoverSearch(b.id,cleanTitle(b.title)||b.title);return}
  openCovSheet(b);
}

// ---- native: automatic Google Images cover search (hidden WebView in the app) ----
const autoPending={};
function nativeAuto(b){return new Promise(res=>{autoPending[b.id]=res;try{Android.autoCover(b.id,cleanTitle(b.title)||b.title)}catch(e){delete autoPending[b.id];res(null);return}
  setTimeout(()=>{if(autoPending[b.id]){delete autoPending[b.id];res(null)}},120000)})}
window.onNativeAutoCover=(id,d,reason)=>{if(!d&&reason)localStorage.setItem('autoLast',String(reason).slice(0,200));else if(d)localStorage.setItem('autoLast','');const r=autoPending[id];if(r){delete autoPending[id];r(d||null)}};

function updateStat(){const ra=$('#rowGetApp');if(ra)ra.hidden=nativeOK();const e=$('#pStat');if(!e)return;if(!nativeOK()){e.textContent='앱(APK) 전용';return}let s={ok:0,fail:0};try{s=JSON.parse(localStorage.getItem('autoStat')||'')||s}catch(_){}e.textContent='성공 '+s.ok+' / 실패 '+s.fail;const m=$('#pStatMsg');if(m)m.textContent=localStorage.getItem('autoLast')?'최근 실패 원인: '+localStorage.getItem('autoLast'):''}

// ---- in-app dialogs (WebView-safe replacements for confirm/prompt/alert) ----
function uiDlg(msg,o){o=o||{};const input=o.input===undefined?null:o.input;
  return new Promise(res=>{const d=$('#dlg'),bg=$('#dlgBg'),inp=$('#dlgIn');
    $('#dlgMsg').textContent=msg;$('#dlgOk').textContent=o.ok||'확인';$('#dlgNo').textContent=o.no||'취소';inp.hidden=input===null;if(input!==null)inp.value=input;
    inp.type=o.secret?'password':'text';inp.inputMode=o.secret?'numeric':'text';$('#dlgNo').hidden=!!o.single;d.hidden=false;bg.hidden=false;if(input!==null)setTimeout(()=>inp.focus(),60);
    const done=v=>{d.hidden=true;bg.hidden=true;$('#dlgOk').onclick=null;$('#dlgNo').onclick=null;res(v)};
    $('#dlgOk').onclick=()=>done(input!==null?inp.value:true);$('#dlgNo').onclick=()=>done(input!==null?null:false)})}
const uiConfirm=m=>uiDlg(m),uiPrompt=(m,v,s)=>uiDlg(m,{input:v||'',secret:!!s}),uiAlert=m=>uiDlg(m,{single:true});
// ---- 4 separate bookshelves ----
function shelfNames(){try{const a=JSON.parse(localStorage.getItem('shelfNames')||'null');if(Array.isArray(a)&&a.length===4)return a}catch(_){}return ['책장 1','책장 2','책장 3','책장 4']}
function renderShelfTabs(counts){
  if(shelfHidden()[curShelf]){curShelf=visibleShelves()[0]||0;localStorage.setItem('curShelf',curShelf)}
  applyShelfTheme();const pl=document.querySelector('label.plus');if(pl&&pl.firstChild&&pl.firstChild.nodeType===3)pl.firstChild.nodeValue='+ 책 추가 · '+shelfNames()[curShelf];
  const box=$('#shelfTabs');if(!box)return;const names=shelfNames();box.innerHTML='';
  names.forEach((n,i)=>{if(shelfHidden()[i])return;const b=document.createElement('button');b.className='stab'+(i===curShelf?' on':'');b.innerHTML='<span></span><small></small>';
    b.firstChild.textContent=n;b.lastChild.textContent=counts[i]+'권';
    let t=null,lp=false;const stop=()=>{clearTimeout(t);t=null};
    b.addEventListener('touchstart',()=>{lp=false;stop();t=setTimeout(()=>{lp=true;setTimeout(()=>lp=false,800);openShelfMenu(i)},800)},{passive:true});
    ['touchend','touchmove','touchcancel'].forEach(ev=>b.addEventListener(ev,stop,{passive:true}));
    b.addEventListener('contextmenu',e=>{e.preventDefault();stop();lp=true;setTimeout(()=>lp=false,800);openShelfMenu(i)});
    b.onclick=()=>{if(lp)return;curShelf=i;localStorage.setItem('curShelf',i);editMode=false;resetScrollOnce=true;renderLib(true)};
    box.appendChild(b)});
}
async function renameShelf(i){const names=shelfNames();const t=await uiPrompt('책장 이름 (최대 12자)',names[i]);
  if(t&&t.trim()){names[i]=t.trim().slice(0,12);localStorage.setItem('shelfNames',JSON.stringify(names));renderLib(true)}}
function pickShelf(b){
  const names=shelfNames();$('#actT').textContent='"'+b.title+'" 이동할 책장';const body=$('#actBody');body.innerHTML='';
  names.forEach((n,i)=>{if(i===((b.shelf||0)%4))return;const x=document.createElement('button');x.textContent=n;
    x.onclick=async()=>{const m=libCache.find(y=>y.id===b.id);if(m){m.shelf=i;await dbPut(m)}$('#act').hidden=true;renderLib(true);toast(n+'(으)로 옮겼어요')};body.appendChild(x)});
  const c=document.createElement('button');c.textContent='취소';c.onclick=()=>$('#act').hidden=true;body.appendChild(c);$('#act').hidden=false}

// ---- per-shelf colors ----
const dk=(w1,w2,b1,b2,b3,ac)=>({'--wall1':w1,'--wall2':w2,'--b1':b1,'--b2':b2,'--b3':b3,'--accent':ac,'--accentfg':'#1a1a1a','--fg':'#f3e3cf','--fgdim':'#f3e3cf99','--btn':'#0005','--bd':'#f3e3cf44','--card':'#0004'});
const SHELF_THEMES={
  wood:{n:'원목 (기본)',v:dk('#4a3120','#2a1a0f','#b87a3a','#7a4a21','#5a3416','#c98a3e')},
  light:{n:'밝은 원목',v:dk('#8a6a4a','#5a4030','#e0b278','#b98a4f','#8d6537','#e8bd84')},
  black:{n:'블랙',v:dk('#2b2b2e','#0f0f11','#6b6b70','#45454a','#2c2c30','#9a9aa0')},
  navy:{n:'네이비',v:dk('#2a3f66','#0f1a33','#5d7fb8','#3d5a8f','#27406b','#7aa2e0')},
  green:{n:'숲 초록',v:dk('#2f5a43','#12281c','#6fa07f','#4a7a5a','#325a40','#8ccaa0')},
  wine:{n:'와인',v:dk('#6a2a38','#2e0f17','#b0586d','#823a4b','#5c2634','#e08aa0')},
  purple:{n:'보라',v:dk('#4b3470','#1f1433','#8b6cc0','#634a96','#46346c','#b79ce6')},
  gray:{n:'회색',v:dk('#55595f','#26292d','#a1a6ad','#7a7f86','#5a5e64','#c3c8cf')},
  white:{n:'화이트',v:{'--wall1':'#f6f3ee','--wall2':'#d9d3c7','--b1':'#d3c5ab','--b2':'#b3a384','--b3':'#8f8164','--accent':'#b07a33','--accentfg':'#ffffff','--fg':'#3a2e22','--fgdim':'#3a2e2299','--btn':'#ffffff99','--bd':'#3a2e2244','--card':'#ffffff88'}}
};
function shelfColors(){try{const a=JSON.parse(localStorage.getItem('shelfColors')||'null');if(Array.isArray(a)&&a.length===4)return a}catch(_){}return ['wood','wood','wood','wood']}
function applyShelfTheme(){const id=shelfColors()[curShelf];const t=SHELF_THEMES[id]||SHELF_THEMES.wood;const L=$('#lib');if(!L)return;for(const k in t.v)L.style.setProperty(k,t.v[k])}
function setShelfColor(i,id){const a=shelfColors();a[i]=id;localStorage.setItem('shelfColors',JSON.stringify(a));renderLib(true)}
function openShelfMenu(i){
  const names=shelfNames();$('#actT').textContent=names[i];const body=$('#actBody');body.innerHTML='';
  const add=(l,fn)=>{const x=document.createElement('button');x.textContent=l;x.onclick=fn;body.appendChild(x)};
  add('이름 바꾸기',()=>{$('#act').hidden=true;renameShelf(i)});
  add('색 바꾸기...',()=>pickShelfColor(i));
  add('이 책장 숨기기',()=>{$('#act').hidden=true;hideShelf(i)});
  add('닫기',()=>$('#act').hidden=true);$('#act').hidden=false;
}
function pickShelfColor(i){
  const names=shelfNames();$('#actT').textContent=names[i]+' 색';const body=$('#actBody');body.innerHTML='';
  const g=document.createElement('div');g.className='swgrid';const cur=shelfColors()[i];
  for(const id in SHELF_THEMES){const t=SHELF_THEMES[id];const x=document.createElement('button');x.className='sw'+(id===cur?' on':'');
    x.innerHTML='<i></i><span></span>';x.firstChild.style.background='linear-gradient(135deg,'+t.v['--wall1']+','+t.v['--wall2']+')';x.firstChild.style.borderBottom='6px solid '+t.v['--b2'];x.lastChild.textContent=t.n;
    x.onclick=()=>{$('#act').hidden=true;setShelfColor(i,id)};g.appendChild(x)}
  body.appendChild(g);const c=document.createElement('button');c.textContent='닫기';c.onclick=()=>$('#act').hidden=true;body.appendChild(c);$('#act').hidden=false;
}
function syncShelfColorSel(){const s=$('#shelfColorSel');if(!s)return;if(!s.options.length){for(const id in SHELF_THEMES){const o=document.createElement('option');o.value=id;o.textContent=SHELF_THEMES[id].n;s.appendChild(o)}s.onchange=e=>setShelfColor(curShelf,e.target.value)}
  s.value=shelfColors()[curShelf];const l=$('#shelfColorLbl');if(l)l.textContent='책장 색상 ('+shelfNames()[curShelf]+')'}

async function diagCover(){
  toast('진단 중... (최대 1분)',true);const L=[];
  L.push('앱 연동(네이티브): '+(nativeOK()?'있음':'없음 → 웹/크롬 앱이라 구글 이미지 자동 검색을 쓸 수 없어요. 설정의 "앱 받기"로 네이티브 앱을 설치하세요'));
  if(nativeOK()){const t0=Date.now();const u=await nativeAuto({id:'__diag',title:'데미안'});
    L.push('구글 이미지 검색: '+(u?'성공 ('+Math.round((Date.now()-t0)/1000)+'초)':'실패 - '+(localStorage.getItem('autoLast')||'원인 불명(앱을 최신 APK로 바꿔 주세요)')))}
  const test=async(label,url)=>{try{const r=await fetch(url);L.push(label+': HTTP '+r.status+(r.status===429?' (요청 제한)':''))}catch(e){L.push(label+': 연결 실패')}};
  await test('Google Books','https://www.googleapis.com/books/v1/volumes?maxResults=1&q='+encodeURIComponent('데미안'));
  await test('Open Library','https://openlibrary.org/search.json?limit=1&q='+encodeURIComponent('데미안'));
  L.push('앱 버전: v'+APP_NUM);toast('진단 완료');await uiAlert(L.join('\n'));
}
$('#pDiag').onclick=diagCover;

// ---- hide / unhide shelves (optional PIN) ----
function shelfHidden(){try{const a=JSON.parse(localStorage.getItem('shelfHidden')||'null');if(Array.isArray(a)&&a.length===4)return a}catch(_){}return [false,false,false,false]}
function visibleShelves(){return shelfHidden().map((h,i)=>h?-1:i).filter(i=>i>=0)}
async function pinHash(p){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('bookreader|'+p));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function askPin(msg){const h=localStorage.getItem('shelfPin');if(!h)return true;const p=await uiPrompt(msg||'숨김 비밀번호를 입력하세요','',true);if(p===null)return false;if((await pinHash(p.trim()))===h)return true;await uiAlert('비밀번호가 맞지 않아요.');return false}
async function hideShelf(i){
  if(visibleShelves().length<=1){await uiAlert('책장은 최소 1개는 보여야 해요.');return}
  const nm=shelfNames()[i];
  if(!(await uiConfirm('"'+nm+'" 책장을 숨길까요?\n\n탭과 책이 모두 안 보이게 돼요. 설정의 "숨긴 책장 > 관리"에서 다시 보이게 할 수 있어요.'+(localStorage.getItem('shelfPin')?'':'\n(비밀번호는 설정에서 따로 걸 수 있어요)'))))return;
  const a=shelfHidden();a[i]=true;localStorage.setItem('shelfHidden',JSON.stringify(a));
  if(curShelf===i){curShelf=visibleShelves()[0];localStorage.setItem('curShelf',curShelf)}
  editMode=false;renderLib(true);toast('"'+nm+'" 책장을 숨겼어요');
}
async function manageHidden(){
  if(!(await askPin()))return;
  const names=shelfNames(),hid=shelfHidden();const body=$('#actBody');body.innerHTML='';$('#actT').textContent='숨긴 책장';$('#panel').hidden=true;
  const cnt=[0,0,0,0];libCache.forEach(b=>cnt[(b.shelf||0)%4]++);
  let any=false;hid.forEach((h,i)=>{if(!h)return;any=true;const x=document.createElement('button');x.textContent=names[i]+' ('+cnt[i]+'권) 다시 보이기';
    x.onclick=()=>{const a=shelfHidden();a[i]=false;localStorage.setItem('shelfHidden',JSON.stringify(a));$('#act').hidden=true;curShelf=i;localStorage.setItem('curShelf',i);renderLib(true);toast('"'+names[i]+'" 책장을 다시 보여요')};body.appendChild(x)});
  if(!any){const p=document.createElement('p');p.textContent='숨긴 책장이 없어요.';p.style.opacity=.7;body.appendChild(p)}
  const c=document.createElement('button');c.textContent='닫기';c.onclick=()=>$('#act').hidden=true;body.appendChild(c);$('#act').hidden=false;
}
async function setPin(){
  const has=!!localStorage.getItem('shelfPin');if(has&&!(await askPin('현재 비밀번호를 입력하세요')))return;
  const n=await uiPrompt('새 비밀번호 (숫자 4자리 이상)'+(has?'\n비워 두면 비밀번호를 해제해요':''),'',true);if(n===null)return;
  const t=n.trim();if(t===''){if(has){localStorage.removeItem('shelfPin');toast('비밀번호를 해제했어요');syncHiddenRow()}return}
  if(!/^\d{4,}$/.test(t)){await uiAlert('숫자 4자리 이상으로 입력하세요.');return}
  localStorage.setItem('shelfPin',await pinHash(t));toast('비밀번호를 설정했어요');syncHiddenRow();
}
function syncHiddenRow(){const n=shelfHidden().filter(Boolean).length;const e=$('#pHiddenN');if(e)e.textContent=n;const b=$('#pPin');if(b)b.textContent=localStorage.getItem('shelfPin')?'변경 / 해제':'설정'}
$('#pHidden').onclick=manageHidden;$('#pPin').onclick=setPin;

// ================= COMIC / WEBTOON READER =================
const IMG_RE=/\.(jpe?g|png|webp|gif|avif|bmp)$/i;
const IMG_MIME={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif',bmp:'image/bmp'};
let cm=null;
const cmMime=n=>IMG_MIME[(n.split('.').pop()||'').toLowerCase()]||'image/jpeg';
const cmNames=zip=>Object.values(zip.files).filter(x=>!x.dir&&!/(^|\/)(__MACOSX|\.)/.test(x.name)&&IMG_RE.test(x.name)).map(x=>x.name).sort((a,b)=>a.localeCompare(b,'ko',{numeric:true}));
async function comicCover(buf){
  const zip=await JSZip.loadAsync(buf,{decodeFileName:zipName});const names=cmNames(zip);if(!names.length)return null;
  const ab=await zip.file(names[0]).async('arraybuffer');return await blobToCover(new Blob([ab],{type:cmMime(names[0])}));
}
async function cmUrl(i){
  if(!cm||i<0||i>=cm.names.length)return null;if(cm.urls[i])return cm.urls[i];if(cm.pending[i])return cm.pending[i];
  const z=cm;cm.pending[i]=(async()=>{const ab=await z.zip.file(z.names[i]).async('arraybuffer');const u=URL.createObjectURL(new Blob([ab],{type:cmMime(z.names[i])}));
    if(cm===z){z.urls[i]=u}else URL.revokeObjectURL(u);delete z.pending[i];return u})();
  return cm.pending[i];
}
function cmRelease(keep){if(!cm)return;for(const k of Object.keys(cm.urls)){if(!keep(+k)){URL.revokeObjectURL(cm.urls[k]);delete cm.urls[k]}}}
function cmCleanup(){if(!cm)return;try{cm.obs&&cm.obs.disconnect()}catch(_){}for(const u of Object.values(cm.urls))URL.revokeObjectURL(u);cm=null;$('#cmWeb').innerHTML='';$('#cmPage').innerHTML=''}
async function cmDecideMode(){
  if(S.comicMode==='page')return 'page';if(S.comicMode==='web')return 'web';
  const saved=localStorage.getItem('cm_'+cur.id);if(saved)return saved;
  const n=cm.names.length;const pick=[...new Set([0,1,2,Math.floor(n/2),n-1])].filter(i=>i<n);const ratios=[];
  for(const i of pick){const u=await cmUrl(i);if(!u)continue;await new Promise(r=>{const im=new Image();im.onload=()=>{if(im.naturalWidth)ratios.push(im.naturalHeight/im.naturalWidth);r()};im.onerror=r;im.src=u})}
  ratios.sort((a,b)=>a-b);const med=ratios.length?ratios[Math.floor(ratios.length/2)]:1.4;const m=med>2.2?'web':'page';localStorage.setItem('cm_'+cur.id,m);return m;
}
async function openComic(){
  $('#viewer').hidden=true;$('#txt').hidden=true;$('#comic').hidden=false;
  const zip=await JSZip.loadAsync(cur.data,{decodeFileName:zipName});const names=cmNames(zip);
  cm={zip,names,urls:{},pending:{},mode:'page',idx:0,group:0,zoom:false,tok:0,ratio:1.4,ratioSet:false};
  if(!names.length){uiAlert('이 만화에서 이미지를 찾지 못했어요.');return}
  const start=typeof cur.pos==='number'?Math.max(0,Math.min(names.length-1,cur.pos|0)):0;
  cm.mode=await cmDecideMode();layoutComic(start);
}
async function cmRelayout(){if(!cm||!cm.names.length)return;const z=cm,idx=z.idx;const m=await cmDecideMode();if(cm!==z)return;z.mode=m;layoutComic(idx)}
function layoutComic(idx){
  const web=cm.mode==='web';cm.zoom=false;
  $('#cmWeb').hidden=!web;$('#cmPage').hidden=web;$('#cmPage').classList.remove('zoom');
  $('#stage').classList.toggle('noz',web);$('#zoomBtn').hidden=web;
  try{cm.obs&&cm.obs.disconnect()}catch(_){}cmRelease(()=>false);
  if(web)buildWeb(idx);else buildPage(idx);
}
// --- webtoon (vertical scroll) ---
function buildWeb(idx){
  const box=$('#cmWeb');box.innerHTML='';const n=cm.names.length;const frag=document.createDocumentFragment();
  for(let i=0;i<n;i++){const d=document.createElement('div');d.className='pg';d.dataset.i=i;frag.appendChild(d)}
  box.appendChild(frag);cm.wrap=[...box.children];
  const ph=()=>Math.round(Math.min(box.clientWidth||400,900)*cm.ratio);
  cm.wrap.forEach(d=>d.style.minHeight=ph()+'px');
  cm.obs=new IntersectionObserver(es=>{for(const e of es){const d=e.target,i=+d.dataset.i;if(e.isIntersecting)loadWeb(d,i);else unloadWeb(d,i)}},{root:box,rootMargin:'1800px 0px 1800px 0px'});
  cm.wrap.forEach(d=>cm.obs.observe(d));
  box.scrollTop=cm.wrap[idx]?cm.wrap[idx].offsetTop:0;cm.idx=idx;cur.pos=idx;cur.pct=n>1?idx/(n-1):1;showPct();setP();
}
async function loadWeb(d,i){
  if(!cm||d.firstChild||d._ld)return;d._ld=true;const z=cm;const u=await cmUrl(i);d._ld=false;if(cm!==z||!d.isConnected||d.firstChild)return;
  const im=new Image();im.decoding='async';
  im.onload=()=>{d.style.minHeight='';d.style.height='';if(cm===z&&!z.ratioSet&&im.naturalWidth){z.ratio=im.naturalHeight/im.naturalWidth;z.ratioSet=true;const h=Math.round(Math.min($('#cmWeb').clientWidth||400,900)*z.ratio);z.wrap.forEach(x=>{if(!x.firstChild)x.style.minHeight=h+'px'})}};
  im.src=u;d.appendChild(im);
}
function unloadWeb(d,i){if(!cm||!d.firstChild)return;d.style.height=d.offsetHeight+'px';d.innerHTML='';if(cm.urls[i]){URL.revokeObjectURL(cm.urls[i]);delete cm.urls[i]}}
$('#cmWeb').addEventListener('scroll',()=>{
  if(!cm||cm.mode!=='web')return;$('#reader').classList.add('hide');clearTimeout(cm._t);
  cm._t=setTimeout(()=>{const box=$('#cmWeb');const y=box.scrollTop+box.clientHeight*0.1;let lo=0,hi=cm.wrap.length-1;
    while(lo<hi){const m=(lo+hi+1)>>1;if(cm.wrap[m].offsetTop<=y)lo=m;else hi=m-1}
    cm.idx=lo;cur.pos=lo;cur.pct=cm.names.length>1?lo/(cm.names.length-1):1;showPct();setP()},150);
});
// --- page mode (manga) ---
const cmTwo=()=>{const st=$('#stage');return S.spread==='2'||(S.spread==='auto'&&st.clientWidth>=800&&st.clientWidth>st.clientHeight)};
function cmGroups(){const n=cm.names.length,g=[];if(!cmTwo()){for(let i=0;i<n;i++)g.push([i]);return g}g.push([0]);for(let i=1;i<n;i+=2)g.push(i+1<n?[i,i+1]:[i]);return g}
async function buildPage(idx){if(!cm)return;cm.groups=cmGroups();cm.group=Math.max(0,cm.groups.findIndex(g=>g.includes(idx)));await showGroup()}
async function showGroup(){
  const z=cm;const box=$('#cmPage');const g=z.groups[z.group];const tk=++z.tok;
  const urls=await Promise.all(g.map(cmUrl));if(cm!==z||tk!==z.tok)return;
  box.className=(S.comicDir==='rtl'?'rtl ':'')+(g.length>1?'two':'')+(z.zoom?' zoom':'');box.innerHTML='';box.scrollTo(0,0);
  urls.forEach(u=>{const im=new Image();im.src=u;box.appendChild(im)});
  const first=g[0];z.idx=first;cur.pos=first;cur.pct=z.names.length>1?first/(z.names.length-1):1;showPct();setP();
  cmRelease(i=>Math.abs(i-first)<=3);
  [z.groups[z.group+1],z.groups[z.group-1]].forEach(gg=>gg&&gg.forEach(i=>cmUrl(i)));
}
function comicMove(phys){
  if(!cm||!cm.names.length)return;
  if(cm.mode==='web'){const b=$('#cmWeb');b.scrollBy({top:phys*b.clientHeight*0.9,behavior:'smooth'});return}
  if(cm.zoom)return;
  const logical=S.comicDir==='rtl'?-phys:phys;const ng=Math.max(0,Math.min(cm.groups.length-1,cm.group+logical));
  if(ng!==cm.group){cm.group=ng;showGroup()}
}
function comicSeek(v,isIndex){
  if(!cm||!cm.names.length)return;const n=cm.names.length;const idx=isIndex?Math.max(0,Math.min(n-1,v|0)):Math.round(v*(n-1));
  if(cm.mode==='web'){const d=cm.wrap[idx];if(d)$('#cmWeb').scrollTop=d.offsetTop}
  else{cm.group=Math.max(0,cm.groups.findIndex(g=>g.includes(idx)));showGroup()}
}
$('#zoomBtn').onclick=()=>{if(!cm||cm.mode!=='page')return;cm.zoom=!cm.zoom;$('#cmPage').classList.toggle('zoom',cm.zoom);$('#stage').classList.toggle('noz',cm.zoom);$('#cmPage').scrollTo(0,0);$('#zoomBtn').textContent=cm.zoom?'축소':'확대'};
$('#comic').addEventListener('click',()=>{if($('#stage').classList.contains('noz'))$('#reader').classList.toggle('hide')});
$('#txt').addEventListener('click',()=>{if(cur&&cur.type==='txt'&&$('#stage').classList.contains('noz'))$('#reader').classList.toggle('hide')});
$('#cmMode').onchange=e=>{S.comicMode=e.target.value;saveS();relayout()};
$('#cmDir').onchange=e=>{S.comicDir=e.target.value;saveS();relayout()};

// ---- books the automatic search could not cover: choose manually, one by one ----
let manualQ=[],manualOn=false;
function renderNeedBar(books){const bar=$('#needBar');if(!bar)return;const n=books.filter(needManual).length;bar.hidden=n===0;if(!n)return;
  bar.innerHTML='';const s=document.createElement('span');s.textContent='자동으로 표지를 못 찾은 책이 '+n+'권 있어요';
  const b=document.createElement('button');b.textContent='하나씩 고르기';b.onclick=startManual;bar.appendChild(s);bar.appendChild(b)}
function startManual(){manualQ=libCache.filter(b=>((b.shelf||0)%4)===curShelf&&needManual(b)).map(b=>b.id);manualOn=true;nextManual()}
function nextManual(){
  if(!manualOn)return;
  while(manualQ.length){const id=manualQ.shift();const b=libCache.find(x=>x.id===id);
    if(b&&needManual(b)){toast('남은 책 '+manualQ.length+'권',false);openCov(Object.assign({},b));return}}
  manualOn=false;manualQ=[];$('#cov').hidden=true;renderLib(true);toast('표지 선택을 모두 마쳤어요');
}
$('#covSkip').onclick=()=>{$('#cov').hidden=true;nextManual()};

// ---- same-title detection ----
const dupKey=t=>cleanTitle(t||'').toLowerCase().replace(/[\s\-_.,:;!?'"~·]+/g,'');
function computeDups(){const g={};for(const b of libCache){const k=dupKey(b.title);if(!k)continue;(g[k]=g[k]||[]).push(b)}
  const groups=Object.values(g).filter(a=>a.length>1);const of={};groups.forEach(a=>a.forEach(b=>of[b.id]=a.length+'권'));return {groups,of}}
function renderDupBar(info){const bar=$('#dupBar');if(!bar)return;const n=info.groups.length;bar.hidden=n===0;if(!n)return;
  const cnt=info.groups.reduce((s,a)=>s+a.length,0);bar.innerHTML='';const s=document.createElement('span');s.textContent='같은 제목이 '+n+'종 ('+cnt+'권) 있어요';
  const b=document.createElement('button');b.textContent='중복 확인';b.onclick=openDups;bar.appendChild(s);bar.appendChild(b)}
function openDups(){const info=computeDups();const names=shelfNames();const body=$('#actBody');body.innerHTML='';$('#actT').textContent='같은 제목의 책';
  if(!info.groups.length){const p=document.createElement('p');p.textContent='중복된 책이 없어요.';body.appendChild(p)}
  for(const grp of info.groups){const h=document.createElement('div');h.className='dgh';h.textContent=grp[0].title;body.appendChild(h);
    for(const b of grp){const p=getP(b.id);const x=document.createElement('button');x.className='dgi';
      x.textContent=names[(b.shelf||0)%4]+' · '+({epub:'EPUB',txt:'TXT',comic:'만화'})[b.type]+' · '+Math.round((p&&p.pct||0)*100)+'% 읽음 · 이름: '+b.title+'  [삭제]';
      x.onclick=async()=>{if(!(await uiConfirm('"'+b.title+'" ('+names[(b.shelf||0)%4]+')을 삭제할까요?\n\n※ 읽던 위치와 북마크도 같이 지워져요.')))return;
        await dbDel(b.id);['p_','b_','o_','k_','f_'].forEach(k=>localStorage.removeItem(k+b.id));cvDel(b.id);libCache=libCache.filter(y=>y.id!==b.id);renderLib(true);openDups()};body.appendChild(x)}}
  const c=document.createElement('button');c.textContent='닫기';c.onclick=()=>$('#act').hidden=true;body.appendChild(c);$('#act').hidden=false}
