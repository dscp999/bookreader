'use strict';
const $=s=>document.querySelector(s);
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
// ---- IndexedDB ----
const dbp=new Promise((res,rej)=>{const r=indexedDB.open('reader',1);r.onupgradeneeded=()=>r.result.createObjectStore('books',{keyPath:'id'});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
async function tx(mode,fn){const db=await dbp;return new Promise((res,rej)=>{const t=db.transaction('books',mode);const q=fn(t.objectStore('books'));t.oncomplete=()=>res(q&&q.result);t.onerror=()=>rej(t.error)})}
const dbAll=()=>tx('readonly',s=>s.getAll()),dbGet=id=>tx('readonly',s=>s.get(id)),dbPut=b=>tx('readwrite',s=>s.put(b)),dbDel=id=>tx('readwrite',s=>s.delete(id));
// ---- settings ----
const S=Object.assign({theme:'dark',fs:20,lh:1.7,mg:20,ff:'serif',flow:'paginated'},JSON.parse(localStorage.getItem('rs')||'{}'));
const saveS=()=>localStorage.setItem('rs',JSON.stringify(S));
function applyTheme(){document.body.className='t-'+S.theme}
applyTheme();
const getP=id=>{try{return JSON.parse(localStorage.getItem('p_'+id)||'null')}catch(_){return null}};
const setP=()=>{if(cur)localStorage.setItem('p_'+cur.id,JSON.stringify({pos:cur.pos,pct:cur.pct}))};
const saveBM=()=>localStorage.setItem('b_'+cur.id,JSON.stringify(cur.bookmarks||[]));
// ---- library ----
let view=localStorage.getItem('view')||'shelf',sortBy=localStorage.getItem('sort')||'recent',editMode=false,coverBusy=false;
function hueOf(s){let h=0;for(const c of s)h=(h*31+c.charCodeAt(0))%360;return h}
function coverEl(b){
  const d=document.createElement('div');d.className='cover';const c=localStorage.getItem('c_'+b.id);
  if(c&&c!=='none'&&c!=='x'){d.style.backgroundImage='url("'+c+'")';d.classList.add('img')}
  else{const h=hueOf(b.title);d.style.background='linear-gradient(135deg,hsl('+h+',45%,38%),hsl('+((h+30)%360)+',50%,22%))';const s=document.createElement('span');s.textContent=b.title;d.appendChild(s)}
  return d;
}
async function epubCover(data){
  try{const bk=ePub(data.slice(0));const u=await Promise.race([bk.coverUrl(),new Promise(r=>setTimeout(()=>r(null),6000))]);
    if(!u){bk.destroy();return null}
    const bl=await (await fetch(u)).blob();const url=await blobToCover(bl);bk.destroy();return url}catch(_){return null}
}
async function blobToCover(bl){const im=await createImageBitmap(bl);const w=240,h=Math.round(im.height*w/im.width);
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;cv.getContext('2d').drawImage(im,0,0,w,h);return cv.toDataURL('image/jpeg',0.82)}
async function urlToCover(u){try{const r=await fetch(u);if(!r.ok)throw 0;const bl=await r.blob();if(bl.size<500)throw 0;return await blobToCover(bl)}catch(_){return u}}
// ---- online cover search ----
const norm=s=>(s||'').toLowerCase().replace(/[\s\-_.,:;!?'"()\[\]{}~·]+/g,'');
function cleanTitle(t){return t.replace(/\.(txt|epub)$/i,'').replace(/[\[\(【][^\]\)】]*[\]\)】]/g,' ').replace(/\d+\s*[-~]\s*\d+\s*(화|권|부)?/g,' ').replace(/(완결|외전포함|외전|합본|전권|최종본|무삭제)/g,' ').replace(/_+/g,' ').replace(/\s+/g,' ').trim()}
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
    if(r.src==='w'&&sc<3)sc=0;if(sc>bs){bs=sc;best=r}}
  return best;}
async function autoCoverFor(title){
  let err=false;
  for(const v of variants(title)){const {list,netErr}=await searchCovers(v);if(netErr)err=true;const b=bestMatch(list,v);if(b)return {url:await urlToCover(b.url)};}
  return {url:null,err};
}
const autoOn=()=>localStorage.getItem('autocover')!=='0';
const triedSess=new Set();
async function ensureCovers(books){
  if(coverBusy||!autoOn())return;coverBusy=true;
  try{for(const b of books){
    const cur0=localStorage.getItem('c_'+b.id);if((cur0&&cur0!=='none')||triedSess.has(b.id))continue;
    let u=null,err=false;
    if(b.type==='epub'){const full=await dbGet(b.id);u=full&&await epubCover(full.data)}
    if(!u){const r=await autoCoverFor(b.title);u=r.url;err=r.err&&!u}
    triedSess.add(b.id);
    if(u){try{localStorage.setItem('c_'+b.id,u)}catch(_){}; if(!$('#lib').hidden)renderLib(true)}
    else if(!err)localStorage.setItem('c_'+b.id,'x');
    await new Promise(r=>setTimeout(r,500));
  }}finally{coverBusy=false}
}
// ---- manual cover picker ----
let covBook=null;
function openCov(b){covBook=b;$('#cov').hidden=false;$('#covT').textContent='표지 찾기 · '+b.title;$('#covQ').value=cleanTitle(b.title)||b.title;$('#covRes').innerHTML='';$('#covGo').click()}
$('#covGo').onclick=async()=>{
  const q=$('#covQ').value.trim();if(!q)return;$('#covMsg').textContent='검색 중...';$('#covRes').innerHTML='';
  const {list,netErr}=await searchCovers(q);
  $('#covMsg').textContent=list.length?'표지를 눌러 적용하세요 ('+list.length+'건)':(netErr?'결과가 없어요. 일부 검색 서버가 응답하지 않을 수 있으니 제목을 바꾸거나 잠시 후 다시 시도하세요.':'결과가 없어요. 제목을 바꿔서 검색해 보세요.');
  for(const r of list){const f=document.createElement('figure');f.innerHTML='<img loading="lazy"><figcaption></figcaption>';f.querySelector('img').src=r.url;f.querySelector('figcaption').textContent=r.title;
    f.onclick=async()=>{$('#covMsg').textContent='적용 중...';const u=await urlToCover(r.url);try{localStorage.setItem('c_'+covBook.id,u)}catch(_){}$('#cov').hidden=true;renderLib(true)};$('#covRes').appendChild(f)}
};
$('#covQ').addEventListener('keydown',e=>{if(e.key==='Enter')$('#covGo').click()});
$('#covClose').onclick=()=>$('#cov').hidden=true;
$('#covDel').onclick=()=>{localStorage.setItem('c_'+covBook.id,'x');$('#cov').hidden=true;renderLib(true)};
$('#covFile').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;try{const u=await blobToCover(f);localStorage.setItem('c_'+covBook.id,u)}catch(_){alert('이미지를 불러오지 못했어요')}$('#cov').hidden=true;renderLib(true)};
$('#autoBtn').onclick=()=>{localStorage.setItem('autocover',autoOn()?'0':'1');triedSess.clear();renderLib(true)};
let libCache=[];
async function renderLib(useCache){
  if(!useCache)libCache=await dbAll();
  const books=libCache.map(b=>{const p=getP(b.id);return Object.assign({},b,{pct:p?p.pct||0:0,opened:+localStorage.getItem('o_'+b.id)||0})});
  books.sort((a,b)=>sortBy==='title'?a.title.localeCompare(b.title,'ko'):sortBy==='pct'?b.pct-a.pct:sortBy==='added'?b.added-a.added:(b.opened-a.opened)||(b.added-a.added));
  $('#sort').value=sortBy;$('#viewBtn').textContent=view==='shelf'?'목록':'책꽂이';$('#editBtn').textContent=editMode?'완료':'편집';$('#autoBtn').hidden=!editMode;$('#autoBtn').textContent='자동표지: '+(autoOn()?'켬':'끔');
  $('#empty').hidden=books.length>0;const g=$('#grid');g.innerHTML='';g.className=view;
  const tagOf=b=>{const t=document.createElement('div');t.className='tag'+(b.pct<=0&&!b.opened?' new':'');t.textContent=b.pct<=0&&!b.opened?'NEW':Math.round(b.pct*100)+'%';return t};
  const covBtn=b=>{const x=document.createElement('button');x.className='cb';x.textContent=view==='shelf'?'표':'표지';x.onclick=e=>{e.stopPropagation();openCov(b)};return x};
  const delBtn=b=>{const x=document.createElement('button');x.className='del';x.textContent='×';x.onclick=async e=>{e.stopPropagation();if(confirm('"'+b.title+'" 삭제할까요?')){await dbDel(b.id);['p_','b_','c_','o_'].forEach(k=>localStorage.removeItem(k+b.id));renderLib()}};return x};
  if(view==='shelf'){
    const cols=Math.max(3,Math.floor((g.clientWidth||innerWidth-12)/112));g.style.gridTemplateColumns='repeat('+cols+',1fr)';
    for(const b of books){
      const s=document.createElement('div');s.className='slot';const k=document.createElement('div');k.className='bk';
      k.appendChild(coverEl(b));k.appendChild(tagOf(b));if(editMode){k.appendChild(delBtn(b));k.appendChild(covBtn(b))}
      k.onclick=()=>openBook(b.id);s.appendChild(k);g.appendChild(s)}
    const rows=Math.max(4,Math.ceil(books.length/cols));for(let i=books.length;i<rows*cols;i++){const s=document.createElement('div');s.className='slot';g.appendChild(s)}
  }else{
    g.style.gridTemplateColumns='';
    for(const b of books){
      const d=document.createElement('div');d.className='li';d.appendChild(coverEl(b));
      const inf=document.createElement('div');inf.className='info';inf.innerHTML='<b></b><small></small><div class="bar2"><i></i></div>';
      inf.querySelector('b').textContent=b.title;inf.querySelector('small').textContent=b.type.toUpperCase()+' · '+Math.round(b.pct*100)+'%'+(b.opened?' · '+new Date(b.opened).toLocaleDateString('ko-KR'):' · 새 책');
      inf.querySelector('i').style.width=Math.round(b.pct*100)+'%';d.appendChild(inf);if(editMode){d.appendChild(covBtn(b));d.appendChild(delBtn(b))}
      d.onclick=()=>openBook(b.id);g.appendChild(d)}
  }
  ensureCovers(books);
}
$('#sort').onchange=e=>{sortBy=e.target.value;localStorage.setItem('sort',sortBy);renderLib(true)};
$('#viewBtn').onclick=()=>{view=view==='shelf'?'list':'shelf';localStorage.setItem('view',view);renderLib(true)};
$('#editBtn').onclick=()=>{editMode=!editMode;renderLib(true)};
let _rz;window.addEventListener('resize',()=>{clearTimeout(_rz);_rz=setTimeout(()=>{if(!$('#lib').hidden)renderLib(true)},200)});
$('#file').onchange=async e=>{
  for(const f of e.target.files){
    const type=/\.epub$/i.test(f.name)?'epub':'txt';
    const data=await f.arrayBuffer();
    let title=f.name.replace(/\.(epub|txt)$/i,'');
    if(type==='epub'){try{const bk=ePub(data.slice(0));const m=await bk.loaded.metadata;if(m.title)title=m.title;bk.destroy()}catch(_){}}
    const nid=Date.now()+Math.random().toString(36).slice(2,6);
    await dbPut({id:nid+'',title,type,data,pos:null,pct:0,bookmarks:[],added:Date.now()});
  }
  e.target.value='';renderLib();
};
// ---- reader state ----
let cur=null,book=null,rend=null,txtW=0,txtPages=1,txtPage=0,locReady=false;
const FF={serif:'"Noto Serif KR","Nanum Myeongjo",serif','sans-serif':'"Noto Sans KR","Nanum Gothic",sans-serif',monospace:'monospace'};
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
  $('#lib').hidden=true;$('#reader').hidden=false;$('#reader').classList.remove('hide');
  $('#title').textContent=cur.title;locReady=false;
  if(cur.type==='epub')await openEpub();else openTxt();
  syncUI();
}
async function openEpub(){
  $('#txt').hidden=true;$('#viewer').hidden=false;$('#viewer').innerHTML='';
  book=ePub(cur.data.slice(0));
  rend=book.renderTo('viewer',{width:'100%',height:'100%',flow:S.flow,spread:'none',allowScriptedContent:false});
  applyEpubStyle();
  rend.on('relocated',loc=>{
    cur.pos=loc.start.cfi;
    if(locReady){cur.pct=book.locations.percentageFromCfi(loc.start.cfi)}
    else if(loc.start.percentage!=null)cur.pct=loc.start.percentage;
    showPct();setP();
  });
  rend.on('keyup',keyNav);
  rend.on('click',()=>{});
  await rend.display(cur.pos||undefined);
  book.ready.then(()=>book.locations.generate(1200)).then(()=>{locReady=true;if(cur&&rend){const l=rend.currentLocation();if(l&&l.start){cur.pct=book.locations.percentageFromCfi(l.start.cfi);showPct()}}}).catch(()=>{});
}
function applyEpubStyle(){
  if(!rend)return;const cs=getComputedStyle(document.body);
  rend.flow(S.flow);
  const bg=cs.getPropertyValue('--bg'),fg=cs.getPropertyValue('--fg');
  rend.themes.default({body:{background:bg+' !important',color:fg+' !important','font-family':FF[S.ff]+' !important','line-height':S.lh+' !important',padding:'0 '+S.mg+'px !important'},'p,div,span,li':{color:fg+' !important','line-height':S.lh+' !important'},a:{color:'#6aa9ff !important'}});
  rend.themes.fontSize(S.fs+'px');
}
// TXT (section-based pagination for large files)
let paras=[],cum=[],total=1,secs=[0],curSec=0,ps=[],pageOf=[],txtStep=1;
const esc=s=>s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function secOf(pi){let lo=0,hi=secs.length-1;while(lo<hi){const m=(lo+hi+1)>>1;if(secs[m]<=pi)lo=m;else hi=m-1}return lo}
function paraOf(f){let lo=0,hi=paras.length-1;const x=f*total;while(lo<hi){const m=(lo+hi+1)>>1;if(cum[m]<=x)lo=m;else hi=m-1}return lo}
function openTxt(){
  $('#viewer').hidden=true;$('#txt').hidden=false;
  const text=decodeText(cur.data).replace(/\r\n?/g,'\n');
  paras=text.split('\n').map(l=>l.trim()).filter(Boolean);if(!paras.length)paras=['(빈 파일)'];
  cum=[];let t=0;for(const p of paras){cum.push(t);t+=p.length}total=Math.max(1,t);
  secs=[0];let acc=0;for(let i=0;i<paras.length;i++){acc+=paras[i].length;if(acc>6000&&i+1<paras.length){secs.push(i+1);acc=0}}
  const pi=typeof cur.pos==='number'&&cur.pos>=0?Math.min(cur.pos|0,paras.length-1):0;
  layoutTxt(pi);
}
function layoutTxt(pi,last){
  const t=$('#txt'),i=$('#txtin'),cs=getComputedStyle(document.body);
  const paged=S.flow==='paginated';t.classList.toggle('scroll',!paged);i.classList.toggle('sc',!paged);
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
  i.style.cssText=(base||i.style.cssText)+'height:'+hh+'px;column-width:'+w+'px;column-gap:'+(2*padH)+'px;column-fill:auto;width:'+w+'px;';
  i.innerHTML=h;t.scrollLeft=0;txtStep=w+2*padH;
  requestAnimationFrame(()=>{
    ps=i.children;txtPages=Math.max(1,Math.round((i.scrollWidth+2*padH)/txtStep));
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
$('#stage').addEventListener('touchend',e=>{if(sx==null)return;const dx=e.changedTouches[0].clientX-sx;sx=null;if(Math.abs(dx)>60&&(cur.type==='epub'?S.flow==='paginated':S.flow==='paginated')){move(dx<0?1:-1)}});
function showPct(){const p=Math.round((cur.pct||0)*1000);$('#seek').value=p;$('#pct').textContent=(p/10).toFixed(1)+'%'}
$('#seek').onchange=e=>{
  const f=e.target.value/1000;
  if(cur.type==='epub'){if(locReady)rend.display(book.locations.cfiFromPercentage(f))}
  else txtSeek(f);
};
$('#back').onclick=async()=>{setP();if(rend){rend.destroy();book.destroy();rend=book=null}cur=null;$('#reader').hidden=true;$('#lib').hidden=false;renderLib()};
// panels
function syncUI(){
  $('#fs').value=S.fs;$('#lh').value=S.lh;$('#mg').value=S.mg;$('#ff').value=S.ff;$('#flow').value=S.flow;showPct();
}
function relayout(){applyTheme();if(!cur)return;if(cur.type==='epub')applyEpubStyle();else layoutTxt(cur.pos||0)}
$('#setBtn').onclick=()=>{$('#panel').hidden=false;$('#list').hidden=true};
$('#closeP').onclick=()=>$('#panel').hidden=true;$('#closeL').onclick=()=>$('#list').hidden=true;
document.querySelectorAll('#themes button').forEach(b=>b.onclick=()=>{S.theme=b.dataset.t;saveS();relayout()});
for(const [id,k] of [['fs','fs'],['lh','lh'],['mg','mg']])$('#'+id).oninput=e=>{S[k]=+e.target.value;saveS();relayout()};
$('#ff').onchange=e=>{S.ff=e.target.value;saveS();relayout()};
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
function gotoPos(p){if(cur.type==='epub')rend.display(p);else{const pi=Math.max(0,Math.min(paras.length-1,p|0));if(S.flow==='paginated'){curSec=secOf(pi);renderSec(pi)}else $('#txt').scrollTop=ps[pi].offsetTop-24}}
renderLib();
