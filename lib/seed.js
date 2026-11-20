
'use strict';
const path = require('path');
const { hashPassword } = require('./util');
const products = require('./seed-products.json');

function seed(db) {
  const now = new Date().toISOString();
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@chaskatea.com').toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || 'Chaska@2026!';
  db.data.users.push({ id: db.id('users'), name: 'Store Admin', email: adminEmail, phone: '', passHash: hashPassword(adminPass), role: 'admin',
    mustChangePassword: !process.env.ADMIN_PASSWORD, addresses: [], wishlist: [], createdAt: now });
  const cats = [
    { slug: 'classic', name: 'Classic', blurb: 'Everyday kadak chai', color: '#E8A21A' },
    { slug: 'premium', name: 'Premium', blurb: 'Masala chai, ready to boil', color: '#C2501F' },
    { slug: 'supreme', name: 'Supreme', blurb: 'Strong dust tea for every kitchen', color: '#2F5D3A' },
    { slug: 'combo', name: 'Combos', blurb: 'Bundles that save more', color: '#2A1408' },
  ];
  cats.forEach((c, i) => db.data.categories.push(Object.assign({ id: db.id('categories'), sort: i, active: true }, c)));
  for (const p of products) {
    db.data.products.push(Object.assign({}, p, { category: p.category.toLowerCase(), createdAt: now, sold: 0 }));
    db.data.seq.products = Math.max(db.data.seq.products || 0, p.id);
  }
  const d = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  db.data.coupons.push(
    { id: db.id('coupons'), code: 'WELCOME10', description: '10% off your first order', type: 'percent', value: 10, maxDiscount: 100, minOrder: 300, usageLimit: 0, perUserLimit: 1, used: 0, paymentMode: 'any', active: true, expiresAt: d(365), createdAt: now },
    { id: db.id('coupons'), code: 'CHAI50', description: '₹50 off orders above ₹600', type: 'flat', value: 50, maxDiscount: 0, minOrder: 600, usageLimit: 0, perUserLimit: 0, used: 0, paymentMode: 'any', active: true, expiresAt: d(365), createdAt: now },
  );
  db.data.offers.push(
    { id: db.id('offers'), kind: 'banner', title: 'Diwali ka Chaska', subtitle: '₹10–₹30 off every pack when you pay online. Free delivery always.', cta: 'Shop all teas', link: '/shop', theme: 'marigold', active: true, sort: 0, createdAt: now },
    { id: db.id('offers'), kind: 'banner', title: 'Combos that save up to 61%', subtitle: 'Classic + Premium together, one box.', cta: 'See combos', link: '/shop?cat=combo', theme: 'terracotta', active: true, sort: 1, createdAt: now },
    { id: db.id('offers'), kind: 'strip', title: '🪔 Free delivery on every order · ₹10–₹30 off per pack on online payment · Cash on Delivery available', link: '/shop', active: true, sort: 0, createdAt: now },
  );
  const rv = [
    ['Hussain S.', 'Great taste. Awesome.'], ['Ramesh C.', 'Very tasty and exactly as described — full of flavour.'], ['Sushma K.', 'Yes, the taste is really very good.'],
    ['D. K. Verma', 'Tea is good in taste and colour.'], ['Shikha B.', 'Very good taste and colour.'], ['Tanveer H. Khan', 'Very good. Same kadak chai.'],
  ];
  rv.forEach(([n, t]) => db.data.reviews.push({ id: db.id('reviews'), name: n, text: t, rating: 5, source: 'Google review', active: true, createdAt: now }));
  db.flush();
  console.log('Seeded database. Admin login:', adminEmail, process.env.ADMIN_PASSWORD ? '(password from ADMIN_PASSWORD)' : '(default password, must be changed at first login)');
}
module.exports = { seed };
