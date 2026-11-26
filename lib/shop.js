'use strict';
const { money, clean, slugify } = require('./util');

const DEFAULT_SETTINGS = {
  store: { name: 'ChaskaTea', tagline: 'Taste of Happiness', email: 'help@chaskatea.com', phone: '+91 91676 65599',
    whatsapp: '919172222236', address: 'Assam, India', gstin: '' },
  shipping: { flat: 0, freeAbove: 0, note: 'Free delivery anywhere in India' },
  cod: { enabled: true, fee: 0, maxAmount: 5000 },
  prepaidDiscountEnabled: true,
  razorpay: { enabled: false, keyId: '', keySecret: '', webhookSecret: '' },
  email: { enabled: false, host: '', port: 465, user: 'info@chaskatea.com', password: '', fromName: 'ChaskaTea', fromEmail: 'info@chaskatea.com', adminEmail: 'info@chaskatea.com', notifyAdmin: true },
  shipmozo: { enabled: false, publicKey: '', privateKey: '', warehouseId: '', baseUrl: '', webhookToken: '', length: 20, breadth: 15, height: 10, autoAssignAwb: true },
  shiprocket: { enabled: false, email: '', password: '', pickupLocation: 'Primary', webhookToken: '', length: 20, breadth: 15, height: 10, autoAssignAwb: true },
};

function getSettings(db) {
  const s = db.data.settings;
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    const d = DEFAULT_SETTINGS[k];
    out[k] = (d && typeof d === 'object') ? Object.assign({}, d, s[k] || {}) : (s[k] === undefined ? d : s[k]);
  }
  return out;
}
// decrypted secrets for server-side use only
function gatewayCfg(db) {
  const s = getSettings(db);
  return {
    razorpay: { enabled: s.razorpay.enabled, keyId: s.razorpay.keyId, keySecret: db.decrypt(s.razorpay.keySecret), webhookSecret: db.decrypt(s.razorpay.webhookSecret) },
    shiprocket: Object.assign({}, s.shiprocket, { password: db.decrypt(s.shiprocket.password) }),
    email: Object.assign({}, s.email, { password: db.decrypt(s.email.password) }),
    shipmozo: Object.assign({}, s.shipmozo, { privateKey: db.decrypt(s.shipmozo.privateKey) }),
  };
}
// settings safe to show in the admin UI: secrets masked
function maskedSettings(db) {
  const s = JSON.parse(JSON.stringify(getSettings(db)));
  const has = (v) => !!v;
  s.razorpay = Object.assign({}, s.razorpay, { keySecret: undefined, webhookSecret: undefined, hasKeySecret: has(getSettings(db).razorpay.keySecret), hasWebhookSecret: has(getSettings(db).razorpay.webhookSecret) });
  s.shiprocket = Object.assign({}, s.shiprocket, { password: undefined, hasPassword: has(getSettings(db).shiprocket.password) });
  s.email = Object.assign({}, s.email, { password: undefined, hasPassword: has(getSettings(db).email.password) });
  s.shipmozo = Object.assign({}, s.shipmozo, { privateKey: undefined, hasPrivateKey: has(getSettings(db).shipmozo.privateKey) });
  return s;
}
function publicSettings(db) {
  const s = getSettings(db);
  const rzOk = s.razorpay.enabled && s.razorpay.keyId && s.razorpay.keySecret;
  return {
    store: s.store, shipping: s.shipping,
    payments: { cod: { enabled: !!s.cod.enabled, fee: s.cod.fee, maxAmount: s.cod.maxAmount }, razorpay: { enabled: !!rzOk }, prepaidDiscount: !!s.prepaidDiscountEnabled },
  };
}

function productView(p) { return p; }

function now() { return new Date().toISOString(); }

// Price a cart on the server. Never trust client prices.
function quote(db, { items, coupon, paymentMethod, userId }) {
  const settings = getSettings(db);
  const lines = [];
  const errors = [];
  for (const it of (Array.isArray(items) ? items : [])) {
    const p = db.data.products.find((x) => x.id === Number(it.id));
    const qty = Math.max(1, Math.min(50, parseInt(it.qty, 10) || 1));
    if (!p || !p.active) { errors.push('An item in your cart is no longer available'); continue; }
    if (p.stock < qty) { errors.push(`${p.name}: only ${p.stock} left`); }
    lines.push({ id: p.id, slug: p.slug, name: p.name, image: p.images[0] || '', weight: p.weight, grams: p.grams, price: p.price, mrp: p.mrp, qty,
      prepaid: p.prepaidDiscount || 0, stock: p.stock });
  }
  const subtotal = money(lines.reduce((s, l) => s + l.price * l.qty, 0));
  const mrpTotal = money(lines.reduce((s, l) => s + Math.max(l.mrp, l.price) * l.qty, 0));
  const pm = paymentMethod === 'razorpay' ? 'razorpay' : 'cod';

  // automatic offers
  let offerDiscount = 0; const appliedOffers = [];
  for (const o of db.data.offers) {
    if (o.kind !== 'auto' || !o.active || !inWindow(o)) continue;
    if (subtotal < (o.minOrder || 0)) continue;
    if (o.paymentMode && o.paymentMode !== 'any' && o.paymentMode !== pm) continue;
    let d = o.discountType === 'percent' ? subtotal * o.value / 100 : o.value;
    if (o.maxDiscount) d = Math.min(d, o.maxDiscount);
    d = Math.min(money(d), subtotal - offerDiscount);
    if (d > 0) { offerDiscount = money(offerDiscount + d); appliedOffers.push({ title: o.title, amount: d }); }
  }

  // coupon
  let couponInfo = null, couponError = null, discount = 0;
  if (coupon) {
    const r = evalCoupon(db, String(coupon), subtotal - offerDiscount, pm, userId);
    if (r.error) couponError = r.error; else { discount = r.discount; couponInfo = { code: r.coupon.code, description: r.coupon.description, amount: discount }; }
  }
  const prepaidDiscount = (pm === 'razorpay' && settings.prepaidDiscountEnabled)
    ? Math.min(money(lines.reduce((s, l) => s + l.prepaid * l.qty, 0)), Math.max(0, subtotal - offerDiscount - discount)) : 0;
  const afterDiscounts = Math.max(0, money(subtotal - offerDiscount - discount - prepaidDiscount));
  const sh = settings.shipping;
  const shipping = (!lines.length) ? 0 : (sh.freeAbove > 0 && subtotal >= sh.freeAbove) ? 0 : money(sh.flat || 0);
  const codFee = (pm === 'cod' && lines.length) ? money(settings.cod.fee || 0) : 0;
  const total = money(afterDiscounts + shipping + codFee);
  return { lines, subtotal, mrpTotal, offerDiscount, appliedOffers, discount, coupon: couponInfo, couponError, prepaidDiscount, shipping, codFee, total,
    savings: money(mrpTotal - subtotal + offerDiscount + discount + prepaidDiscount), paymentMethod: pm, errors,
    codAllowed: settings.cod.enabled && (!settings.cod.maxAmount || total <= settings.cod.maxAmount) };
}
function inWindow(o) {
  const t = Date.now();
  if (o.startsAt && new Date(o.startsAt).getTime() > t) return false;
  if (o.endsAt && new Date(o.endsAt).getTime() < t) return false;
  if (o.expiresAt && new Date(o.expiresAt).getTime() + 86399000 < t) return false;
  return true;
}
function evalCoupon(db, code, base, pm, userId) {
  const c = db.data.coupons.find((x) => x.code.toUpperCase() === code.trim().toUpperCase());
  if (!c || !c.active) return { error: 'This coupon code is not valid' };
  if (!inWindow(c)) return { error: 'This coupon has expired or is not active yet' };
  if (c.usageLimit && c.used >= c.usageLimit) return { error: 'This coupon has been fully redeemed' };
  if (c.minOrder && base < c.minOrder) return { error: `Add ₹${money(c.minOrder - base)} more to use this coupon (min order ₹${c.minOrder})` };
  if (c.paymentMode && c.paymentMode !== 'any' && c.paymentMode !== pm) return { error: c.paymentMode === 'prepaid' ? 'This coupon works only with online payment' : 'This coupon works only with Cash on Delivery' };
  if (c.perUserLimit && userId) {
    const n = db.data.orders.filter((o) => o.userId === userId && o.couponCode === c.code && o.status !== 'cancelled' && o.paymentStatus !== 'failed').length;
    if (n >= c.perUserLimit) return { error: 'You have already used this coupon' };
  }
  let d = c.type === 'percent' ? base * c.value / 100 : c.value;
  if (c.maxDiscount) d = Math.min(d, c.maxDiscount);
  d = Math.max(0, Math.min(money(d), base));
  return { coupon: c, discount: d };
}

const STATUS_LABEL = { pending_payment: 'Awaiting payment', placed: 'Order placed', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled', returned: 'Returned' };

const MAILQ = []; // { number, status, paidNow } — sent by app.js after the request
function pushTimeline(order, status, note, by) {
  order.timeline = order.timeline || [];
  const prev = order.timeline.length ? order.timeline[order.timeline.length - 1].status : null;
  if (status !== prev && !(status === 'cancelled' && prev === 'pending_payment')) MAILQ.push({ number: order.number, status, paidNow: prev === 'pending_payment' || prev === 'cancelled' });
  order.timeline.push({ at: now(), status, label: STATUS_LABEL[status] || status, note: note || '', by: by || 'system' });
}
function addStock(db, items, sign) {
  for (const i of items) { const p = db.data.products.find((x) => x.id === i.id); if (p) p.stock = Math.max(0, p.stock + sign * i.qty); }
}
function logPayment(db, o, extra) {
  db.data.payments.push(Object.assign({ id: db.id('payments'), orderId: o.id, orderNumber: o.number, at: now(), amount: o.total, method: o.paymentMethod }, extra));
}

function createOrder(db, { items, coupon, paymentMethod, address, notes, user }) {
  const q = quote(db, { items, coupon, paymentMethod, userId: user && user.id });
  if (!q.lines.length) throw httpErr(400, 'Your cart is empty');
  if (q.errors.length) throw httpErr(400, q.errors[0]);
  if (q.couponError) throw httpErr(400, q.couponError);
  if (q.paymentMethod === 'cod' && !q.codAllowed) throw httpErr(400, 'Cash on Delivery is not available for this order. Please pay online.');
  const settings = getSettings(db);
  if (q.paymentMethod === 'razorpay' && !(settings.razorpay.enabled && settings.razorpay.keyId && settings.razorpay.keySecret)) throw httpErr(400, 'Online payment is not available right now.');
  const id = db.id('orders');
  const number = 'CT' + (1000 + id);
  const o = {
    id, number, userId: user ? user.id : null, email: address.email || (user && user.email) || '',
    items: q.lines.map((l) => ({ id: l.id, name: l.name, image: l.image, weight: l.weight, grams: l.grams, price: l.price, qty: l.qty })),
    address, notes: clean(notes, 300),
    subtotal: q.subtotal, offerDiscount: q.offerDiscount, discount: q.discount, couponCode: q.coupon ? q.coupon.code : '',
    prepaidDiscount: q.prepaidDiscount, shipping: q.shipping, codFee: q.codFee, total: q.total, appliedOffers: q.appliedOffers,
    paymentMethod: q.paymentMethod, paymentStatus: q.paymentMethod === 'cod' ? 'cod_pending' : 'pending',
    status: q.paymentMethod === 'cod' ? 'placed' : 'pending_payment', timeline: [], createdAt: now(), updatedAt: now(),
    razorpay: null, shiprocket: null,
  };
  pushTimeline(o, o.status, q.paymentMethod === 'cod' ? 'Cash on Delivery order received' : 'Waiting for online payment');
  addStock(db, o.items, -1);
  if (q.coupon) { const c = db.data.coupons.find((x) => x.code === q.coupon.code); if (c) c.used++; }
  db.data.orders.push(o);
  db.save();
  return o;
}
function cancelOrder(db, o, note, by) {
  if (['cancelled', 'delivered'].includes(o.status)) return;
  const restock = !['returned'].includes(o.status);
  o.status = 'cancelled'; o.updatedAt = now();
  if (o.paymentStatus === 'pending') o.paymentStatus = 'failed';
  pushTimeline(o, 'cancelled', note, by);
  if (restock) addStock(db, o.items, +1);
  if (o.couponCode) { const c = db.data.coupons.find((x) => x.code === o.couponCode); if (c && c.used > 0) c.used--; }
  db.save();
}
function markPaid(db, o, { paymentId, rzOrderId, signature, via }) {
  if (o.paymentStatus === 'paid') return false;
  o.paymentStatus = 'paid';
  o.razorpay = Object.assign(o.razorpay || {}, { orderId: rzOrderId || (o.razorpay && o.razorpay.orderId), paymentId, signature: signature || '' });
  if (o.status === 'pending_payment') { o.status = 'confirmed'; pushTimeline(o, 'confirmed', 'Payment received (' + (via || 'razorpay') + ')'); }
  else if (o.status === 'cancelled') { /* paid after cancel (expired): reopen */
    o.status = 'confirmed'; addStock(db, o.items, -1); pushTimeline(o, 'confirmed', 'Payment arrived late; order reopened');
  }
  o.updatedAt = now();
  logPayment(db, o, { status: 'captured', gateway: 'razorpay', gatewayPaymentId: paymentId, gatewayOrderId: rzOrderId });
  db.save();
  return true;
}
function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

module.exports = { DEFAULT_SETTINGS, getSettings, gatewayCfg, maskedSettings, publicSettings, quote, evalCoupon, createOrder, cancelOrder, markPaid,
  pushTimeline, MAILQ, addStock, logPayment, httpErr, now, STATUS_LABEL, inWindow, productView };