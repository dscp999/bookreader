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
// ---- library ----
async function renderLib(){
  const books=(await dbAll()).sort((a,b)=>(b.opened||0)-(a.opened||0));
  $('#empty').hidden=books.length>0;const g=$('#grid');g.innerHTML='';
  for(const b of books){
    const d=document.createElement('div');d.className='card';
    d.innerHTML='<b></b><div><small></small><div class="bar2"><i></i></div></div><button class="del">×</button>';
    d.querySelector('b').textContent=b.title;d.querySelector('small').textContent=b.type.toUpperCase()+' · '+Math.round((b.pct||0)*100)+'%';
    d.querySelector('i').style.width=Math.round((b.pct||0)*100)+'%';
    d.onclick=()=>openBook(b.id);
    d.querySelector('.del').onclick=async e=>{e.stopPropagation();if(confirm('"'+b.title+'" 삭제할까요?')){await dbDel(b.id);renderLib()}};
    g.appendChild(d);
  }
}
$('#file').onchange=async e=>{
  for(const f of e.target.files){
    const type=/\.epub$/i.test(f.name)?'epub':'txt';
    const data=await f.arrayBuffer();
    let title=f.name.replace(/\.(epub|txt)$/i,'');
    if(type==='epub'){try{const bk=ePub(data.slice(0));const m=await bk.loaded.metadata;if(m.title)title=m.title;bk.destroy()}catch(_){}}
    await dbPut({id:Date.now()+Math.random().toString(36).slice(2,6),title,type,data,pos:null,pct:0,bookmarks:[],added:Date.now()});
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
  try{return new TextDecoder('utf-8',{fatal:true}).decode(buf)}catch(_){return new TextDecoder('euc-kr').decode(buf)}
}
async function openBook(id){
  cur=await dbGet(id);cur.opened=Date.now();
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
    showPct();dbPut(cur);
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
// TXT
function openTxt(){
  $('#viewer').hidden=true;$('#txt').hidden=false;
  const text=decodeText(cur.data).replace(/\r\n?/g,'\n');
  cur._html=text.split('\n').filter(l=>l.trim()).map(l=>'<p>'+l.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</p>').join('');
  $('#txtin').innerHTML=cur._html;layoutTxt(cur.pos||0);
}
function layoutTxt(frac){
  const t=$('#txt'),i=$('#txtin'),cs=getComputedStyle(document.body);
  const top=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sat'))||0;
  i.style.cssText='font-size:'+S.fs+'px;line-height:'+S.lh+';font-family:'+FF[S.ff]+';color:'+cs.getPropertyValue('--fg')+';';
  t.style.background=cs.getPropertyValue('--bg');
  const paged=S.flow==='paginated';t.classList.toggle('scroll',!paged);
  const padV=24,padH=S.mg+8;
  t.style.padding=padV+'px '+padH+'px';
  if(paged){
    txtW=t.clientWidth-2*padH;const h=t.clientHeight-2*padV;
    i.style.cssText+='height:'+h+'px;column-width:'+txtW+'px;column-gap:'+(2*padH)+'px;column-fill:auto;width:'+txtW+'px;';
    t.scrollLeft=0;
    requestAnimationFrame(()=>{txtPages=Math.max(1,Math.round((i.scrollWidth+2*padH)/(txtW+2*padH)));goTxt(Math.min(txtPages-1,Math.round(frac*(txtPages-1))))});
  }else{
    i.style.cssText+='width:auto;height:auto;';
    requestAnimationFrame(()=>{t.scrollTop=frac*(t.scrollHeight-t.clientHeight)});
  }
}
function goTxt(p){
  const t=$('#txt');txtPage=Math.max(0,Math.min(txtPages-1,p));
  t.scrollLeft=txtPage*(txtW+2*(S.mg+8));
  cur.pos=txtPages>1?txtPage/(txtPages-1):0;cur.pct=cur.pos;showPct();dbPut(cur);
}
$('#txt').addEventListener('scroll',()=>{if(S.flow!=='scrolled'||!cur||cur.type!=='txt')return;const t=$('#txt');cur.pos=t.scrollTop/Math.max(1,t.scrollHeight-t.clientHeight);cur.pct=cur.pos;showPct();clearTimeout(window._st);window._st=setTimeout(()=>dbPut(cur),400)});
// navigation
function move(d){
  if(!cur)return;
  if(cur.type==='epub'){d>0?rend.next():rend.prev()}
  else if(S.flow==='paginated')goTxt(txtPage+d);
  else{const t=$('#txt');t.scrollBy({top:d*t.clientHeight*0.9,behavior:'smooth'})}
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
  else if(S.flow==='paginated')goTxt(Math.round(f*(txtPages-1)));
  else{const t=$('#txt');t.scrollTop=f*(t.scrollHeight-t.clientHeight)}
};
$('#back').onclick=async()=>{await dbPut(cur);if(rend){rend.destroy();book.destroy();rend=book=null}cur=null;$('#reader').hidden=true;$('#lib').hidden=false;renderLib()};
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
  cur.bookmarks.push({pos:cur.pos,pct:cur.pct||0,t:new Date().toLocaleString('ko-KR')});await dbPut(cur);
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
    d.lastChild.onclick=async e=>{e.stopPropagation();cur.bookmarks.splice(i,1);await dbPut(cur);$('#listBtn').click()};
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
function gotoPos(p){if(cur.type==='epub')rend.display(p);else if(S.flow==='paginated')goTxt(Math.round(p*(txtPages-1)));else{const t=$('#txt');t.scrollTop=p*(t.scrollHeight-t.clientHeight)}}
renderLib();
