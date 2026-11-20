
'use strict';
const BASE = () => process.env.SHIPROCKET_BASE || 'https://apiv2.shiprocket.in';
const cache = { token: null, exp: 0, email: '' };

async function raw(method, path, body, token) {
  const res = await fetch(BASE() + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  if (!res.ok) {
    const msg = (json && (json.message || (json.errors && JSON.stringify(json.errors)))) || ('Shiprocket error ' + res.status);
    const err = new Error(msg); err.status = res.status; err.body = json; throw err;
  }
  return json;
}
async function login(cfg, force) {
  if (!force && cache.token && cache.exp > Date.now() && cache.email === cfg.email) return cache.token;
  const r = await raw('POST', '/v1/external/auth/login', { email: cfg.email, password: cfg.password });
  if (!r.token) throw new Error('Shiprocket login returned no token');
  cache.token = r.token; cache.email = cfg.email; cache.exp = Date.now() + 8 * 24 * 3600 * 1000;
  return r.token;
}
async function api(cfg, method, path, body) {
  let t = await login(cfg);
  try { return await raw(method, path, body, t); }
  catch (e) { if (e.status === 401) { t = await login(cfg, true); return raw(method, path, body, t); } throw e; }
}
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

function buildOrderPayload(order, cfg) {
  const a = order.address;
  const [first, ...rest] = String(a.name).split(' ');
  const grams = order.items.reduce((s, i) => s + (i.grams || 500) * i.qty, 0);
  return {
    order_id: order.number,
    order_date: fmtDate(new Date(order.createdAt)),
    pickup_location: cfg.pickupLocation || 'Primary',
    billing_customer_name: first, billing_last_name: rest.join(' ') || '.',
    billing_address: a.line1, billing_address_2: a.line2 || '',
    billing_city: a.city, billing_pincode: a.pincode, billing_state: a.state, billing_country: 'India',
    billing_email: a.email || order.email || 'noreply@example.com', billing_phone: a.phone,
    shipping_is_billing: true,
    order_items: order.items.map((i) => ({ name: i.name, sku: 'CT-' + i.id, units: i.qty, selling_price: i.price, discount: 0, tax: '', hsn: '0902' })),
    payment_method: order.paymentMethod === 'cod' ? 'COD' : 'Prepaid',
    shipping_charges: order.shipping || 0,
    total_discount: (order.discount || 0) + (order.prepaidDiscount || 0) + (order.offerDiscount || 0),
    sub_total: order.total,
    length: Number(cfg.length) || 20, breadth: Number(cfg.breadth) || 15, height: Number(cfg.height) || 10,
    weight: Math.max(0.1, Math.round(grams) / 1000),
  };
}
const createShipment = (cfg, order) => api(cfg, 'POST', '/v1/external/orders/create/adhoc', buildOrderPayload(order, cfg));
const assignAwb = (cfg, shipmentId) => api(cfg, 'POST', '/v1/external/courier/assign/awb', { shipment_id: shipmentId });
const requestPickup = (cfg, shipmentId) => api(cfg, 'POST', '/v1/external/courier/generate/pickup', { shipment_id: [shipmentId] });
const label = (cfg, shipmentId) => api(cfg, 'POST', '/v1/external/courier/generate/label', { shipment_id: [shipmentId] });
const track = (cfg, awb) => api(cfg, 'GET', `/v1/external/courier/track/awb/${encodeURIComponent(awb)}`);
const cancel = (cfg, srOrderId) => api(cfg, 'POST', '/v1/external/orders/cancel', { ids: [srOrderId] });
const serviceability = (cfg, { pickup, delivery, weight, cod }) =>
  api(cfg, 'GET', `/v1/external/courier/serviceability/?pickup_postcode=${pickup}&delivery_postcode=${delivery}&weight=${weight}&cod=${cod ? 1 : 0}`);
const testCredentials = async (cfg) => { await login(cfg, true); return { ok: true }; };

// Shiprocket status text -> our order status
function mapStatus(s) {
  const x = String(s || '').toUpperCase();
  if (/DELIVERED/.test(x) && !/UNDELIVERED|NOT DELIVERED/.test(x)) return 'delivered';
  if (/RTO|RETURN/.test(x)) return 'returned';
  if (/CANCEL/.test(x)) return 'cancelled';
  if (/OUT FOR DELIVERY/.test(x)) return 'out_for_delivery';
  if (/PICKED|IN TRANSIT|SHIPPED|REACHED|DISPATCH/.test(x)) return 'shipped';
  if (/PICKUP|MANIFEST|READY/.test(x)) return 'packed';
  return null;
}
module.exports = { createShipment, assignAwb, requestPickup, label, track, cancel, serviceability, testCredentials, mapStatus, buildOrderPayload };
