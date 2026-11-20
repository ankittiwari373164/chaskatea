
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Tiny persistent JSON database: everything lives in memory, every write is flushed
// atomically (write temp file, then rename) so a crash never leaves a half-written file.
class DB {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'chaskatea-db.json');
    this.data = { seq: {}, users: [], sessions: [], products: [], categories: [], orders: [], payments: [],
      coupons: [], offers: [], messages: [], reviews: [], settings: {} };
    if (fs.existsSync(this.file)) {
      try { this.data = Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8'))); }
      catch (e) {
        const bad = this.file + '.corrupt-' + Date.now();
        fs.copyFileSync(this.file, bad);
        console.error('DB file unreadable, copied to', bad);
      }
    }
    this._t = null;
    // secret key for encrypting API keys at rest
    const kf = path.join(dir, 'secret.key');
    if (!fs.existsSync(kf)) fs.writeFileSync(kf, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    this.key = Buffer.from(fs.readFileSync(kf, 'utf8').trim(), 'hex');
  }
  get isNew() { return !this.data.users.length && !this.data.products.length; }
  id(name) { this.data.seq[name] = (this.data.seq[name] || 0) + 1; return this.data.seq[name]; }
  save() {
    if (this._t) return;
    this._t = setTimeout(() => { this._t = null; this.flush(); }, 120);
  }
  flush() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
  encrypt(text) {
    if (!text) return '';
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
    return 'enc:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
  }
  decrypt(blob) {
    if (!blob) return '';
    if (!String(blob).startsWith('enc:')) return String(blob);
    try {
      const b = Buffer.from(String(blob).slice(4), 'base64');
      const d = crypto.createDecipheriv('aes-256-gcm', this.key, b.subarray(0, 12));
      d.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
    } catch (e) { return ''; }
  }
}
module.exports = { DB };
