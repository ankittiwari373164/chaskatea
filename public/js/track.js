/* ChaskaTea analytics: Google Analytics 4 + Meta Pixel with e-commerce events.
   ▶ Paste your IDs below and redeploy. Leave empty to switch a tracker off. */
(function(){
var GA4_ID   = '';   // e.g. 'G-ABC123XYZ'  (Google Analytics → Admin → Data streams → Web → Measurement ID)
var PIXEL_ID = '';   // e.g. '123456789012345' (Meta Events Manager → Data sources → your Pixel ID)

if (location.pathname.indexOf('/admin') === 0) { window.CTtrack = { view:function(){}, add:function(){}, checkout:function(){}, purchase:function(){} }; return; }

if (GA4_ID) {
  var g = document.createElement('script'); g.async = true; g.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID; document.head.appendChild(g);
  window.dataLayer = window.dataLayer || []; window.gtag = function(){ dataLayer.push(arguments); };
  gtag('js', new Date()); gtag('config', GA4_ID);
}
if (PIXEL_ID) {
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', PIXEL_ID); fbq('track', 'PageView');
}
function ga(ev, p){ if (window.gtag && GA4_ID) gtag('event', ev, p); }
function fb(ev, p, id){ if (window.fbq && PIXEL_ID) fbq('track', ev, p, id ? { eventID: id } : undefined); }
function item(p, qty){ return { item_id: String(p.slug || p.id), item_name: p.name, item_category: p.category, item_variant: p.weight, price: Number(p.price) || 0, quantity: qty || 1 }; }

window.CTtrack = {
  view: function(p){ ga('view_item', { currency: 'INR', value: p.price, items: [item(p)] }); fb('ViewContent', { content_ids: [String(p.slug)], content_name: p.name, content_type: 'product', value: p.price, currency: 'INR' }); },
  add: function(p, qty){ if (!p) return; qty = qty || 1; ga('add_to_cart', { currency: 'INR', value: p.price * qty, items: [item(p, qty)] }); fb('AddToCart', { content_ids: [String(p.slug)], content_type: 'product', value: p.price * qty, currency: 'INR' }); },
  checkout: function(lines, total){ ga('begin_checkout', { currency: 'INR', value: total, items: (lines||[]).map(function(l){ return item(l, l.qty); }) }); fb('InitiateCheckout', { value: total, currency: 'INR', num_items: (lines||[]).reduce(function(s,l){ return s + (l.qty||1); }, 0) }); },
  purchase: function(o){
    if (!o || !o.number) return;
    try { if (localStorage.getItem('ct_tracked_' + o.number)) return; localStorage.setItem('ct_tracked_' + o.number, '1'); } catch(e) {}
    var items = (o.items || []).map(function(i){ return { item_id: String(i.slug || i.productId || i.name), item_name: i.name, price: Number(i.price) || 0, quantity: i.qty || 1 }; });
    ga('purchase', { transaction_id: o.number, currency: 'INR', value: o.total, shipping: o.shipping || 0, items: items, payment_type: o.paymentMethod });
    fb('Purchase', { value: o.total, currency: 'INR', content_type: 'product', content_ids: items.map(function(i){ return i.item_id; }), num_items: items.length }, o.number);
  }
};
})();