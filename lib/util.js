
'use strict';
const crypto = require('crypto');

const hashPassword = (pw) => {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return 's1$' + salt.toString('hex') + '$' + h.toString('hex');
};
const checkPassword = (pw, stored) => {
  try {
    const [v, s, h] = String(stored).split('$');
    if (v !== 's1') return false;
    const hh = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
    return crypto.timingSafeEqual(hh, Buffer.from(h, 'hex'));
  } catch (e) { return false; }
};
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const token = (n = 32) => crypto.randomBytes(n).toString('hex');
const safeEq = (a, b) => {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
const money = (n) => Math.round((Number(n) || 0) * 100) / 100;
const slugify = (s) => String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const clean = (s, max = 500) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s || '');
const normPhone = (p) => String(p || '').replace(/[^\d+]/g, '').replace(/^\+?91(?=\d{10}$)/, '');
const isPhone = (p) => /^[6-9]\d{9}$/.test(normPhone(p));
const isPin = (p) => /^\d{6}$/.test(String(p || '').trim());
module.exports = { hashPassword, checkPassword, sha, token, safeEq, money, slugify, clean, isEmail, normPhone, isPhone, isPin };
