'use strict';
// Tiny stand-ins for Razorpay and Shipmozo so the integration code can be exercised without real accounts.
// They mimic the real request/response shapes for the endpoints this store uses. NOT the real services.
const http = require('http');
const crypto = require('crypto');
function start(port) {
  const orders = {}; let n = 0; const state = { shipments: {}, calls: [] };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const body = b ? JSON.parse(b) : {}; const url = req.url.split('?')[0]; state.calls.push(req.method + ' ' + url);
      const out = (code, j) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
      // ---- Razorpay ----
      if (url.startsWith('/v1/orders') || url.startsWith('/v1/payments')) {
        const auth = Buffer.from((req.headers.authorization || '').replace('Basic ', ''), 'base64').toString();
        if (auth !== 'rzp_test_MOCKKEY:MOCKSECRET') return out(401, { error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } });
        if (req.method === 'POST' && url === '/v1/orders') { const id = 'order_MOCK' + (++n); orders[id] = body; return out(200, { id, amount: body.amount, currency: body.currency, receipt: body.receipt, status: 'created' }); }
        if (req.method === 'GET' && url === '/v1/orders') return out(200, { entity: 'collection', count: 0, items: [] });
        if (/\/refund$/.test(url)) return out(200, { id: 'rfnd_MOCK1', amount: body.amount, status: 'processed' });
      }
      // ---- Shipmozo (base /sm) ----
      if (url.startsWith('/sm/')) {
        const ok1 = (data) => out(200, { result: '1', message: 'Success', data });
        if (req.headers['public-key'] !== 'PUBKEY' || req.headers['private-key'] !== 'PRIVKEY') return out(200, { result: '0', message: 'Invalid public or private key', data: {} });
        const p = url.slice(3);
        if (p === '/get-warehouses') return ok1([{ id: 64832, default: '1', address_title: 'Assam Warehouse', pincode: '781001' }]);
        if (p === '/push-order') {
          for (const f of ['order_id', 'consignee_pin_code', 'consignee_phone', 'product_detail', 'payment_type', 'weight', 'warehouse_id']) if (!body[f] || (Array.isArray(body[f]) && !body[f].length)) return out(200, { result: '0', message: f + ' is required', data: {} });
          const ref = 'REF' + (9000 + Object.keys(state.shipments).length); state.shipments[body.order_id] = body; return ok1({ order_id: body.order_id, reference_id: ref });
        }
        if (p === '/auto-assign-order') return ok1({ order_id: body.order_id, reference_id: 'R', awb_number: 'MOCKAWB' + body.order_id, courier_company: 'Mock Express', courier_company_service: 'Surface' });
        if (p === '/schedule-pickup') return ok1({ order_id: body.order_id, awb_number: 'MOCKAWB' + body.order_id });
        if (p.startsWith('/get-order-label/')) return ok1([{ label: 'https://example.test/label.pdf' }]);
        if (p === '/track-order') return ok1({ order_id: 'x', awb_number: 'x', courier: 'Mock Express', expected_delivery_date: '2026-11-30', current_status: state.trackStatus || 'In Transit', scan_detail: [{ scan_date_time: '2026-11-27 10:00', scan_status: 'In Transit', scan_location: 'Guwahati' }] });
        if (p === '/cancel-order') return ok1({ order_id: body.order_id });
      }
      out(404, { error: { description: 'not mocked: ' + url } });
    });
  });
  return new Promise((r) => srv.listen(port, () => r({ srv, state, sign: (secret, text) => crypto.createHmac('sha256', secret).update(text).digest('hex') })));
}
module.exports = { start };
if (require.main === module) start(Number(process.env.PORT) || 4010).then(() => console.log('mock gateways up'));