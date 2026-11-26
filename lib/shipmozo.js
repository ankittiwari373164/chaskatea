'use strict';
// Shipmozo courier integration (no npm packages).
// Auth: "public-key" + "private-key" headers from Shipmozo → Settings → API.
// Responses look like { result: "1" | "0", message, data }.
const DEFAULT_BASE = 'https://shipping-api.com/app/api/v1';
const base = (cfg) => (process.env.SHIPMOZO_BASE || cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');

async function api(cfg, method, path, body, query) {
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const res = await fetch(base(cfg) + path + qs, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'public-key': cfg.publicKey || '', 'private-key': cfg.privateKey || '' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = { raw: text.slice(0, 300) }; }
  const failed = !res.ok || String(json.result) === '0' || json.status === false;
  if (failed) {
    let msg = json.message || json.error || (json.data && (json.data.error || json.data.message)) || ('Shipmozo error ' + res.status);
    if (typeof msg === 'object') msg = JSON.stringify(msg);
    const err = new Error(msg); err.status = res.status === 200 ? 400 : res.status; err.body = json; throw err;
  }
  return json.data !== undefined ? json.data : json;
}

const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function buildOrderPayload(order, cfg) {
  const a = order.address || {};
  const grams = order.items.reduce((s, i) => s + (Number(i.grams) || 500) * i.qty, 0);
  const weightG = Math.max(100, Math.round(grams + (Number(cfg.packagingGrams) || 50)));
  const cod = order.paymentMethod === 'cod';
  return {
    order_id: order.number,
    order_date: fmtDate(new Date(order.createdAt)),
    order_type: 'NON ESSENTIALS',
    consignee_name: a.name,
    consignee_phone: String(a.phone || '').replace(/\D/g, '').slice(-10),
    consignee_alternate_phone: '',
    consignee_email: a.email || order.email || '',
    consignee_address_line_one: a.line1,
    consignee_address_line_two: a.line2 || '',
    consignee_pin_code: String(a.pincode),
    consignee_city: a.city,
    consignee_state: a.state || '',
    product_detail: order.items.map((i) => ({ name: i.name, sku_number: 'CT-' + i.id, quantity: i.qty, discount: '', hsn: '0902', unit_price: Number(i.price), product_category: 'Other' })),
    payment_type: cod ? 'COD' : 'PREPAID',
    cod_amount: cod ? String(order.total) : '',
    weight: weightG, // grams
    length: Number(cfg.length) || 20, width: Number(cfg.breadth) || 15, height: Number(cfg.height) || 10,
    warehouse_id: String(cfg.warehouseId || ''),
    gst_ewaybill_number: '', gstin_number: '',
    order_amount: Number(order.total),
  };
}

// same shape the store already uses
async function createShipment(cfg, order) {
  if (!cfg.warehouseId) throw new Error('Add your Shipmozo pickup warehouse ID in Admin → Settings → Shipmozo');
  const d = await api(cfg, 'POST', '/push-order', buildOrderPayload(order, cfg));
  return { order_id: order.number, shipment_id: d.reference_id || d.order_id || order.number, status: 'NEW', raw: d };
}
async function assignAwb(cfg, order) {
  const d = await api(cfg, 'POST', '/auto-assign-order', { order_id: order.number });
  return { awb: d.awb_number || '', courier: [d.courier_company, d.courier_company_service].filter(Boolean).join(' – '), raw: d };
}
const requestPickup = (cfg, order) => api(cfg, 'POST', '/schedule-pickup', { order_id: order.number });
async function label(cfg, awb) {
  const d = await api(cfg, 'GET', '/get-order-label/' + encodeURIComponent(awb));
  const l = Array.isArray(d) ? (d[0] && d[0].label) : (d.label || d.label_url || '');
  if (!l) return { url: null };
  if (/^https?:/i.test(l)) return { url: l };
  return { url: 'data:application/pdf;base64,' + String(l).replace(/^data:[^,]+,/, '') };
}
async function track(cfg, awb) {
  const d = await api(cfg, 'GET', '/track-order', null, { awb_number: awb });
  const t = Array.isArray(d) ? d[0] || {} : d;
  return {
    status: t.current_status || '', courier: t.courier || '', etd: t.expected_delivery_date || '',
    activities: (t.scan_detail || []).slice(0, 15).map((s) => ({ date: s.scan_date_time || s.date, activity: s.scan_status || s.status, location: s.scan_location || s.location || '' })),
  };
}
const cancel = (cfg, order, awb) => api(cfg, 'POST', '/cancel-order', { order_id: order.number, awb_number: awb || '' });
const warehouses = (cfg) => api(cfg, 'GET', '/get-warehouses');
async function testCredentials(cfg) {
  const list = await warehouses(cfg);
  return { ok: true, warehouses: (Array.isArray(list) ? list : []).map((w) => ({ id: w.id, title: w.address_title || w.name, pincode: w.pincode, isDefault: String(w.default) === '1' })) };
}

// Shipmozo / courier status text -> our order status
function mapStatus(s) {
  const x = String(s || '').toUpperCase();
  if (/RTO|RETURN/.test(x)) return /DELIVERED/.test(x) ? 'returned' : null;
  if (/DELIVERED/.test(x) && !/UNDELIVERED|NOT DELIVERED/.test(x)) return 'delivered';
  if (/CANCEL/.test(x)) return 'cancelled';
  if (/OUT FOR DELIVERY|OFD/.test(x)) return 'out_for_delivery';
  if (/PICKED|IN TRANSIT|INTRANSIT|SHIPPED|REACHED|DISPATCH|IN-TRANSIT/.test(x)) return 'shipped';
  if (/PICKUP|MANIFEST|READY|BOOKED|AWB ASSIGNED/.test(x)) return 'packed';
  return null;
}
module.exports = { createShipment, assignAwb, requestPickup, label, track, cancel, warehouses, testCredentials, mapStatus, buildOrderPayload, DEFAULT_BASE };