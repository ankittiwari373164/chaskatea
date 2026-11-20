
(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inr=n=>'₹'+(Number(n)||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const clean=t=>String(t==null?'':t).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u2B50]/gu,'').replace(/\s+/g,' ').trim();
const ls={get(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};

async function api(path,opts={}){
  const o={method:opts.method||'GET',headers:{},credentials:'same-origin'};
  if(opts.body!==undefined){o.method=opts.method||'POST';o.headers['Content-Type']='application/json';o.body=JSON.stringify(opts.body)}
  const r=await fetch(path,o); let j={}; try{j=await r.json()}catch(e){}
  if(!r.ok){const e=new Error(j.error||'Something went wrong');e.status=r.status;throw e}
  return j;
}
const I={ // icons
 home:'<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
 shop:'<svg viewBox="0 0 24 24"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8a3 3 0 016 0"/></svg>',
 heart:'<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 018-2.7A4.5 4.5 0 0120 10c0 5.800-8 11-8 11z"/></svg>',
 cart:'<svg viewBox="0 0 24 24"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.600 12.500h11L21 7H6"/></svg>',
 user:'<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.400 3.600-7 8-7s8 2.600 8 7"/></svg>',
 search:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.500-3.500"/></svg>',
};
const CT=window.CT={ $,$$,esc,inr,api,ls,I,clean,cfg:null,user:null,cart:ls.get('ct_cart',[]),wish:new Set(ls.get('ct_wish',[]))};

/* ---------- toast / sheet ---------- */
let tt; CT.toast=(msg,o={})=>{let t=$('.toast');if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t)}
  t.className='toast'+(o.bad?' bad':'');t.innerHTML=esc(msg)+(o.href?` <a href="${o.href}">${esc(o.label||'View')}</a>`:'');
  requestAnimationFrame(()=>t.classList.add('show'));clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('show'),o.ms||2800)};
CT.sheet=(title,html,o={})=>{
  $$('.sheet,.scrim').forEach(e=>e.remove());
  const sc=document.createElement('div');sc.className='scrim';const sh=document.createElement('div');sh.className='sheet';sh.setAttribute('role','dialog');
  sh.innerHTML=`<div class="grab"></div><div class="sh"><h3>${esc(title)}</h3><button class="x" aria-label="Close">×</button></div><div class="sb">${html}</div>`;
  document.body.append(sc,sh);requestAnimationFrame(()=>{sc.classList.add('show');sh.classList.add('show')});
  const close=()=>{sc.classList.remove('show');sh.classList.remove('show');setTimeout(()=>{sc.remove();sh.remove()},350);o.onClose&&o.onClose()};
  sc.onclick=close;$('.x',sh).onclick=close;sh.close=close;
  // swipe down to dismiss
  let y0=null;sh.addEventListener('touchstart',e=>{if(e.target.closest('.sb')&&$('.sb',sh).scrollTop>0)return;y0=e.touches[0].clientY},{passive:true});
  sh.addEventListener('touchmove',e=>{if(y0==null)return;const d=e.touches[0].clientY-y0;if(d>0)sh.style.transform=`translateY(${d}px)`},{passive:true});
  sh.addEventListener('touchend',e=>{if(y0==null)return;const d=e.changedTouches[0].clientY-y0;y0=null;sh.style.transform='';if(d>90)close()});
  const esc_=e=>{if(e.key==='Escape'&&sh.isConnected){close();document.removeEventListener('keydown',esc_)}};document.addEventListener('keydown',esc_);
  return sh;
};

/* ---------- cart ---------- */
const saveCart=()=>{ls.set('ct_cart',CT.cart);document.dispatchEvent(new Event('cart'));badges()};
CT.cartCount=()=>CT.cart.reduce((s,i)=>s+i.qty,0);
CT.addToCart=(id,qty=1,fromEl)=>{
  const it=CT.cart.find(i=>i.id===id); if(it)it.qty=Math.min(50,it.qty+qty); else CT.cart.push({id,qty}); saveCart();
  if(fromEl)fly(fromEl); const b=$$('.cart-badge'); b.forEach(x=>{x.classList.remove('bump');void x.offsetWidth;x.classList.add('bump')});
};
CT.setQty=(id,qty)=>{if(qty<=0)CT.cart=CT.cart.filter(i=>i.id!==id);else{const it=CT.cart.find(i=>i.id===id);if(it)it.qty=Math.min(50,qty)}saveCart()};
CT.clearCart=()=>{CT.cart=[];saveCart()};
function fly(el){const img=el.closest('[data-pic]')?.querySelector('img')||el.closest('.card')?.querySelector('img')||$('.gal .main img');if(!img)return;
  const a=img.getBoundingClientRect();const tgt=$$('.cart-badge').find(b=>b.offsetParent)||$$('.cart-badge')[0];if(!tgt)return;const t=tgt.getBoundingClientRect();
  const f=document.createElement('img');f.src=img.src;f.className='fly';f.style.left=a.left+a.width/2-32+'px';f.style.top=a.top+a.height/2-32+'px';document.body.appendChild(f);
  requestAnimationFrame(()=>{f.style.left=t.left-14+'px';f.style.top=t.top-14+'px';f.style.width=f.style.height='28px';f.style.opacity='.4'});setTimeout(()=>f.remove(),800)}
function badges(){const n=CT.cartCount();$$('.cart-badge').forEach(b=>{b.textContent=n||'';b.classList.toggle('zero',!n)});
  const w=CT.wish.size;$$('.wish-badge').forEach(b=>{b.textContent=w||'';b.classList.toggle('zero',!w)})}

/* ---------- wishlist ---------- */
CT.toggleWish=async(id,btn)=>{
  if(CT.user){const r=await api('/api/account/wishlist/'+id,{method:'POST',body:{}});CT.wish=new Set(r.ids);ls.set('ct_wish',r.ids);
    CT.toast(r.added?'Saved to wishlist':'Removed from wishlist')}
  else{CT.wish.has(id)?CT.wish.delete(id):CT.wish.add(id);ls.set('ct_wish',[...CT.wish]);CT.toast(CT.wish.has(id)?'Saved to wishlist':'Removed from wishlist')}
  $$(`.wl[data-id="${id}"]`).forEach(b=>b.classList.toggle('on',CT.wish.has(id)));badges();
};

/* ---------- product card ---------- */
CT.card=(p,i=0)=>{
  const off=p.mrp>p.price?Math.round((1-p.price/p.mrp)*100):0;
  return `<article class="card rv d${i%3}" data-pic>
  <a class="pic t-${esc(p.category)}" href="/product?s=${esc(p.slug)}" aria-label="${esc(p.name)}"><img src="${esc(p.images[0]||'/img/chaska-tea-logo.webp')}" alt="${esc(p.name)}" loading="lazy" width="400" height="400">${off?`<span class="off">${off}% OFF</span>`:''}</a>
  <button class="wl ${CT.wish.has(p.id)?'on':''}" data-id="${p.id}" aria-label="Wishlist"><svg viewBox="0 0 24 24"><path d="M12 21s-8-5.200-8-11a4.500 4.500 0 018-2.700A4.500 4.500 0 0120 10c0 5.800-8 11-8 11z"/></svg></button>
  <div class="body"><span class="cat-l">${esc(p.category)} · ${esc(p.weight)}</span><h3><a href="/product?s=${esc(p.slug)}">${esc(p.name.replace(/^ChaskaTea /,''))}</a></h3>
  <div class="price"><b>${inr(p.price)}</b>${p.mrp>p.price?`<s>${inr(p.mrp)}</s>`:''}</div>
  ${p.prepaidDiscount&&CT.cfg?.settings.payments.prepaidDiscount?`<div class="pp">+ ₹${p.prepaidDiscount} off on online payment</div>`:''}
  <div class="acts">${p.stock>0?`<button class="btn sm add" data-id="${p.id}">Add to cart</button><a class="btn sm dark buy" data-buy="${p.id}" href="/checkout?buy=${p.id}">Buy now</a>`:'<button class="btn sm" disabled>Sold out</button>'}</div></div></article>`;
};
document.addEventListener('click',e=>{
  const a=e.target.closest('button.add');if(a){CT.addToCart(Number(a.dataset.id),1,a);CT.toast('Added to cart',{href:'/cart',label:'View cart'});return}
  const w=e.target.closest('.wl[data-id]');if(w){e.preventDefault();CT.toggleWish(Number(w.dataset.id),w)}
});

/* ---------- chrome ---------- */
const path=location.pathname.replace(/\/$/,'')||'/';
function chrome(){
  const c=CT.cfg, s=c.settings.store;
  const strips=c.strips.map((x,i)=>`<a class="${i?'':'on'}" href="${esc(x.link||'/shop')}">${esc(clean(x.title))}</a>`).join('');
  const nav=[['/','Home'],['/shop','Shop'],['/about','Our story'],['/contact','Contact']];
  const hdr=`${strips?`<div class="strip" aria-label="Offers"><div class="track">${strips}</div></div>`:''}
  <header class="hdr"><div class="wrap">
   <a class="logo logo-img" href="/" aria-label="ChaskaTea home"><img src="/img/logo-mark.webp" alt="ChaskaTea" width="1536" height="872"></a>
   <nav class="nav desk">${nav.map(([h,t])=>`<a href="${h}" class="${path===h?'on':''}">${t}</a>`).join('')}</nav>
   <button class="appsearch" id="open-search" aria-label="Search">${I.search}<span>Search teas…</span></button>
   <div class="hdr-right">
     <button class="ibtn desk" id="open-search2" aria-label="Search">${I.search}</button>
     <a class="ibtn desk" href="/account#wishlist" aria-label="Wishlist">${I.heart}<span class="badge wish-badge zero"></span></a>
     <a class="ibtn desk" href="${CT.user?'/account':'/login'}" aria-label="Account">${I.user}</a>
     <a class="ibtn" href="/cart" aria-label="Cart">${I.cart}<span class="badge cart-badge zero"></span></a>
   </div></div></header>`;
  const slot=$('#chrome-top'); if(slot)slot.innerHTML=hdr;
  const tab=[['/','Home',I.home],['/shop','Shop',I.shop],['/account#wishlist','Saved',I.heart,'wish'],['/cart','Cart',I.cart,'cart'],[CT.user?'/account':'/login','Me',I.user]];
  const act=h=>{const [p,hs]=h.split('#');if(hs)return path===p&&location.hash==='#'+hs;if(p==='/account')return path==='/account'&&location.hash!=='#wishlist';return p===path||(p==='/shop'&&path==='/product')||(p==='/login'&&(path==='/signup'||path==='/login'))};
  const tb=document.createElement('nav');tb.className='tabbar';tb.setAttribute('aria-label','App navigation');
  tb.innerHTML=tab.map(([h,t,ic,b])=>`<a href="${h}" class="${act(h)?'on':''}">${ic}${b?`<span class="badge ${b}-badge zero"></span>`:''}<span>${t}</span></a>`).join('');
  document.body.appendChild(tb);
  const f=$('#chrome-foot'); if(f)f.innerHTML=`<footer class="ftr"><div class="wrap"><div class="cols">
    <div><a href="/" class="ftr-logo" aria-label="ChaskaTea home"><img src="/img/logo-full.png" alt="ChaskaTea — Taste of Happiness" width="1536" height="1090"></a><p style="max-width:26em;opacity:.75;font-weight:300;font-size:.92rem">Premium natural tea from the gardens of Assam. No artificial colours and no added flavours. Pure, natural, ChaskaTea.</p></div>
    <div><h4>Shop</h4>${c.categories.map(x=>`<a href="/shop?cat=${esc(x.slug)}">${esc(x.name)}</a>`).join('')}<a href="/shop">All teas</a></div>
    <div><h4>Help</h4><a href="/track">Track order</a><a href="/account">My account</a><a href="/shipping-returns">Shipping &amp; returns</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/contact">Contact</a></div>
    <div><h4>Say hello</h4><a href="tel:${esc(s.phone.replace(/\s/g,''))}">${esc(s.phone)}</a><a href="https://wa.me/${esc(s.whatsapp)}" target="_blank" rel="noopener">WhatsApp us</a><a href="mailto:${esc(s.email)}">${esc(s.email)}</a><p style="opacity:.7;margin-top:.8rem">${esc(s.address)}</p></div>
  </div><div class="fine"><span>© ${new Date().getFullYear()} ChaskaTea. All rights reserved.</span><span>Crafted with care in Assam, India</span></div></div></footer>`;
  $$('#open-search,#open-search2').forEach(b=>b.onclick=openSearch);
  badges();
}
function openSearch(){
  const sh=CT.sheet('Search',`<input class="field" id="sq" placeholder="Search premium, 1kg, combo…" autocomplete="off" style="margin-bottom:.8rem"><div id="sr"></div>`);
  const inp=$('#sq',sh);setTimeout(()=>inp.focus(),350);let t;
  const show=async q=>{const r=await api('/api/products?q='+encodeURIComponent(q));$('#sr',sh).innerHTML=r.products.length?r.products.slice(0,7).map(p=>`<a class="sres" href="/product?s=${esc(p.slug)}"><img src="${esc(p.images[0])}" alt=""><div><b>${esc(p.name)}</b><br><small>${inr(p.price)} · ${esc(p.weight)}</small></div></a>`).join(''):'<p style="color:var(--muted)">No teas match that. Try another word?</p>'};
  inp.oninput=()=>{clearTimeout(t);t=setTimeout(()=>show(inp.value.trim()),200)};
  api('/api/products?featured=1').then(r=>{$('#sr',sh).innerHTML='<small style="font-weight:500;letter-spacing:.24em;font-size:.62rem;color:var(--gold-d)">POPULAR</small>'+r.products.slice(0,5).map(p=>`<a class="sres" href="/product?s=${esc(p.slug)}"><img src="${esc(p.images[0])}" alt=""><div><b>${esc(p.name)}</b><br><small>${inr(p.price)} · ${esc(p.weight)}</small></div></a>`).join('')});
}

/* ---------- reveal + counters ---------- */
CT.reveal=(root=document)=>{
  const io=CT.io||(CT.io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.12,rootMargin:'0px 0px -40px 0px'}));
  $$('.rv:not(.in)',root).forEach(el=>io.observe(el));
};
CT.confetti=()=>{return;const cols=['#9ad83a','#4e8a16','#4d7a14','#2a1408','#dff5b8'];for(let i=0;i<60;i++){const c=document.createElement('i');c.className='confetti';c.style.left=Math.random()*100+'vw';c.style.background=cols[i%5];c.style.animationDelay=Math.random()*.8+'s';c.style.animationDuration=2+Math.random()*2+'s';c.style.borderRadius=Math.random()>.5?'50%':'2px';document.body.appendChild(c);setTimeout(()=>c.remove(),4500)}};

/* ---------- gentle motion ---------- */
function rotateStrips(){const a=$$('.strip .track a');if(a.length<2)return;let i=0;setInterval(()=>{a[i].classList.remove('on');i=(i+1)%a.length;a[i].classList.add('on')},5200)}
function parallax(){
  if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  const els=$$('[data-par]'),hb=$('.hero-bg img');if(!els.length&&!hb)return;let tick=false;
  const run=()=>{tick=false;const y=scrollY;
    if(hb&&y<1200)hb.style.translate='0 '+(y*.08).toFixed(1)+'px';
    els.forEach(e=>{const r=e.getBoundingClientRect();if(r.bottom<-100||r.top>innerHeight+100)return;const f=parseFloat(e.dataset.par)||0;const d=(r.top+r.height/2-innerHeight/2)*f;e.style.translate='0 '+(-d).toFixed(1)+'px'})};
  addEventListener('scroll',()=>{if(!tick){tick=true;requestAnimationFrame(run)}},{passive:true});run();
}

/* ---------- init ---------- */
CT.ready=async(fn)=>{
  try{
    const [cfg,me]=await Promise.all([api('/api/config'),api('/api/auth/me')]);
    CT.cfg=cfg;CT.user=me.user;
    if(CT.user){CT.wish=new Set(CT.user.wishlist);ls.set('ct_wish',CT.user.wishlist)}
  }catch(e){document.body.innerHTML='<div style="padding:3rem;text-align:center;font-family:sans-serif"><h2>We\'ll be right back</h2><p>The store is taking a short break. Please refresh in a moment.</p></div>';return}
  chrome();document.body.classList.add('ready');rotateStrips();parallax();
  try{if(fn)await fn()}catch(e){console.error(e);CT.toast(e.message||'Something went wrong',{bad:1})}
  CT.reveal();badges();
};
CT.requireLogin=()=>{if(!CT.user){location.href='/login?next='+encodeURIComponent(location.pathname+location.search+location.hash);return false}return true};
CT.statusLabel={pending_payment:'Awaiting payment',placed:'Order placed',confirmed:'Confirmed',packed:'Packed',shipped:'Shipped',out_for_delivery:'Out for delivery',delivered:'Delivered',cancelled:'Cancelled',returned:'Returned'};
CT.fmtDate=d=>new Date(d).toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'});
CT.states=['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu & Kashmir','Ladakh','Chandigarh','Puducherry','Andaman & Nicobar','Dadra & Nagar Haveli and Daman & Diu','Lakshadweep'];
CT.stateOpts=sel=>'<option value="">Select state</option>'+CT.states.map(s=>`<option ${s===sel?'selected':''}>${esc(s)}</option>`).join('');
CT.progress=st=>{const steps=[['placed','Placed'],['confirmed','Confirmed'],['packed','Packed'],['shipped','Shipped'],['delivered','Delivered']];
  const map={pending_payment:-1,placed:0,confirmed:1,packed:2,shipped:3,out_for_delivery:3,delivered:4};const cur=map[st];if(cur===undefined)return '';
  return `<div class="progress">${steps.map((s,i)=>`<div class="p ${i<cur||st==='delivered'?'done':i===cur?'cur':''}"><i>${i<cur||st==='delivered'?'✓':i+1}</i>${s[1]}</div>`).join('')}</div>`};
})();

/* ---------- v4 theme extras: scroll progress, WhatsApp button, count-up ---------- */
(function(){
if(location.pathname.startsWith('/admin'))return;
const RM=matchMedia('(prefers-reduced-motion: reduce)').matches;
document.addEventListener('DOMContentLoaded',()=>{
  const bar=document.createElement('div');bar.className='sprog';document.body.appendChild(bar);
  const onS=()=>{const h=document.documentElement;const m=h.scrollHeight-h.clientHeight;bar.style.transform=`scaleX(${m>0?h.scrollTop/m:0})`};
  addEventListener('scroll',onS,{passive:true});onS();
  const nums=[...document.querySelectorAll('[data-count]')];
  const run=el=>{const to=parseFloat(el.dataset.count),dec=+el.dataset.dec||0;if(RM){el.textContent=to.toLocaleString('en-IN',{minimumFractionDigits:dec});return}
    const t0=performance.now(),D=1800;const step=t=>{const k=Math.min(1,(t-t0)/D),e=1-Math.pow(1-k,3);el.textContent=(to*e).toLocaleString('en-IN',{minimumFractionDigits:dec,maximumFractionDigits:dec})+(k===1&&to>=1000?'+':'');if(k<1)requestAnimationFrame(step)};requestAnimationFrame(step)};
  if('IntersectionObserver' in window){const io=new IntersectionObserver(es=>es.forEach(en=>{if(en.isIntersecting){run(en.target);io.unobserve(en.target)}}),{threshold:.4});nums.forEach(n=>io.observe(n))}else nums.forEach(run);
});
if(window.CT&&CT.ready)CT.ready(()=>{const n=CT.cfg?.settings?.store?.whatsapp;if(!n||document.querySelector('.wa-float')||/checkout/.test(location.pathname))return;
  const a=document.createElement('a');a.className='wa-float';a.target='_blank';a.rel='noopener';a.setAttribute('aria-label','Chat on WhatsApp');
  a.href='https://wa.me/'+n+'?text='+encodeURIComponent('Hello ChaskaTea!');
  a.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.200 8.200 0 01-4.200-1.200l-.3-.2-3 .8.8-2.900-.2-.3A8.200 8.200 0 1112 20.200zm4.500-6.100c-.2-.1-1.500-.7-1.700-.8s-.4-.1-.6.1-.6.8-.8 1-.3.2-.5.1a6.700 6.700 0 01-3.300-2.900c-.2-.4.2-.4.700-1.300a.5.5 0 000-.5l-.8-1.900c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.300 3 3 0 00-.9 2.200 5.200 5.200 0 001.100 2.700 11.800 11.800 0 004.500 4c1.700.7 2.300.8 3.200.6a2.700 2.700 0 001.700-1.200 2.200 2.200 0 00.2-1.200c-.1-.1-.3-.2-.5-.3z"/></svg>';
  document.body.appendChild(a)});
})();
