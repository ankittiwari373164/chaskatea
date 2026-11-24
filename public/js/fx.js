/* ChaskaTea effects layer (v3). Progressive: every block is optional and skips on reduced motion or missing data. */
(function(){
'use strict';
if(location.pathname.startsWith('/admin'))return;
const RM=matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE=matchMedia('(pointer: fine)').matches;
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const path=location.pathname.replace(/\/$/,'')||'/';
const safe=(fn)=>{try{fn()}catch(e){console.warn('fx',e)}};
const money=n=>'₹'+(Number(n)||0).toLocaleString('en-IN');
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let products=null;
async function getProducts(){ if(products)return products; try{const r=await fetch('/api/products');products=(await r.json()).products||[]}catch(e){products=[]} return products }

/* ---------- reveal on scroll ---------- */
function reveal(){
  const els=$$('.rv:not(.in), .story .chap');
  if(RM||!('IntersectionObserver' in window)){els.forEach(e=>e.classList.add('in'));return}
  const io=new IntersectionObserver(es=>es.forEach(en=>{if(en.isIntersecting){en.target.classList.add('in');io.unobserve(en.target)}}),{rootMargin:'0px 0px -8% 0px',threshold:.08});
  els.forEach(e=>io.observe(e));
}

/* ---------- custom cursor (fine pointers only) ---------- */
function cursor(){return;
  if(RM||!FINE)return;
  document.body.classList.add('fx-cursor');
  const dot=document.createElement('div');dot.className='cur-dot';
  const ring=document.createElement('div');ring.className='cur-ring';
  document.body.append(dot,ring);
  let x=-100,y=-100,rx=-100,ry=-100,on=false;
  addEventListener('pointermove',e=>{x=e.clientX;y=e.clientY;if(!on){on=true;document.body.classList.add('cur-on')}},{passive:true});
  document.addEventListener('pointerleave',()=>{on=false;document.body.classList.remove('cur-on')});
  (function loop(){
    rx+=(x-rx)*.2;ry+=(y-ry)*.2;
    dot.style.transform=`translate(${x}px,${y}px)`;ring.style.transform=`translate(${rx}px,${ry}px)`;
    requestAnimationFrame(loop);
  })();
  document.addEventListener('pointerover',e=>{ring.classList.toggle('hot',!!e.target.closest('a,button,.card,.pic,.cat,.banner'))});
}

/* ---------- magnetic buttons + 3D tilt (pointer) ---------- */
function magnetic(){
  if(RM||!FINE)return;
  const tiltSel='.card .pic, .hero-packs img, .cat, .banner';
  document.addEventListener('pointermove',e=>{
    const b=e.target.closest&&e.target.closest('.btn:not([disabled])');
    if(b){const r=b.getBoundingClientRect();const dx=(e.clientX-(r.left+r.width/2))*.22,dy=(e.clientY-(r.top+r.height/2))*.3;b.style.translate=`${dx.toFixed(1)}px ${dy.toFixed(1)}px`}
    const t=e.target.closest&&e.target.closest(tiltSel);
    if(t){const r=t.getBoundingClientRect();const px=(e.clientX-r.left)/r.width-.5,py=(e.clientY-r.top)/r.height-.5;
      t.style.setProperty('--ry',(px*16).toFixed(2)+'deg');t.style.setProperty('--rx',(-py*14).toFixed(2)+'deg')}
  },{passive:true});
  document.addEventListener('pointerout',e=>{
    const b=e.target.closest&&e.target.closest('.btn');if(b&&!b.contains(e.relatedTarget)){b.style.translate=''}
    const t=e.target.closest&&e.target.closest(tiltSel);if(t&&!t.contains(e.relatedTarget)){t.style.setProperty('--rx','0deg');t.style.setProperty('--ry','0deg')}
  });
}
function gyro(){
  if(RM||FINE||!window.DeviceOrientationEvent||typeof DeviceOrientationEvent.requestPermission==='function')return;
  addEventListener('deviceorientation',e=>{
    const rx=Math.max(-10,Math.min(10,(e.beta||0)-45))*-.6, ry=Math.max(-14,Math.min(14,(e.gamma||0)))*.7;
    $$('.hero-packs img').forEach(i=>{i.style.setProperty('--rx',rx.toFixed(1)+'deg');i.style.setProperty('--ry',ry.toFixed(1)+'deg')});
  },{passive:true});
}

/* ---------- scroll: timeline draw + parallax-free progress ---------- */
function scrollFx(){
  const steps=$('.steps'); if(!steps||RM)return;
  let t=false;
  const run=()=>{t=false;const r=steps.getBoundingClientRect();const p=Math.min(1,Math.max(0,(innerHeight*.85-r.top)/(r.height+innerHeight*.4)));steps.style.setProperty('--p',p.toFixed(3))};
  addEventListener('scroll',()=>{if(!t){t=true;requestAnimationFrame(run)}},{passive:true});run();
}

/* ---------- marquee ticker ---------- */
function marquee(){if(document.body.dataset.plain)return;
  const rib=$('.ribbon .row'); if(!rib)return;
  const items=[...rib.querySelectorAll('span')].map(s=>s.textContent.trim()).filter(Boolean);
  const one=items.map(t=>`<span>${esc(t)}</span>`).join('');
  rib.innerHTML=`<div class="marq" aria-hidden="true">${one}${one}${one}${one}</div>`;
}

/* ---------- animated counters (home) ---------- */
function counters(){if(document.body.dataset.plain)return;
  const rib=$('.ribbon'); if(!rib||$('.stats'))return;
  const sec=document.createElement('section');sec.className='stats';
  sec.innerHTML=`<div class="wrap"><div class="row">
    <div><b data-to="0" data-n="products">0</b><small>teas &amp; packs in the range</small></div>
    <div><b data-to="7">0</b><small>days from leaf to pack</small></div>
    <div><b data-to="100">0</b><small>% natural, nothing added</small></div></div></div>`;
  rib.after(sec);
  getProducts().then(p=>{const b=sec.querySelector('[data-n]');b.dataset.to=p.length;});
  const io=new IntersectionObserver(es=>es.forEach(en=>{if(!en.isIntersecting)return;io.disconnect();
    $$('b[data-to]',sec).forEach(b=>{const to=Number(b.dataset.to)||0;if(RM){b.textContent=to;return}
      const t0=performance.now();const tick=now=>{const k=Math.min(1,(now-t0)/1400);const e=1-Math.pow(1-k,3);b.textContent=Math.round(to*e);if(k<1)requestAnimationFrame(tick)};
      setTimeout(()=>requestAnimationFrame(tick),Number(b.dataset.n?300:0))})}),{threshold:.4});
  io.observe(sec);
}

/* ---------- hero leaves (canvas particles) ---------- */
function leaves(){if(document.body.dataset.plain)return;
  const hero=$('.hero'); if(!hero||RM)return;
  const c=document.createElement('canvas');c.className='fx-leaves';c.setAttribute('aria-hidden','true');hero.prepend(c);
  const g=c.getContext('2d');let W,H,dpr=Math.min(2,devicePixelRatio||1),ps=[],vis=true;
  const size=()=>{W=c.width=hero.offsetWidth*dpr;H=c.height=hero.offsetHeight*dpr;};
  const mk=()=>({x:Math.random()*W,y:Math.random()*H,r:(6+Math.random()*9)*dpr,a:Math.random()*6,va:(Math.random()-.5)*.02,vx:(.15+Math.random()*.35)*dpr*(Math.random()<.5?-1:1),vy:(.2+Math.random()*.45)*dpr,g:Math.random()<.7});
  const init=()=>{size();ps=Array.from({length:Math.min(28,Math.round(hero.offsetWidth/40))},mk)};
  init();addEventListener('resize',init);
  new IntersectionObserver(es=>{vis=es[0].isIntersecting}).observe(hero);
  (function frame(){
    requestAnimationFrame(frame);
    if(!vis)return;
    g.clearRect(0,0,W,H);
    for(const p of ps){
      p.x+=p.vx+Math.sin(p.a)*.3*dpr;p.y+=p.vy;p.a+=p.va;
      if(p.y>H+20*dpr){p.y=-20*dpr;p.x=Math.random()*W}
      if(p.x<-30*dpr)p.x=W+20*dpr;if(p.x>W+30*dpr)p.x=-20*dpr;
      g.save();g.translate(p.x,p.y);g.rotate(p.a);
      g.beginPath();g.ellipse(0,0,p.r,p.r*.42,0,0,Math.PI*2);
      g.fillStyle=p.g?'rgba(200,242,124,.55)':'rgba(164,227,65,.35)';g.fill();g.restore();
    }
  })();
}

/* ---------- find-your-tea quiz (home) ---------- */
function quiz(){if(document.body.dataset.plain)return;
  const cta=$('.cta-band'); if(!cta||$('.quiz'))return;
  const host=cta.closest('section'); if(!host)return;
  const sec=document.createElement('section');sec.className='s';sec.style.paddingTop='0';
  sec.innerHTML=`<div class="wrap"><div class="sec-head rv"><div><span class="eyebrow">Find your tea</span><h2>Two questions. One cup.</h2></div></div>
  <div class="quiz rv" id="quiz"><div class="q on" data-step="0"><h3>How do you like your tea?</h3><div class="opts">
    <button class="opt" data-a="milk">With milk &amp; sugar</button><button class="opt" data-a="plain">Plain and strong</button><button class="opt" data-a="light">Light and fresh</button></div></div>
  <div class="q" data-step="1"><h3>How much will you go through?</h3><div class="opts">
    <button class="opt" data-a="250">Just trying it</button><button class="opt" data-a="500">Every day at home</button><button class="opt" data-a="1kg">The whole household</button></div></div>
  <div class="q" data-step="2"><h3 id="qres"></h3><div id="qout"></div></div>
  <div class="bar"><i id="qbar"></i></div></div></div>`;
  host.before(sec);
  const state={};
  const setBar=(p)=>{const i=$('#qbar');if(i)i.style.width=p+'%'};
  sec.addEventListener('click',async e=>{
    const b=e.target.closest('.opt');if(!b)return;
    const step=b.closest('.q');const n=Number(step.dataset.step);
    if(n===0)state.taste=b.dataset.a;else state.pack=b.dataset.a;
    step.classList.remove('on');
    const next=sec.querySelector(`.q[data-step="${n+1}"]`);
    if(next){next.classList.add('on');setBar((n+1)*50)}
    if(n===1){setBar(100);await showResult()}
  });
  async function showResult(){
    const all=await getProducts();const cats=(window.CT&&CT.cfg&&CT.cfg.categories)||[];
    const rx={milk:/classic|milk|masala|ginger|cardamom|chai/i,plain:/supreme|dust|premium|strong|black|assam/i,light:/green|white|light|fresh|premium/i}[state.taste];
    let cat=cats.find(c=>rx&&rx.test(c.name+' '+c.slug))||cats[0];
    const inCat=all.filter(p=>!cat||p.category===cat.slug);
    const pick=inCat.find(p=>String(p.weight||'').toLowerCase().includes(state.pack.replace('kg',' kg').replace('1 kg','1kg').replace('1kg','1'))) || inCat[0] || all[0];
    $('#qres').textContent=pick?`Your cup: ${pick.name.replace(/^ChaskaTea /,'')}`:'Your cup is ready';
    $('#qout').innerHTML=pick?`<div class="result"><div>${CT.card(pick,0).replace(/class="card rv d0"/,'class="card"')}</div><div><p style="color:var(--muted);font-weight:300;font-size:1.05rem;max-width:30em">Picked from our ${esc(cat?cat.name:'range')} for ${state.taste==='milk'?'milk and sugar':state.taste==='plain'?'a plain, strong cup':'a light, fresh cup'}, in the pack size that fits how much you drink.</p><div class="ctrls" style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem"><a class="btn" href="/products/${esc(pick.slug)}">See this tea</a><a class="btn ghost" href="/shop${cat?'?cat='+esc(cat.slug):''}">All ${esc(cat?cat.name:'teas')}</a></div><button class="btn ghost sm" id="qredo" style="margin-top:1rem">Start again</button></div></div>`:'';
    $('#qredo')?.addEventListener('click',()=>{sec.querySelectorAll('.q').forEach(q=>q.classList.remove('on'));sec.querySelector('.q[data-step="0"]').classList.add('on');setBar(0)});
    const rv=$('#qout .card');if(rv)rv.classList.add('in');
  }
}

/* ---------- brew guide with steep timer (product page) ---------- */
function brew(){if(document.body.dataset.plain)return;
  if(path!=='/product')return;
  const slug=new URLSearchParams(location.search).get('s');
  (async()=>{
    const all=await getProducts();const p=all.find(x=>x.slug===slug);if(!p)return;
    const n=(p.category+' '+p.name).toLowerCase();
    let mins=3,note='Full body. The steady choice for milk.';
    if(/green|white|light/.test(n)){mins=2.5;note='Light leaf. A shorter steep keeps it fresh and bright.'}
    else if(/supreme|dust|strong|premium|black|plain|classic/.test(n)){mins=4;note='Strong leaf. Give it time for depth and colour.'}
    const C=2*Math.PI*88;
    const sec=document.createElement('section');sec.className='s';sec.style.paddingTop='0';
    sec.innerHTML=`<div class="wrap"><div class="brew rv"><div>
      <svg viewBox="0 0 200 200" aria-hidden="true"><defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c8f27c"/><stop offset="1" stop-color="#a4e341"/></linearGradient></defs>
        <circle class="ring-bg" cx="100" cy="100" r="88"/><circle class="ring" id="bring" cx="100" cy="100" r="88" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="0"/>
        <text class="clock" id="bclock" x="100" y="112" text-anchor="middle">${String(Math.floor(mins)).padStart(1,'0')}:${String(Math.round((mins%1)*60)).padStart(2,'0')}</text></svg></div>
      <div><span class="eyebrow" style="color:#c8f27c">Brew guide</span><h3>Steep it for ${Math.floor(mins)}${mins%1?':30':':00'} minutes</h3><p>${esc(note)} Use ~1 teaspoon per cup, water just off the boil.</p>
      <div class="ctrls"><button class="btn sm" id="bgo">Start timer</button><button class="btn ghost sm" id="brst">Reset</button></div></div></div></div>`;
    const main=$('main'); (main||document.body).appendChild(sec);
    const total=mins*60;let left=total,timer=null;const ring=$('#bring'),clock=$('#bclock');
    const draw=()=>{const m=Math.floor(left/60),s=left%60;clock.textContent=`${m}:${String(s).padStart(2,'0')}`;ring.style.strokeDashoffset=(C*(1-left/total)).toFixed(1)};
    $('#bgo').onclick=e=>{if(timer){clearInterval(timer);timer=null;e.target.textContent='Resume';return}
      if(left<=0)left=total;e.target.textContent='Pause';
      timer=setInterval(()=>{left--;draw();if(left<=0){clearInterval(timer);timer=null;$('#bgo').textContent='Ready. Pour and enjoy';if(navigator.vibrate)navigator.vibrate([120,80,120]);if(window.CT&&CT.toast)CT.toast('Your tea is ready')}},1000)};
    $('#brst').onclick=()=>{if(timer){clearInterval(timer);timer=null}left=total;draw();$('#bgo').textContent='Start timer'};
    draw();
  })();
}

/* ---------- brand story (about page) ---------- */
function story(){return;
  if(path!=='/about'||$('.story'))return;
  const sec=document.createElement('section');sec.className='story';
  sec.innerHTML=`<div class="wrap">
    <div class="chap"><div class="txt"><div class="num">01</div><span class="eyebrow">The garden</span><h3>Two leaves and a bud, picked by hand.</h3><p>We buy from Assam gardens we know by name. Pluck the top of the bush and you get the sweetest leaf there is.</p></div><div class="pic"><img src="/img/about-us.webp" alt="" loading="lazy"></div></div>
    <div class="chap"><div class="txt"><div class="num">02</div><span class="eyebrow">The tasting</span><h3>Every lot is brewed and cupped before we buy it.</h3><p>If it does not taste right in the cup, it does not come home with us. Strong, bright and full bodied.</p></div><div class="pic"><img src="/img/couple-picnic-sitting-drinking-tea-232070-5353.webp" alt="" loading="lazy"></div></div>
    <div class="chap"><div class="txt"><div class="num">03</div><span class="eyebrow">The pack</span><h3>Sealed within the week, so the aroma stays put.</h3><p>Nothing artificial, nothing added. Only tea, packed fresh and sent to your door.</p></div><div class="pic"><img src="/img/tea-1xp-1kg.webp" alt="" loading="lazy"></div></div>
  </div>`;
  const first=$('main > section')||$('main');
  first.after(sec);
}


/* ---------- kinetic headline: words rise in one by one ---------- */
function kinetic(){
  const h=$('.hero h1'); if(!h||RM)return;
  let i=0;
  const walk=n=>{[...n.childNodes].forEach(c=>{
    if(c.nodeType===3){const frag=document.createDocumentFragment();
      c.textContent.split(/(\s+)/).forEach(t=>{ if(!t)return; if(/^\s+$/.test(t)){frag.appendChild(document.createTextNode(' '));return}
        const w=document.createElement('span');w.className='kw';const x=document.createElement('span');x.className='wi';x.textContent=t;x.style.setProperty('--i',i++);w.appendChild(x);frag.appendChild(w)});
      c.replaceWith(frag)}
    else if(c.nodeType===1)walk(c)})};
  walk(h); h.classList.add('kin'); requestAnimationFrame(()=>requestAnimationFrame(()=>h.classList.add('go')));
}

/* ---------- hero scroll storytelling: packs drift, scale and spin as you scroll ---------- */
function heroScroll(){
  const hero=$('.hero'); if(!hero||RM)return;
  let tk=false;
  const upd=()=>{tk=false;const r=hero.getBoundingClientRect();const p=Math.max(0,Math.min(1,-r.top/Math.max(1,r.height)));
    hero.style.setProperty('--sp',p.toFixed(3))};
  addEventListener('scroll',()=>{if(!tk){tk=true;requestAnimationFrame(upd)}},{passive:true});upd();
}

/* ---------- giant outlined type band (home) ---------- */
function bigBand(){if(document.body.dataset.plain)return;
  if(path!=='/'||$('.bigband'))return;
  const anchor=$('.stats')||$('.ribbon'); if(!anchor)return;
  const words=['ASSAM','KADAK','MASALA','CTC','DUST','CLASSIC','PREMIUM','SUPREME'];
  const row=words.map(w=>`<span>${w}</span>`).join('');
  const d=document.createElement('div');d.className='bigband';d.setAttribute('aria-hidden','true');
  d.innerHTML=`<div class="bb">${row}${row}</div>`;
  anchor.parentNode.insertBefore(d,anchor);
}

/* ---------- smooth page transitions ---------- */
function pageFx(){
  document.documentElement.classList.add('pg-in');
  if(RM)return;
  document.addEventListener('click',e=>{
    const a=e.target.closest&&e.target.closest('a[href]'); if(!a||e.defaultPrevented||e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;
    const u=new URL(a.href,location.href); if(u.origin!==location.origin||a.target||a.hasAttribute('download')||(u.pathname===location.pathname&&u.search===location.search))return;
    if(u.hash&&u.pathname===location.pathname)return;
    e.preventDefault();document.documentElement.classList.add('pg-out');setTimeout(()=>{location.href=u.href},260);
  });
  addEventListener('pageshow',ev=>{if(ev.persisted)document.documentElement.classList.remove('pg-out')});
}

/* ---------- tactile press feedback on phones ---------- */
function haptic(){
  if(FINE)return;
  document.addEventListener('touchstart',e=>{const t=e.target.closest&&e.target.closest('.btn,.card,.cat,.tabbar a,.chip');if(t){t.classList.add('press')}},{passive:true});
  const off=e=>$$('.press').forEach(x=>x.classList.remove('press'));
  document.addEventListener('touchend',()=>{if(navigator.vibrate)try{navigator.vibrate(8)}catch(_){}setTimeout(off,120)},{passive:true});
  document.addEventListener('touchcancel',off,{passive:true});
}

/* ---------- boot ---------- */
function init(){
  safe(pageFx);safe(kinetic);safe(heroScroll);safe(bigBand);safe(haptic);safe(cursor);safe(magnetic);safe(gyro);safe(scrollFx);safe(marquee);safe(counters);safe(leaves);safe(quiz);safe(brew);safe(story);safe(reveal);setTimeout(()=>safe(reveal),500);setTimeout(()=>safe(reveal),1500);setTimeout(()=>safe(reveal),3500);
  $$('.card .pic img, .hero-packs img').forEach(i=>i.setAttribute('draggable','false'));
}
let booted=false;
const go=()=>{if(booted)return;booted=true;init()};
const obs=new MutationObserver(()=>{if(document.body&&document.body.classList.contains('ready')){obs.disconnect();setTimeout(go,30)}});
obs.observe(document.body,{attributes:true,attributeFilter:['class']});
if(document.body&&document.body.classList.contains('ready')){obs.disconnect();go()}
setTimeout(()=>{if(!booted){go()}},4000);
})();