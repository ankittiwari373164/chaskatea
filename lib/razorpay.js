
'use strict';
const crypto = require('crypto');
const { safeEq } = require('./util');

const BASE = () => process.env.RAZORPAY_BASE || 'https://api.razorpay.com';

async function call(cfg, method, path, body) {
  const auth = Buffer.from(cfg.keyId + ':' + cfg.keySecret).toString('base64');
  const res = await fetch(BASE() + path, {
    method,
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  if (!res.ok) {
    const msg = (json && json.error && json.error.description) || ('Razorpay error ' + res.status);
    const err = new Error(msg); err.status = res.status; err.body = json; throw err;
  }
  return json;
}

// amount in rupees -> Razorpay order (paise)
const createOrder = (cfg, { amount, receipt, notes }) =>
  call(cfg, 'POST', '/v1/orders', { amount: Math.round(amount * 100), currency: 'INR', receipt, notes: notes || {} });

const verifyPayment = (secret, orderId, paymentId, signature) => {
  const expected = crypto.createHmac('sha256', secret).update(orderId + '|' + paymentId).digest('hex');
  return safeEq(expected, signature || '');
};
const verifyWebhook = (secret, rawBody, signature) => {
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEq(expected, signature);
};
const refund = (cfg, paymentId, amountRupees, notes) =>
  call(cfg, 'POST', `/v1/payments/${encodeURIComponent(paymentId)}/refund`, { amount: Math.round(amountRupees * 100), notes: notes || {} });
const fetchPayment = (cfg, paymentId) => call(cfg, 'GET', `/v1/payments/${encodeURIComponent(paymentId)}`);
const testCredentials = (cfg) => call(cfg, 'GET', '/v1/orders?count=1');

module.exports = { createOrder, verifyPayment, verifyWebhook, refund, fetchPayment, testCredentials };
