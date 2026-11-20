// Vercel entry: every /api/* and /uploads/* request is handled by the store's normal request handler.
module.exports = require('../lib/app').handler;
