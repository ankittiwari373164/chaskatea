'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DB } = require('./db');
const { RemoteDB } = require('./db-mysql');
const U = require('./util');
const shop = require('./shop');
const rzp = require('./razorpay');
const sm = require('./shipmozo');
const { seed } = require('./seed');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(process.env.HOME || os.homedir() || __dirname, 'chaskatea-data');
const PUBLIC = path.join(__dirname, '..', 'public');
const mailer = require('./mailer');
const REMOTE = !!process.env.DB_HOST; // Vercel / serverless mode: data lives in an external MySQL database
const UPLOADS = path.join(DATA_DIR, 'uploads');
if (!REMOTE) fs.mkdirSync(UPLOADS, { recursive: true });

const db = REMOTE ? new RemoteDB() : new DB(DATA_DIR);
if (!REMOTE && db.isNew) seed(db);
if (!REMOTE) {
  process.on('SIGTERM', () => { db.flush(); process.exit(0); });
  process.on('SIGINT', () => { db.flush(); process.exit(0); });
}

const { httpErr } = shop;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.xml': 'application/xml; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

// ---------- helpers ----------
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, opts });
};
const send = (res, status, body, headers = {}) => {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(data);
};
function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(httpErr(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const parseCookies = (h) => Object.fromEntries(String(h || '').split(';').map((s) => s.trim().split('=')).filter((a) => a[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const isHttps = (req) => (req.headers['x-forwarded-proto'] || '').includes('https');
function sessionUser(req) {
  const sid = parseCookies(req.headers.cookie).ct_sid;
  if (!sid) return null;
  const h = U.sha(sid);
  const s = db.data.sessions.find((x) => x.h === h);
  if (!s || s.exp < Date.now()) return null;
  return db.data.users.find((u) => u.id === s.userId) || null;
}
function startSession(req, res, user) {
  const sid = U.token(32);
  db.data.sessions = db.data.sessions.filter((s) => s.exp > Date.now());
  db.data.sessions.push({ h: U.sha(sid), userId: user.id, exp: Date.now() + 30 * 864e5 });
  db.save();
  return `ct_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${isHttps(req) ? '; Secure' : ''}`;
}
const pubUser = (u) => u && ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, mustChangePassword: !!u.mustChangePassword, wishlist: u.wishlist || [] });

// simple in-memory rate limiter
const hits = new Map();
function limit(key, max, windowMs) {
  const t = Date.now(); const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(t); hits.set(key, arr); return true;
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (!v.some((x) => t - x < 3600e3)) hits.delete(k); }, 600e3).unref();

const ip = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// ---------- auth / account ----------
route('GET', '/api/health', (ctx) => ({ ok: true, time: shop.now() }));

route('GET', '/api/config', () => {
  const settings = shop.publicSettings(db);
  return {
    settings,
    categories: db.data.categories.filter((c) => c.active).sort((a, b) => a.sort - b.sort),
    banners: db.data.offers.filter((o) => o.kind === 'banner' && o.active && shop.inWindow(o)).sort((a, b) => a.sort - b.sort),
    strips: db.data.offers.filter((o) => o.kind === 'strip' && o.active && shop.inWindow(o)).sort((a, b) => a.sort - b.sort),
    autoOffers: db.data.offers.filter((o) => o.kind === 'auto' && o.active && shop.inWindow(o)).map((o) => ({ title: o.title, subtitle: o.subtitle })),
    reviews: db.data.reviews.filter((r) => r.active),
  };
});

route('POST', '/api/auth/signup', async (ctx) => {
  if (!limit('signup:' + ip(ctx.req), 10, 3600e3)) throw httpErr(429, 'Too many sign-ups from this device. Try again later.');
  const b = ctx.body; const email = U.clean(b.email, 120).toLowerCase(); const name = U.clean(b.name, 80);
  if (name.length < 2) throw httpErr(400, 'Please enter your name');
  if (!U.isEmail(email)) throw httpErr(400, 'Please enter a valid email');
  if (b.phone && !U.isPhone(b.phone)) throw httpErr(400, 'Please enter a valid 10-digit mobile number');
  if (String(b.password || '').length < 6) throw httpErr(400, 'Password must be at least 6 characters');
  if (db.data.users.some((u) => u.email === email)) throw httpErr(409, 'An account with this email already exists. Try logging in.');
  const u = { id: db.id('users'), name, email, phone: U.normPhone(b.phone), passHash: U.hashPassword(b.password), role: 'customer', addresses: [], wishlist: [], createdAt: shop.now() };
  db.data.users.push(u); db.save();
  // attach any earlier guest orders placed with this email
  db.data.orders.forEach((o) => { if (!o.userId && o.email && o.email.toLowerCase() === email) o.userId = u.id; });
  return { user: pubUser(u), headers: { 'Set-Cookie': startSession(ctx.req, ctx.res, u) } };
});
route('POST', '/api/auth/login', async (ctx) => {
  const email = U.clean(ctx.body.email, 120).toLowerCase();
  if (!limit('login:' + ip(ctx.req) + email, 8, 15 * 60e3)) throw httpErr(429, 'Too many attempts. Please wait a few minutes.');
  const u = db.data.users.find((x) => x.email === email);
  if (!u || !U.checkPassword(String(ctx.body.password || ''), u.passHash)) throw httpErr(401, 'Email or password is incorrect');
  return { user: pubUser(u), headers: { 'Set-Cookie': startSession(ctx.req, ctx.res, u) } };
});
route('POST', '/api/auth/logout', (ctx) => {
  const sid = parseCookies(ctx.req.headers.cookie).ct_sid;
  if (sid) { const h = U.sha(sid); db.data.sessions = db.data.sessions.filter((s) => s.h !== h); db.save(); }
  return { ok: true, headers: { 'Set-Cookie': 'ct_sid=; Path=/; HttpOnly; Max-Age=0' } };
});
route('GET', '/api/auth/me', (ctx) => ({ user: pubUser(ctx.user) }));
route('POST', '/api/auth/password', (ctx) => {
  const u = need(ctx);
  if (!U.checkPassword(String(ctx.body.current || ''), u.passHash)) throw httpErr(400, 'Current password is incorrect');
  const np = String(ctx.body.password || '');
  if (np.length < 8 && u.role === 'admin') throw httpErr(400, 'Use at least 8 characters for the admin password');
  if (np.length < 6) throw httpErr(400, 'New password must be at least 6 characters');
  if (U.checkPassword(np, u.passHash)) throw httpErr(400, 'Please choose a different password');
  u.passHash = U.hashPassword(np); u.mustChangePassword = false; db.save();
  return { ok: true, user: pubUser(u) };
});
const need = (ctx) => { if (!ctx.user) throw httpErr(401, 'Please log in'); return ctx.user; };
const needAdmin = (ctx) => {
  const u = need(ctx);
  if (u.role !== 'admin') throw httpErr(403, 'Admins only');
  if (u.mustChangePassword && !ctx.allowMustChange) throw httpErr(403, 'Please set a new admin password first');
  return u;
};

route('PUT', '/api/account/profile', (ctx) => {
  const u = need(ctx); const b = ctx.body;
  const name = U.clean(b.name, 80); if (name.length < 2) throw httpErr(400, 'Please enter your name');
  if (b.phone && !U.isPhone(b.phone)) throw httpErr(400, 'Please enter a valid 10-digit mobile number');
  u.name = name; u.phone = U.normPhone(b.phone); db.save(); return { user: pubUser(u) };
});
function cleanAddress(b) {
  const a = { label: U.clean(b.label || 'Home', 30), name: U.clean(b.name, 80), phone: U.normPhone(b.phone), email: U.clean(b.email, 120).toLowerCase(),
    line1: U.clean(b.line1, 160), line2: U.clean(b.line2, 160), city: U.clean(b.city, 60), state: U.clean(b.state, 60), pincode: String(b.pincode || '').trim() };
  if (a.name.length < 2) throw httpErr(400, 'Please enter the full name');
  if (!U.isPhone(a.phone)) throw httpErr(400, 'Please enter a valid 10-digit mobile number');
  if (a.email && !U.isEmail(a.email)) throw httpErr(400, 'Please enter a valid email');
  if (a.line1.length < 5) throw httpErr(400, 'Please enter the address');
  if (a.city.length < 2) throw httpErr(400, 'Please enter the city');
  if (a.state.length < 2) throw httpErr(400, 'Please choose the state');
  if (!U.isPin(a.pincode)) throw httpErr(400, 'Please enter a valid 6-digit pincode');
  return a;
}
route('GET', '/api/account/addresses', (ctx) => ({ addresses: need(ctx).addresses }));
route('POST', '/api/account/addresses', (ctx) => {
  const u = need(ctx); if (u.addresses.length >= 10) throw httpErr(400, 'You can save up to 10 addresses');
  const a = cleanAddress(ctx.body); a.id = db.id('addresses'); a.isDefault = !u.addresses.length || !!ctx.body.isDefault;
  if (a.isDefault) u.addresses.forEach((x) => (x.isDefault = false));
  u.addresses.push(a); db.save(); return { addresses: u.addresses };
});
route('PUT', '/api/account/addresses/:id', (ctx) => {
  const u = need(ctx); const i = u.addresses.findIndex((x) => x.id === Number(ctx.params.id)); if (i < 0) throw httpErr(404, 'Address not found');
  const a = Object.assign(cleanAddress(ctx.body), { id: u.addresses[i].id, isDefault: !!ctx.body.isDefault });
  if (a.isDefault) u.addresses.forEach((x) => (x.isDefault = false));
  u.addresses[i] = a; db.save(); return { addresses: u.addresses };
});
route('DELETE', '/api/account/addresses/:id', (ctx) => {
  const u = need(ctx); u.addresses = u.addresses.filter((x) => x.id !== Number(ctx.params.id));
  if (u.addresses.length && !u.addresses.some((x) => x.isDefault)) u.addresses[0].isDefault = true;
  db.save(); return { addresses: u.addresses };
});
route('GET', '/api/account/orders', (ctx) => {
  const u = need(ctx);
  return { orders: db.data.orders.filter((o) => o.userId === u.id).sort((a, b) => b.id - a.id).map(orderView) };
});
route('GET', '/api/account/orders/:number', (ctx) => {
  const u = need(ctx); const o = db.data.orders.find((x) => x.number === ctx.params.number && x.userId === u.id);
  if (!o) throw httpErr(404, 'Order not found'); return { order: orderView(o) };
});
route('POST', '/api/account/orders/:number/cancel', async (ctx) => {
  const u = need(ctx); const o = db.data.orders.find((x) => x.number === ctx.params.number && x.userId === u.id);
  if (!o) throw httpErr(404, 'Order not found');
  if (!['pending_payment', 'placed', 'confirmed'].includes(o.status)) throw httpErr(400, 'This order can no longer be cancelled. Please contact us.');
  await cancelEverywhere(o, 'Cancelled by customer', 'customer');
  return { order: orderView(o) };
});
route('GET', '/api/account/wishlist', (ctx) => {
  const u = need(ctx);
  return { ids: u.wishlist, products: u.wishlist.map((id) => db.data.products.find((p) => p.id === id && p.active)).filter(Boolean) };
});
route('POST', '/api/account/wishlist/:id', (ctx) => {
  const u = need(ctx); const id = Number(ctx.params.id);
  if (!db.data.products.some((p) => p.id === id)) throw httpErr(404, 'Product not found');
  const i = u.wishlist.indexOf(id); if (i >= 0) u.wishlist.splice(i, 1); else u.wishlist.push(id);
  db.save(); return { ids: u.wishlist, added: i < 0 };
});

function orderView(o) {
  return { number: o.number, status: o.status, statusLabel: shop.STATUS_LABEL[o.status], paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus,
    items: o.items, address: o.address, subtotal: o.subtotal, offerDiscount: o.offerDiscount, discount: o.discount, couponCode: o.couponCode,
    prepaidDiscount: o.prepaidDiscount, shipping: o.shipping, codFee: o.codFee, total: o.total, createdAt: o.createdAt, timeline: o.timeline,
    tracking: o.shiprocket && o.shiprocket.awb ? { awb: o.shiprocket.awb, courier: o.shiprocket.courier, url: o.shiprocket.provider === 'shipmozo' || !o.shiprocket.trackingUrl ? '' : o.shiprocket.trackingUrl, status: o.shiprocket.status, etd: o.shiprocket.etd || '', activities: (o.shiprocket.activities || []).slice(0, 8) } : null };
}

// ---------- catalogue ----------
route('GET', '/api/products', (ctx) => {
  const { cat, q, sort, featured, ids } = ctx.query;
  let list = db.data.products.filter((p) => p.active);
  if (cat && cat !== 'all') list = list.filter((p) => p.category === cat);
  if (featured) list = list.filter((p) => p.featured);
  if (ids) { const set = new Set(String(ids).split(',').map(Number)); list = list.filter((p) => set.has(p.id)); }
  if (q) { const t = String(q).toLowerCase(); list = list.filter((p) => (p.name + ' ' + p.category + ' ' + p.short).toLowerCase().includes(t)); }
  const sorters = { 'price-asc': (a, b) => a.price - b.price, 'price-desc': (a, b) => b.price - a.price, 'discount': (a, b) => (b.mrp - b.price) / b.mrp - (a.mrp - a.price) / a.mrp, 'new': (a, b) => b.id - a.id };
  if (sorters[sort]) list.sort(sorters[sort]);
  return { products: list };
});
route('GET', '/api/products/:slug', (ctx) => {
  const p = db.data.products.find((x) => x.slug === ctx.params.slug && x.active);
  if (!p) throw httpErr(404, 'Product not found');
  const related = db.data.products.filter((x) => x.active && x.id !== p.id && x.category === p.category).slice(0, 6);
  const siblings = db.data.products.filter((x) => x.active && x.id !== p.id && x.category === p.category && x.name.replace(/\d.*$/, '') === p.name.replace(/\d.*$/, '')).slice(0, 4);
  return { product: p, related, siblings };
});

route('POST', '/api/cart/quote', (ctx) => shop.quote(db, { items: ctx.body.items, coupon: ctx.body.coupon, paymentMethod: ctx.body.paymentMethod, userId: ctx.user && ctx.user.id }));

// ---------- orders ----------
route('POST', '/api/orders', async (ctx) => {
  if (!limit('order:' + ip(ctx.req), 20, 3600e3)) throw httpErr(429, 'Too many orders from this device. Please try later.');
  const b = ctx.body;
  const address = cleanAddress(b.address || {});
  if (b.saveAddress && ctx.user && !ctx.user.addresses.some((a) => a.line1 === address.line1 && a.pincode === address.pincode)) {
    ctx.user.addresses.push(Object.assign({ id: db.id('addresses'), isDefault: !ctx.user.addresses.length }, address));
  }
  const o = shop.createOrder(db, { items: b.items, coupon: b.coupon, paymentMethod: b.paymentMethod, address, notes: b.notes, user: ctx.user });
  if (o.paymentMethod === 'cod') {
    shop.logPayment(db, o, { status: 'pending', gateway: 'cod' });
    db.save();
    maybeAutoShip(o);
    return { order: orderView(o) };
  }
  // Razorpay: create gateway order
  try {
    const cfg = shop.gatewayCfg(db).razorpay;
    const r = await rzp.createOrder(cfg, { amount: o.total, receipt: o.number, notes: { order: o.number } });
    o.razorpay = { orderId: r.id };
    shop.logPayment(db, o, { status: 'created', gateway: 'razorpay', gatewayOrderId: r.id });
    db.save();
    return { order: orderView(o), razorpay: { keyId: cfg.keyId, orderId: r.id, amount: r.amount, currency: r.currency, name: shop.getSettings(db).store.name,
      prefill: { name: address.name, email: address.email, contact: address.phone } } };
  } catch (e) {
    shop.cancelOrder(db, o, 'Could not start online payment: ' + e.message, 'system');
    throw httpErr(502, 'Could not start the online payment. ' + e.message);
  }
});
route('POST', '/api/orders/:number/razorpay/retry', async (ctx) => {
  const o = findGuestOrder(ctx);
  if (o.paymentMethod !== 'razorpay' || o.paymentStatus === 'paid') throw httpErr(400, 'Nothing to pay for this order');
  if (o.status === 'cancelled') throw httpErr(400, 'This order was cancelled. Please place it again.');
  const cfg = shop.gatewayCfg(db).razorpay;
  const r = await rzp.createOrder(cfg, { amount: o.total, receipt: o.number + '-r' + Date.now().toString(36), notes: { order: o.number } });
  o.razorpay = Object.assign(o.razorpay || {}, { orderId: r.id }); o.paymentStatus = 'pending'; db.save();
  return { order: orderView(o), razorpay: { keyId: cfg.keyId, orderId: r.id, amount: r.amount, currency: r.currency, name: shop.getSettings(db).store.name,
    prefill: { name: o.address.name, email: o.address.email, contact: o.address.phone } } };
});
// A guest can act on their order only with number + phone, or when logged in as owner
function findGuestOrder(ctx) {
  const o = db.data.orders.find((x) => x.number === ctx.params.number);
  if (!o) throw httpErr(404, 'Order not found');
  const owner = ctx.user && o.userId === ctx.user.id;
  const phoneOk = ctx.body && ctx.body.phone && U.normPhone(ctx.body.phone) === o.address.phone;
  const tokenOk = ctx.body && ctx.body.token && ctx.body.token === o.accessToken;
  if (!owner && !phoneOk && !tokenOk) throw httpErr(403, 'Not allowed');
  return o;
}
route('POST', '/api/orders/:number/razorpay/verify', (ctx) => {
  const o = db.data.orders.find((x) => x.number === ctx.params.number);
  if (!o || o.paymentMethod !== 'razorpay') throw httpErr(404, 'Order not found');
  const b = ctx.body; const cfg = shop.gatewayCfg(db).razorpay;
  if (!o.razorpay || o.razorpay.orderId !== b.razorpay_order_id) throw httpErr(400, 'Payment does not match this order');
  if (!rzp.verifyPayment(cfg.keySecret, b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) {
    shop.logPayment(db, o, { status: 'failed', gateway: 'razorpay', gatewayPaymentId: b.razorpay_payment_id, note: 'Signature mismatch' }); db.save();
    throw httpErr(400, 'Payment could not be verified. If money was debited it will be refunded automatically.');
  }
  shop.markPaid(db, o, { paymentId: b.razorpay_payment_id, rzOrderId: b.razorpay_order_id, signature: b.razorpay_signature, via: 'checkout' });
  maybeAutoShip(o);
  return { order: orderView(o) };
});
route('POST', '/api/orders/:number/razorpay/failed', (ctx) => {
  const o = findGuestOrder(ctx);
  if (o.paymentStatus === 'paid') return { order: orderView(o) };
  shop.logPayment(db, o, { status: 'failed', gateway: 'razorpay', note: U.clean((ctx.body.reason || 'Payment failed or cancelled'), 200) });
  o.paymentStatus = 'failed'; shop.pushTimeline(o, o.status, 'Online payment attempt failed or was closed'); db.save();
  return { order: orderView(o) };
});
route('POST', '/api/track', (ctx) => {
  if (!limit('track:' + ip(ctx.req), 30, 3600e3)) throw httpErr(429, 'Too many lookups. Please try later.');
  const num = U.clean(ctx.body.number, 20).toUpperCase().replace(/^#/, '');
  const o = db.data.orders.find((x) => x.number === num);
  if (!o || U.normPhone(ctx.body.phone) !== o.address.phone) throw httpErr(404, 'We could not find an order with those details');
  return { order: orderView(o) };
});
route('POST', '/api/contact', (ctx) => {
  if (!limit('contact:' + ip(ctx.req), 8, 3600e3)) throw httpErr(429, 'Too many messages. Please try later.');
  const b = ctx.body; const name = U.clean(b.name, 80), msg = U.clean(b.message, 1500);
  if (name.length < 2 || msg.length < 5) throw httpErr(400, 'Please add your name and a message');
  if (b.email && !U.isEmail(b.email)) throw httpErr(400, 'Please enter a valid email');
  db.data.messages.push({ id: db.id('messages'), name, email: U.clean(b.email, 120), phone: U.normPhone(b.phone), message: msg, read: false, createdAt: shop.now() }); db.save();
  return { ok: true };
});

// ---------- webhooks ----------
route('POST', '/api/webhooks/razorpay', (ctx) => {
  const cfg = shop.gatewayCfg(db).razorpay;
  if (!rzp.verifyWebhook(cfg.webhookSecret, ctx.raw, ctx.req.headers['x-razorpay-signature'])) throw httpErr(400, 'Bad signature');
  const ev = JSON.parse(ctx.raw.toString('utf8')); const pay = ev.payload && ev.payload.payment && ev.payload.payment.entity;
  if (ev.event === 'payment.captured' || ev.event === 'order.paid') {
    const rzOrder = pay ? pay.order_id : ev.payload.order.entity.id;
    const o = db.data.orders.find((x) => x.razorpay && x.razorpay.orderId === rzOrder);
    if (o) { if (shop.markPaid(db, o, { paymentId: pay && pay.id, rzOrderId: rzOrder, via: 'webhook' })) maybeAutoShip(o); }
  } else if (ev.event === 'payment.failed' && pay) {
    const o = db.data.orders.find((x) => x.razorpay && x.razorpay.orderId === pay.order_id);
    if (o && o.paymentStatus !== 'paid') { o.paymentStatus = 'failed'; shop.logPayment(db, o, { status: 'failed', gateway: 'razorpay', gatewayPaymentId: pay.id, note: pay.error_description || 'Payment failed' }); db.save(); }
  } else if (ev.event === 'refund.processed') {
    const rf = ev.payload.refund && ev.payload.refund.entity;
    const o = rf && db.data.orders.find((x) => x.razorpay && x.razorpay.paymentId === rf.payment_id);
    if (o) { o.paymentStatus = 'refunded'; shop.logPayment(db, o, { status: 'refunded', gateway: 'razorpay', gatewayPaymentId: rf.payment_id, amount: rf.amount / 100, note: 'Refund processed' }); db.save(); }
  }
  return { ok: true };
});
// Shipmozo status webhook: add https://YOUR-DOMAIN/api/webhooks/shipmozo?token=YOUR_TOKEN in Shipmozo → Settings → Webhook
function shipWebhook(ctx) {
  const cfg = shop.getSettings(db).shipmozo;
  const tok = ctx.query.token || ctx.req.headers['x-api-key'] || ctx.req.headers['x-webhook-token'] || '';
  if (!cfg.webhookToken || !U.safeEq(String(tok), cfg.webhookToken)) throw httpErr(401, 'Unauthorized');
  let b = {}; try { b = JSON.parse(ctx.raw.toString('utf8') || '{}'); } catch (e) { b = {}; }
  const d = b.data && typeof b.data === 'object' && !Array.isArray(b.data) ? Object.assign({}, b, b.data) : b;
  const awb = String(d.awb_number || d.awb || '');
  const o = db.data.orders.find((x) => x.number === String(d.order_id || '') || (awb && x.shiprocket && x.shiprocket.awb === awb));
  if (o) {
    if (awb && o.shiprocket && !o.shiprocket.awb) o.shiprocket.awb = awb;
    applyShipStatus(o, d.current_status || d.status || d.shipment_status, d.courier || d.courier_company || d.courier_name);
  }
  return { ok: true };
}
route('POST', '/api/webhooks/shipmozo', shipWebhook);
function applyShipStatus(o, text, courier) {
  o.shiprocket = Object.assign(o.shiprocket || {}, { status: text, courier: courier || (o.shiprocket && o.shiprocket.courier) });
  const st = sm.mapStatus(text);
  if (st && st !== o.status && !(o.status === 'delivered')) {
    o.status = st; o.updatedAt = shop.now(); shop.pushTimeline(o, st, 'Courier: ' + text, 'shipmozo');
    if (st === 'delivered' && o.paymentMethod === 'cod' && o.paymentStatus !== 'cod_collected') {
      o.paymentStatus = 'cod_collected'; shop.logPayment(db, o, { status: 'collected', gateway: 'cod', note: 'COD collected on delivery (courier)' });
    }
  }
  db.save();
}
async function cancelEverywhere(o, note, by) {
  if (o.shiprocket && o.shiprocket.shipmentId) { try { await sm.cancel(shop.gatewayCfg(db).shipmozo, o, o.shiprocket.awb); } catch (e) { shop.pushTimeline(o, o.status, 'Shipmozo cancel failed: ' + e.message, 'system'); } }
  shop.cancelOrder(db, o, note, by);
}
async function createShipmentFor(o) {
  const cfg = shop.gatewayCfg(db).shipmozo;
  if (!cfg.enabled || !cfg.publicKey || !cfg.privateKey) throw httpErr(400, 'Shipmozo is not connected. Add your API keys in Admin → Settings.');
  if (o.shiprocket && o.shiprocket.shipmentId) throw httpErr(400, 'A shipment already exists for this order');
  if (o.status === 'cancelled' || o.status === 'pending_payment') throw httpErr(400, 'This order is not ready to ship');
  const r = await sm.createShipment(cfg, o);
  // order.shiprocket is the store's generic "shipment" record (name kept for existing orders)
  o.shiprocket = { provider: 'shipmozo', srOrderId: r.order_id, shipmentId: r.shipment_id, status: r.status || 'NEW', createdAt: shop.now() };
  shop.pushTimeline(o, o.status, 'Shipment created in Shipmozo', 'admin');
  if (cfg.autoAssignAwb) {
    try {
      const d = await sm.assignAwb(cfg, o);
      if (d.awb) {
        Object.assign(o.shiprocket, { awb: d.awb, courier: d.courier, trackingUrl: 'https://www.chaskatea.com/track?n=' + encodeURIComponent(o.number) });
        shop.pushTimeline(o, o.status, `AWB ${d.awb} assigned (${d.courier || 'courier'})`, 'shipmozo');
        try { await sm.requestPickup(cfg, o); o.shiprocket.pickupRequested = true; } catch (e) { o.shiprocket.pickupNote = e.message; }
      } else o.shiprocket.awbNote = 'AWB not assigned yet. Assign a courier in your Shipmozo panel.';
    } catch (e) { o.shiprocket.awbNote = e.message; }
  }
  db.save(); return o;
}
function maybeAutoShip(o) { /* shipments are created by the admin explicitly; hook kept for future automation */ }

// ---------- admin ----------
const A = (method, p, fn) => route(method, '/api/admin' + p, (ctx) => { ctx.admin = needAdmin(ctx); return fn(ctx); });

A('GET', '/stats', () => {
  const orders = db.data.orders; const day = (d) => new Date(d).toISOString().slice(0, 10);
  const valid = orders.filter((o) => o.status !== 'cancelled' && o.paymentStatus !== 'failed' && o.status !== 'pending_payment');
  const today = day(Date.now());
  const rev = (list) => U.money(list.reduce((s, o) => s + o.total, 0));
  const days = []; for (let i = 6; i >= 0; i--) { const d = day(Date.now() - i * 864e5); days.push({ day: d, orders: valid.filter((o) => day(o.createdAt) === d).length, revenue: rev(valid.filter((o) => day(o.createdAt) === d)) }); }
  const counts = {}; orders.forEach((o) => { counts[o.status] = (counts[o.status] || 0) + 1; });
  const top = {}; valid.forEach((o) => o.items.forEach((i) => { top[i.name] = (top[i.name] || 0) + i.qty; }));
  return { totalOrders: orders.length, revenue: rev(valid), todayOrders: valid.filter((o) => day(o.createdAt) === today).length, todayRevenue: rev(valid.filter((o) => day(o.createdAt) === today)),
    customers: db.data.users.filter((u) => u.role === 'customer').length, products: db.data.products.length,
    lowStock: db.data.products.filter((p) => p.active && p.stock <= 10).map((p) => ({ id: p.id, name: p.name, stock: p.stock })),
    codPending: U.money(orders.filter((o) => o.paymentStatus === 'cod_pending' && o.status !== 'cancelled').reduce((s, o) => s + o.total, 0)),
    onlineCollected: U.money(orders.filter((o) => o.paymentStatus === 'paid').reduce((s, o) => s + o.total, 0)),
    unreadMessages: db.data.messages.filter((m) => !m.read).length, days, counts,
    topProducts: Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty })),
    recent: orders.slice(-6).reverse().map((o) => ({ number: o.number, name: o.address.name, total: o.total, status: o.status, createdAt: o.createdAt })),
    gateways: { razorpay: !!(shop.getSettings(db).razorpay.enabled && shop.getSettings(db).razorpay.keyId), shipmozo: !!(shop.getSettings(db).shipmozo.enabled && shop.getSettings(db).shipmozo.publicKey) } };
});

// products
function cleanProduct(b, existing) {
  const name = U.clean(b.name, 140); if (name.length < 2) throw httpErr(400, 'Product name is required');
  const price = Number(b.price), mrp = Number(b.mrp || b.price);
  if (!(price >= 0)) throw httpErr(400, 'Enter a valid price');
  if (mrp < price) throw httpErr(400, 'MRP cannot be lower than the selling price');
  const cat = U.clean(b.category, 40).toLowerCase();
  if (!db.data.categories.some((c) => c.slug === cat)) throw httpErr(400, 'Choose a valid category');
  let slug = U.slugify(b.slug || name);
  if (db.data.products.some((p) => p.slug === slug && (!existing || p.id !== existing.id))) slug += '-' + (existing ? existing.id : db.data.seq.products + 1);
  const grams = Math.max(1, parseInt(b.grams, 10) || 500);
  return { slug, name, category: cat, weight: U.clean(b.weight || (grams >= 1000 ? grams / 1000 + 'kg' : grams + 'g'), 20), grams, price: U.money(price), mrp: U.money(mrp),
    prepaidDiscount: Math.max(0, Number(b.prepaidDiscount) || 0), stock: Math.max(0, parseInt(b.stock, 10) || 0), active: b.active !== false, featured: !!b.featured,
    short: U.clean(b.short, 200), description: U.clean(b.description, 4000), highlights: (Array.isArray(b.highlights) ? b.highlights : String(b.highlights || '').split('\n')).map((x) => U.clean(x, 120)).filter(Boolean).slice(0, 10),
    images: (Array.isArray(b.images) ? b.images : []).map((x) => U.clean(x, 300)).filter((x) => /^(\/img\/|\/uploads\/|https:\/\/)/.test(x)).slice(0, 8), tags: [] };
}
A('GET', '/products', () => ({ products: db.data.products, categories: db.data.categories }));
A('POST', '/products', (ctx) => {
  const p = Object.assign({ id: db.id('products'), createdAt: shop.now(), sold: 0 }, cleanProduct(ctx.body)); db.data.products.push(p); db.save(); return { product: p };
});
A('PUT', '/products/:id', (ctx) => {
  const p = db.data.products.find((x) => x.id === Number(ctx.params.id)); if (!p) throw httpErr(404, 'Not found');
  Object.assign(p, cleanProduct(ctx.body, p)); db.save(); return { product: p };
});
A('DELETE', '/products/:id', (ctx) => {
  const p = db.data.products.find((x) => x.id === Number(ctx.params.id)); if (!p) throw httpErr(404, 'Not found');
  if (db.data.orders.some((o) => o.items.some((i) => i.id === p.id))) { p.active = false; db.save(); return { ok: true, archived: true }; }
  db.data.products = db.data.products.filter((x) => x !== p); db.save(); return { ok: true };
});
A('POST', '/upload', async (ctx) => {
  const m = /^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/.exec(ctx.body.data || '');
  if (!m) throw httpErr(400, 'Upload a PNG, JPG, WebP or GIF image');
  const buf = Buffer.from(m[3], 'base64'); if (buf.length > 5 * 1024 * 1024) throw httpErr(400, 'Image must be under 5 MB');
  const ext = { png: 'png', jpeg: 'jpg', webp: 'webp', gif: 'gif' }[m[2]];
  const name = U.token(8) + '.' + ext;
  if (REMOTE) await db.putUpload(name, buf, m[1]); else fs.writeFileSync(path.join(UPLOADS, name), buf);
  return { url: '/uploads/' + name };
});
// categories
A('POST', '/categories', (ctx) => {
  const name = U.clean(ctx.body.name, 40); if (!name) throw httpErr(400, 'Name required');
  const slug = U.slugify(name); if (db.data.categories.some((c) => c.slug === slug)) throw httpErr(400, 'Category exists');
  const c = { id: db.id('categories'), slug, name, blurb: U.clean(ctx.body.blurb, 80), color: /^#[0-9a-f]{6}$/i.test(ctx.body.color) ? ctx.body.color : '#E8A21A', sort: db.data.categories.length, active: true };
  db.data.categories.push(c); db.save(); return { category: c };
});
A('PUT', '/categories/:id', (ctx) => {
  const c = db.data.categories.find((x) => x.id === Number(ctx.params.id)); if (!c) throw httpErr(404, 'Not found');
  Object.assign(c, { name: U.clean(ctx.body.name, 40) || c.name, blurb: U.clean(ctx.body.blurb, 80), active: ctx.body.active !== false, color: /^#[0-9a-f]{6}$/i.test(ctx.body.color) ? ctx.body.color : c.color });
  db.save(); return { category: c };
});
// orders
A('GET', '/orders', (ctx) => {
  let list = db.data.orders.slice().sort((a, b) => b.id - a.id);
  const { status, q, payment } = ctx.query;
  if (status) list = list.filter((o) => o.status === status);
  if (payment) list = list.filter((o) => o.paymentMethod === payment);
  if (q) { const t = String(q).toLowerCase(); list = list.filter((o) => (o.number + o.address.name + o.address.phone + o.email).toLowerCase().includes(t)); }
  return { orders: list };
});
A('GET', '/orders/:number', (ctx) => {
  const o = db.data.orders.find((x) => x.number === ctx.params.number); if (!o) throw httpErr(404, 'Not found'); return { order: o };
});
const FLOW = ['placed', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned', 'pending_payment'];
A('PUT', '/orders/:number/status', async (ctx) => {
  const o = db.data.orders.find((x) => x.number === ctx.params.number); if (!o) throw httpErr(404, 'Not found');
  const st = ctx.body.status; if (!FLOW.includes(st)) throw httpErr(400, 'Unknown status');
  if (st === o.status) return { order: o };
  if (st === 'cancelled') { await cancelEverywhere(o, U.clean(ctx.body.note, 200) || 'Cancelled by store', 'admin'); return { order: o }; }
  if (o.status === 'cancelled') { shop.addStock(db, o.items, -1); }
  o.status = st; o.updatedAt = shop.now(); shop.pushTimeline(o, st, U.clean(ctx.body.note, 200), 'admin');
  if (st === 'delivered' && o.paymentMethod === 'cod' && o.paymentStatus === 'cod_pending') {
    o.paymentStatus = 'cod_collected'; shop.logPayment(db, o, { status: 'collected', gateway: 'cod', note: 'Cash collected on delivery' });
  }
  db.save(); return { order: o };
});
A('PUT', '/orders/:number/note', (ctx) => {
  const o = db.data.orders.find((x) => x.number === ctx.params.number); if (!o) throw httpErr(404, 'Not found');
  o.adminNote = U.clean(ctx.body.note, 500); db.save(); return { order: o };
});
A('POST', '/orders/:number/ship', async (ctx) => {
  const o = db.data.orders.find((x) => x.number === ctx.params.number); if (!o) throw httpErr(404, 'Not found');
  try { await createShipmentFor(o); } catch (e) { if (!e.status) e.status = 502; if (e.status === 502) e.message = 'Shipmozo said: ' + e.message; throw e; }
  return { order: o };
});
A('POST', '/orders/:number/track', async (ctx) => {
  const o = db.data.orders.find((x) => x.number === ctx.params.number); if (!o) throw httpErr(404, 'Not found');
  if (!o.shiprocket || !o.shiprocket.awb) throw httpErr(400, 'No AWB yet for this order');
  try {
    const t = await sm.track(shop.gatewayCfg(db).shipmozo, o.shiprocket.awb);
    if (t.status) applyShipStatus(o, t.status, t.courier);
    o.shiprocket.activities = t.activities; o.shiprocket.etd = t.etd || ''; db.save();
  } catch (e) { throw httpErr(502, 'Shipmozo said: ' + e.message); }
  return { order: o };
});
A('POST', '/orders/:number/shipment-label', async (ctx) => {
  const o = db.data.orders.find((x) => x.number === ctx.params.number); if (!o || !o.shiprocket) throw httpErr(404, 'No shipment');
  if (!o.shiprocket.awb) throw httpErr(400, 'The label is ready once a courier (AWB) is assigned');
  try { const r = await sm.label(shop.gatewayCfg(db).shipmozo, o.shiprocket.awb); return { url: r.url }; }
  catch (e) { throw httpErr(502, 'Shipmozo said: ' + e.message); }
});
A('POST', '/orders/:number/cod-collected', (ctx) => {
  const o = db.data.orders.find((x) => x.number === ctx.params.number); if (!o || o.paymentMethod !== 'cod') throw httpErr(400, 'Not a COD order');
  if (o.paymentStatus !== 'cod_collected') { o.paymentStatus = 'cod_collected'; shop.logPayment(db, o, { status: 'collected', gateway: 'cod', note: 'Marked collected by admin' }); db.save(); }
  return { order: o };
});
A('POST', '/orders/:number/refund', async (ctx) => {
  const o = db.data.orders.find((x) => x.number === ctx.params.number); if (!o) throw httpErr(404, 'Not found');
  if (o.paymentMethod !== 'razorpay' || o.paymentStatus !== 'paid' || !(o.razorpay && o.razorpay.paymentId)) throw httpErr(400, 'Only paid online orders can be refunded here');
  const amt = ctx.body.amount ? Number(ctx.body.amount) : o.total; if (!(amt > 0 && amt <= o.total)) throw httpErr(400, 'Invalid refund amount');
  try { const r = await rzp.refund(shop.gatewayCfg(db).razorpay, o.razorpay.paymentId, amt, { order: o.number });
    o.paymentStatus = amt >= o.total ? 'refunded' : 'paid'; shop.logPayment(db, o, { status: 'refunded', gateway: 'razorpay', gatewayPaymentId: o.razorpay.paymentId, amount: amt, note: 'Refund ' + r.id });
    shop.pushTimeline(o, o.status, `Refund of ₹${amt} initiated`, 'admin'); db.save(); return { order: o };
  } catch (e) { throw httpErr(502, 'Razorpay said: ' + e.message); }
});
// coupons / offers
const couponFields = (b, existing) => {
  const code = U.clean(b.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, ''); if (code.length < 3) throw httpErr(400, 'Coupon code needs at least 3 letters/numbers');
  if (db.data.coupons.some((c) => c.code === code && (!existing || c.id !== existing.id))) throw httpErr(400, 'This code already exists');
  const type = b.type === 'flat' ? 'flat' : 'percent'; const value = Number(b.value);
  if (!(value > 0)) throw httpErr(400, 'Enter a discount value'); if (type === 'percent' && value > 100) throw httpErr(400, 'Percent cannot exceed 100');
  return { code, description: U.clean(b.description, 120), type, value, maxDiscount: Number(b.maxDiscount) || 0, minOrder: Number(b.minOrder) || 0, usageLimit: parseInt(b.usageLimit, 10) || 0,
    perUserLimit: parseInt(b.perUserLimit, 10) || 0, paymentMode: ['any', 'prepaid', 'cod'].includes(b.paymentMode) ? b.paymentMode : 'any', active: b.active !== false,
    startsAt: b.startsAt || '', expiresAt: b.expiresAt || '' };
};
A('GET', '/coupons', () => ({ coupons: db.data.coupons.slice().reverse() }));
A('POST', '/coupons', (ctx) => { const c = Object.assign({ id: db.id('coupons'), used: 0, createdAt: shop.now() }, couponFields(ctx.body)); db.data.coupons.push(c); db.save(); return { coupon: c }; });
A('PUT', '/coupons/:id', (ctx) => { const c = db.data.coupons.find((x) => x.id === Number(ctx.params.id)); if (!c) throw httpErr(404, 'Not found'); Object.assign(c, couponFields(ctx.body, c)); db.save(); return { coupon: c }; });
A('DELETE', '/coupons/:id', (ctx) => { db.data.coupons = db.data.coupons.filter((x) => x.id !== Number(ctx.params.id)); db.save(); return { ok: true }; });
const offerFields = (b) => {
  const kind = ['banner', 'strip', 'auto'].includes(b.kind) ? b.kind : 'banner'; const title = U.clean(b.title, 160); if (!title) throw httpErr(400, 'Title is required');
  const o = { kind, title, subtitle: U.clean(b.subtitle, 200), cta: U.clean(b.cta, 30), link: /^(\/|https:\/\/)/.test(b.link || '') ? b.link : '/shop', theme: ['marigold', 'terracotta', 'leaf', 'ink'].includes(b.theme) ? b.theme : 'marigold',
    active: b.active !== false, sort: parseInt(b.sort, 10) || 0, startsAt: b.startsAt || '', endsAt: b.endsAt || '' };
  if (kind === 'auto') { o.discountType = b.discountType === 'flat' ? 'flat' : 'percent'; o.value = Number(b.value); if (!(o.value > 0)) throw httpErr(400, 'Enter a discount value'); o.minOrder = Number(b.minOrder) || 0; o.maxDiscount = Number(b.maxDiscount) || 0; o.paymentMode = ['any', 'prepaid', 'cod'].includes(b.paymentMode) ? b.paymentMode : 'any'; }
  return o;
};
A('GET', '/offers', () => ({ offers: db.data.offers.slice().sort((a, b) => a.kind.localeCompare(b.kind) || a.sort - b.sort) }));
A('POST', '/offers', (ctx) => { const o = Object.assign({ id: db.id('offers'), createdAt: shop.now() }, offerFields(ctx.body)); db.data.offers.push(o); db.save(); return { offer: o }; });
A('PUT', '/offers/:id', (ctx) => { const o = db.data.offers.find((x) => x.id === Number(ctx.params.id)); if (!o) throw httpErr(404, 'Not found'); for (const k of ['discountType', 'value', 'minOrder', 'maxDiscount', 'paymentMode']) delete o[k]; Object.assign(o, offerFields(ctx.body)); db.save(); return { offer: o }; });
A('DELETE', '/offers/:id', (ctx) => { db.data.offers = db.data.offers.filter((x) => x.id !== Number(ctx.params.id)); db.save(); return { ok: true }; });
// payments
A('GET', '/payments', (ctx) => {
  const orders = db.data.orders;
  const summary = { paidOnline: U.money(orders.filter((o) => o.paymentStatus === 'paid').reduce((s, o) => s + o.total, 0)),
    codPending: U.money(orders.filter((o) => o.paymentStatus === 'cod_pending' && o.status !== 'cancelled').reduce((s, o) => s + o.total, 0)),
    codCollected: U.money(orders.filter((o) => o.paymentStatus === 'cod_collected').reduce((s, o) => s + o.total, 0)),
    refunded: U.money(db.data.payments.filter((p) => p.status === 'refunded').reduce((s, p) => s + (p.amount || 0), 0)),
    failed: db.data.payments.filter((p) => p.status === 'failed').length };
  return { summary, payments: db.data.payments.slice().reverse().slice(0, 300), orders: orders.slice().reverse().slice(0, 300).map((o) => ({ number: o.number, name: o.address.name, total: o.total, method: o.paymentMethod, paymentStatus: o.paymentStatus, status: o.status, createdAt: o.createdAt, rzPaymentId: o.razorpay && o.razorpay.paymentId })) };
});
// customers + messages
A('GET', '/customers', () => ({ customers: db.data.users.filter((u) => u.role === 'customer').map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, createdAt: u.createdAt,
  orders: db.data.orders.filter((o) => o.userId === u.id).length, spent: U.money(db.data.orders.filter((o) => o.userId === u.id && o.status !== 'cancelled' && o.paymentStatus !== 'failed').reduce((s, o) => s + o.total, 0)) })).reverse() }));
A('POST', '/customers/:id/reset-password', (ctx) => {
  const u = db.data.users.find((x) => x.id === Number(ctx.params.id) && x.role === 'customer'); if (!u) throw httpErr(404, 'Not found');
  const pw = U.token(4); u.passHash = U.hashPassword(pw); db.data.sessions = db.data.sessions.filter((s) => s.userId !== u.id); db.save(); return { password: pw };
});
A('GET', '/messages', () => ({ messages: db.data.messages.slice().reverse() }));
A('PUT', '/messages/:id', (ctx) => { const m = db.data.messages.find((x) => x.id === Number(ctx.params.id)); if (m) { m.read = ctx.body.read !== false; db.save(); } return { ok: true }; });
A('DELETE', '/messages/:id', (ctx) => { db.data.messages = db.data.messages.filter((x) => x.id !== Number(ctx.params.id)); db.save(); return { ok: true }; });
// settings (secrets are write-only)
A('GET', '/settings', (ctx) => {
  const host = (ctx.req.headers['x-forwarded-host'] || ctx.req.headers.host || ''); const proto = isHttps(ctx.req) ? 'https' : 'http';
  return { settings: shop.maskedSettings(db), webhookUrls: { razorpay: `${proto}://${host}/api/webhooks/razorpay`, shipmozo: `${proto}://${host}/api/webhooks/shipmozo` } };
});
A('PUT', '/settings', (ctx) => {
  const b = ctx.body || {}; const cur = db.data.settings; const g = shop.getSettings(db);
  if (b.store) cur.store = Object.assign({}, g.store, Object.fromEntries(Object.entries(b.store).filter(([k]) => k in shop.DEFAULT_SETTINGS.store).map(([k, v]) => [k, U.clean(v, 200)])));
  if (b.shipping) cur.shipping = { flat: Math.max(0, Number(b.shipping.flat) || 0), freeAbove: Math.max(0, Number(b.shipping.freeAbove) || 0), note: U.clean(b.shipping.note, 120) };
  if (b.cod) cur.cod = { enabled: !!b.cod.enabled, fee: Math.max(0, Number(b.cod.fee) || 0), maxAmount: Math.max(0, Number(b.cod.maxAmount) || 0) };
  if ('prepaidDiscountEnabled' in b) cur.prepaidDiscountEnabled = !!b.prepaidDiscountEnabled;
  if (b.razorpay) {
    const r = Object.assign({}, g.razorpay);
    if ('enabled' in b.razorpay) r.enabled = !!b.razorpay.enabled;
    if ('keyId' in b.razorpay) { const k = U.clean(b.razorpay.keyId, 60); if (k && !/^rzp_(test|live)_\w+$/.test(k)) throw httpErr(400, 'Razorpay Key ID looks like rzp_test_xxxx or rzp_live_xxxx'); r.keyId = k; }
    if (b.razorpay.keySecret) r.keySecret = db.encrypt(U.clean(b.razorpay.keySecret, 100));
    if (b.razorpay.webhookSecret) r.webhookSecret = db.encrypt(U.clean(b.razorpay.webhookSecret, 100));
    if (r.enabled && (!r.keyId || !r.keySecret)) throw httpErr(400, 'Add the Razorpay Key ID and Key Secret before turning it on');
    cur.razorpay = r;
  }
  if (b.email) {
    const m = Object.assign({}, g.email);
    for (const k of ['host', 'user', 'fromName', 'fromEmail', 'adminEmail']) if (k in b.email) m[k] = U.clean(b.email[k], 120);
    if ('port' in b.email) m.port = Number(b.email.port) || 465;
    for (const k of ['enabled', 'notifyAdmin']) if (k in b.email) m[k] = !!b.email[k];
    if (b.email.password) m.password = db.encrypt(U.clean(b.email.password, 200));
    for (const k of ['user', 'fromEmail', 'adminEmail']) if (m[k] && !U.isEmail(m[k])) throw httpErr(400, 'Please enter a valid email for ' + k);
    if (m.enabled && (!m.host || !m.user || !m.password)) throw httpErr(400, 'Add the SMTP server, email and password before turning emails on');
    cur.email = m;
  }
  if (b.shipmozo) {
    const s = Object.assign({}, g.shipmozo);
    for (const k of ['publicKey', 'warehouseId', 'webhookToken']) if (k in b.shipmozo) s[k] = U.clean(b.shipmozo[k], 200);
    if ('baseUrl' in b.shipmozo) { const u = U.clean(b.shipmozo.baseUrl, 200); if (u && !/^https:\/\//.test(u)) throw httpErr(400, 'API address must start with https://'); s.baseUrl = u; }
    for (const k of ['length', 'breadth', 'height']) if (k in b.shipmozo) s[k] = Math.max(1, Number(b.shipmozo[k]) || s[k]);
    if ('enabled' in b.shipmozo) s.enabled = !!b.shipmozo.enabled; if ('autoAssignAwb' in b.shipmozo) s.autoAssignAwb = !!b.shipmozo.autoAssignAwb;
    if (b.shipmozo.privateKey) s.privateKey = db.encrypt(U.clean(b.shipmozo.privateKey, 200));
    if (s.enabled && (!s.publicKey || !s.privateKey)) throw httpErr(400, 'Add the Shipmozo public and private keys before turning it on');
    cur.shipmozo = s;
  }
  db.save(); return { settings: shop.maskedSettings(db) };
});
A('POST', '/settings/test-razorpay', async () => {
  const cfg = shop.gatewayCfg(db).razorpay; if (!cfg.keyId || !cfg.keySecret) throw httpErr(400, 'Save your Razorpay keys first');
  try { await rzp.testCredentials(cfg); return { ok: true, message: 'Razorpay accepted your keys' + (cfg.keyId.startsWith('rzp_test') ? ' (test mode)' : ' (live mode)') }; }
  catch (e) { throw httpErr(400, 'Razorpay rejected the keys: ' + e.message); }
});
A('POST', '/settings/test-email', async () => {
  const cfg = shop.gatewayCfg(db).email; if (!cfg.host || !cfg.user || !cfg.password) throw httpErr(400, 'Save your email (SMTP) details first');
  try { await mailer.smtpSend(cfg, { to: [cfg.adminEmail || cfg.fromEmail], ...mailer.testEmail(cfg) }); return { ok: true, message: 'Test email sent to ' + (cfg.adminEmail || cfg.fromEmail) }; }
  catch (e) { throw httpErr(400, 'Email failed: ' + e.message); }
});
A('POST', '/settings/test-shipmozo', async () => {
  const cfg = shop.gatewayCfg(db).shipmozo; if (!cfg.publicKey || !cfg.privateKey) throw httpErr(400, 'Save your Shipmozo API keys first');
  try {
    const r = await sm.testCredentials(cfg);
    const w = r.warehouses; const list = w.length ? ' Your warehouses: ' + w.map((x) => `${x.title} (ID ${x.id}${x.isDefault ? ', default' : ''})`).join(', ') + '.' : ' No pickup warehouse found yet: add one in Shipmozo.';
    return { ok: true, message: 'Shipmozo keys work.' + list, warehouses: w };
  } catch (e) { throw httpErr(400, 'Shipmozo rejected the keys: ' + e.message); }
});
// ---------- static + dispatch ----------
const PAGES = { '/': 'index.html', '/shop': 'shop.html', '/product': 'product.html', '/cart': 'cart.html', '/checkout': 'checkout.html', '/order-success': 'order-success.html',
  '/track': 'track.html', '/about': 'about.html', '/contact': 'contact.html', '/login': 'login.html', '/signup': 'signup.html', '/account': 'account/index.html', '/admin': 'admin/index.html',
  '/shipping-returns': 'policy.html', '/privacy': 'policy.html', '/terms': 'policy.html', '/offline': 'offline.html' };
function serveFile(req, res, file, immutable) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size,
      'Cache-Control': immutable ? 'public, max-age=2592000' : (ext === '.html' ? 'no-cache' : 'public, max-age=300'), 'X-Content-Type-Options': 'nosniff' };
    res.writeHead(200, headers); if (req.method === 'HEAD') return res.end(); fs.createReadStream(file).pipe(res);
  });
}
async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x'); let p = decodeURIComponent(url.pathname);
    res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (REMOTE && (p.startsWith('/api/') || p.startsWith('/uploads/'))) {
      await db.begin(!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && p.startsWith('/api/'));
      if (db.isNew) seed(db);
      if (db.writing) expireOrders();
    }
    if (p === '/sitemap.xml' || p === '/api/sitemap') {
      const SITE = 'https://www.chaskatea.com'; const today = new Date().toISOString().slice(0, 10);
      const urls = [['/', '1.0', 'daily'], ['/shop', '0.9', 'daily'], ['/about', '0.6', 'monthly'], ['/blog', '0.7', 'weekly'], ['/contact', '0.5', 'monthly'], ['/track', '0.3', 'monthly'], ['/shipping-returns', '0.3', 'yearly'], ['/privacy', '0.2', 'yearly'], ['/terms', '0.2', 'yearly']]
        .map(([u, pr, f]) => ({ loc: SITE + u, pr, f, mod: today }));
      for (const c of db.data.categories.filter((c) => c.active)) urls.push({ loc: SITE + '/shop?cat=' + encodeURIComponent(c.slug), pr: '0.8', f: 'weekly', mod: today });
      for (const pr of db.data.products.filter((x) => x.active)) urls.push({ loc: SITE + '/products/' + pr.slug, pr: '0.9', f: 'weekly', mod: (pr.updatedAt || today).slice(0, 10), img: pr.images && pr.images[0] ? SITE + pr.images[0] : '' });
      try { for (const b of JSON.parse(fs.readFileSync(path.join(PUBLIC, 'blog', 'posts.json'), 'utf8'))) urls.push({ loc: SITE + '/blog/' + b.slug, pr: '0.7', f: 'monthly', mod: b.date }); } catch (e) {}
      const x = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' +
        urls.map((u) => `<url><loc>${x(u.loc)}</loc><lastmod>${u.mod}</lastmod><changefreq>${u.f}</changefreq><priority>${u.pr}</priority>${u.img ? `<image:image><image:loc>${x(u.img)}</image:loc></image:image>` : ''}</url>`).join('\n') + '\n</urlset>\n';
      if (REMOTE) await db.end();
      return send(res, 200, xml, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
    }
    if (p.startsWith('/api/')) fixCopy();
    if (p.startsWith('/api/')) {
      const r = routes.find((x) => x.method === req.method && x.re.test(p));
      if (!r) return send(res, req.method !== 'GET' && routes.some((x) => x.re.test(p)) ? 405 : 404, { error: 'Not found' });
      const m = r.re.exec(p); const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const ctx = { req, res, params, query: Object.fromEntries(url.searchParams), user: sessionUser(req), body: {}, raw: Buffer.alloc(0) };
      if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        ctx.raw = await readBody(req);
        const isHook = p.startsWith('/api/webhooks/');
        if (!isHook && ctx.raw.length) {
          if (!(req.headers['content-type'] || '').includes('application/json')) throw httpErr(415, 'JSON only');
          try { ctx.body = JSON.parse(ctx.raw.toString('utf8')); } catch (e) { throw httpErr(400, 'Invalid JSON'); }
        }
      }
      if (p === '/api/auth/password') ctx.allowMustChange = true;
      let out = await r.handler(ctx);
      if (shop.MAILQ.length) await flushMail();
      if (REMOTE) await db.end();
      const headers = out && out.headers; if (out && out.headers) { out = Object.assign({}, out); delete out.headers; }
      return send(res, 200, out == null ? { ok: true } : out, headers || {});
    }
    if (p.startsWith('/uploads/')) {
      if (REMOTE) {
        const f = await db.getUpload(path.basename(p));
        if (!f) return send(res, 404, 'Not found');
        res.writeHead(200, { 'Content-Type': f.mime || 'application/octet-stream', 'Content-Length': f.data.length, 'Cache-Control': 'public, max-age=2592000, immutable', 'X-Content-Type-Options': 'nosniff' });
        return res.end(req.method === 'HEAD' ? undefined : f.data);
      }
      return serveFile(req, res, path.join(UPLOADS, path.basename(p)), true);
    }
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    if (PAGES[p]) return serveFile(req, res, path.join(PUBLIC, PAGES[p]));
    if (/^\/products\/[a-z0-9-]+$/i.test(p)) return serveFile(req, res, path.join(PUBLIC, 'product.html'));
    if (p === '/blog') return serveFile(req, res, path.join(PUBLIC, 'blog', 'index.html'));
    if (/^\/blog\/[a-z0-9-]+$/i.test(p) && fs.existsSync(path.join(PUBLIC, p + '.html'))) return serveFile(req, res, path.join(PUBLIC, p + '.html'));
    const file = path.normalize(path.join(PUBLIC, p));
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(req, res, file, /^\/(img|video)\//.test(p));
    if (!path.extname(p)) { res.statusCode = 404; return fs.createReadStream(path.join(PUBLIC, '404.html')).on('error', () => res.end('Not found')).pipe(res); }
    return send(res, 404, 'Not found');
  } catch (e) {
    if (REMOTE) await db.end().catch((err) => console.error('db.end failed', err));
    const status = e.status || 500; if (status >= 500) console.error(e);
    send(res, status, { error: status >= 500 && !e.status ? 'Something went wrong. Please try again.' : e.message });
  }
}
// brand wording: "Natural" (not "100% natural"); applied to stored product text on every request, saved with the next write
function fixCopy() {
  const fx = (t) => typeof t === 'string' ? t.replace(/100\s?%\s?natural,?\s*nothing added/gi, 'Natural, no artificial colour').replace(/100\s?%\s?(n)atural/gi, (m, n) => (n === 'N' ? 'N' : 'n') + 'atural') : t;
  for (const pr of db.data.products || []) {
    pr.short = fx(pr.short); pr.description = fx(pr.description);
    if (Array.isArray(pr.highlights)) pr.highlights = pr.highlights.map((h) => { const v = fx(h); return /^natural/.test(v) ? v[0].toUpperCase() + v.slice(1) : v; });
  }
}
// send queued order emails (customer + store copy). Never blocks an order if email fails.
async function flushMail() {
  const jobs = shop.MAILQ.splice(0);
  const cfg = shop.gatewayCfg(db).email; if (!cfg.enabled || !cfg.host || !cfg.password) return;
  const store = shop.getSettings(db).store;
  const work = jobs.map(async (j) => {
    const o = db.data.orders.find((x) => x.number === j.number); if (!o) return;
    const m = mailer.orderEmail(o, j.status, store, { paidNow: j.paidNow });
    try {
      if (m && o.email && U.isEmail(o.email)) await mailer.smtpSend(cfg, { to: [o.email], replyTo: cfg.adminEmail || cfg.fromEmail, ...m });
      const isNew = j.status === 'placed' || (j.status === 'confirmed' && j.paidNow);
      if (isNew && cfg.notifyAdmin && cfg.adminEmail) await mailer.smtpSend(cfg, { to: [cfg.adminEmail], replyTo: o.email || undefined, ...mailer.adminEmail(o) });
    } catch (e) { console.error('email failed for', j.number, j.status, e.message); }
  });
  await Promise.race([Promise.all(work), new Promise((r) => setTimeout(r, 15000))]);
}
const server = http.createServer(handler);
// expire abandoned online-payment orders after 45 minutes and give the stock back
function expireOrders() {
  const cut = Date.now() - 45 * 60e3;
  for (const o of db.data.orders) if (o.status === 'pending_payment' && new Date(o.createdAt).getTime() < cut) shop.cancelOrder(db, o, 'Payment not completed in time', 'system');
}
if (!REMOTE) setInterval(expireOrders, 5 * 60e3).unref();
module.exports = { server, handler, db, PORT, DATA_DIR };