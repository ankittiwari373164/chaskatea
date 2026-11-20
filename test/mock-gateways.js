
'use strict';
// Tiny stand-ins for Razorpay and Shiprocket so the integration code can be exercised without real accounts.
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
      // ---- Shiprocket ----
      if (url === '/v1/external/auth/login') return body.email === 'api@shop.test' && body.password === 'srpass' ? out(200, { token: 'SRTOKEN123' }) : out(403, { message: 'Invalid email and password combination' });
      if (url.startsWith('/v1/external/')) {
        if (req.headers.authorization !== 'Bearer SRTOKEN123') return out(401, { message: 'Unauthenticated.' });
        if (url === '/v1/external/orders/create/adhoc') {
          for (const f of ['order_id', 'billing_pincode', 'billing_phone', 'order_items', 'payment_method', 'weight', 'pickup_location']) if (!body[f]) return out(422, { message: 'The ' + f + ' field is required.' });
          const sid = 9000 + Object.keys(state.shipments).length; state.shipments[sid] = body; return out(200, { order_id: 5000 + sid, shipment_id: sid, status: 'NEW', status_code: 1 });
        }
        if (url === '/v1/external/courier/assign/awb') return out(200, { awb_assign_status: 1, response: { data: { awb_code: 'MOCKAWB' + body.shipment_id, courier_name: 'Mock Express', courier_company_id: 7 } } });
        if (url === '/v1/external/courier/generate/pickup') return out(200, { pickup_status: 1 });
        if (url === '/v1/external/courier/generate/label') return out(200, { label_created: 1, label_url: 'https://example.test/label.pdf' });
        if (url.startsWith('/v1/external/courier/track/awb/')) return out(200, { tracking_data: { track_status: 1, shipment_track: [{ current_status: state.trackStatus || 'IN TRANSIT' }], shipment_track_activities: [{ date: '2026-11-05', activity: 'In transit', location: 'Guwahati' }], track_url: 'https://shiprocket.co/tracking/' + url.split('/').pop(), etd: '2026-11-08' } });
        if (url === '/v1/external/orders/cancel') return out(200, { message: 'Order cancelled successfully.' });
      }
      out(404, { error: { description: 'not mocked: ' + url } });
    });
  });
  return new Promise((r) => srv.listen(port, () => r({ srv, state, sign: (secret, text) => crypto.createHmac('sha256', secret).update(text).digest('hex') })));
}
module.exports = { start };
if (require.main === module) start(Number(process.env.PORT) || 4010).then(() => console.log('mock gateways up'));
