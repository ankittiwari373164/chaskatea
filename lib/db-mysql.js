'use strict';
// Remote database for serverless hosting (Vercel). Same interface as lib/db.js, but the whole store lives as one JSON
// document in a MySQL table. Write requests take a MySQL lock so two orders at the same moment can't overwrite each other.
// Uploaded product photos are stored in a second table. Needs: DB_HOST, DB_NAME, DB_USER, DB_PASS, SECRET_KEY.
const crypto = require('crypto');

const LOCK = 'chaskatea_store_lock';

class RemoteDB {
  constructor() {
    const e = process.env;
    if (!e.DB_HOST || !e.DB_NAME) throw new Error('Set DB_HOST, DB_NAME, DB_USER and DB_PASS environment variables.');
    if (!e.SECRET_KEY || e.SECRET_KEY.length < 16) throw new Error('Set SECRET_KEY (any random string of 32+ characters) in the environment variables.');
    const mysql = require('mysql2/promise');
    this.pool = mysql.createPool({
      host: e.DB_HOST, port: Number(e.DB_PORT || 3306), user: e.DB_USER, password: e.DB_PASS ?? e.DB_PASSWORD, database: e.DB_NAME,
      waitForConnections: true, connectionLimit: Number(e.DB_POOL || 3), charset: 'utf8mb4', connectTimeout: 10000,
      ssl: String(e.DB_SSL || 'false') === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
    });
    this.remote = true;
    this.key = crypto.createHash('sha256').update(String(e.SECRET_KEY)).digest(); // encrypts the API keys saved from Admin → Settings
    this.data = RemoteDB.empty();
    this.version = -1; this.dirty = false; this.conn = null; this.writing = false; this._ready = null;
  }
  static empty() {
    return { seq: {}, users: [], sessions: [], products: [], categories: [], orders: [], payments: [], coupons: [], offers: [], messages: [], reviews: [], settings: {} };
  }
  get isNew() { return !this.data.users.length && !this.data.products.length; }
  id(name) { this.data.seq[name] = (this.data.seq[name] || 0) + 1; return this.data.seq[name]; }
  save() { this.dirty = true; }
  flush() { this.dirty = true; }
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

  _setup() {
    return (this._ready ||= (async () => {
      await this.pool.query('CREATE TABLE IF NOT EXISTS ct_state (id INT PRIMARY KEY, version INT NOT NULL DEFAULT 0, doc LONGTEXT) DEFAULT CHARSET=utf8mb4');
      await this.pool.query('CREATE TABLE IF NOT EXISTS ct_uploads (k VARCHAR(120) PRIMARY KEY, mime VARCHAR(60), data LONGBLOB) DEFAULT CHARSET=utf8mb4');
      await this.pool.query('INSERT IGNORE INTO ct_state (id, version, doc) VALUES (1, 0, NULL)');
    })().catch((e) => { this._ready = null; throw e; }));
  }

  // Start of an API request. write=true takes the lock so writers run one at a time.
  async begin(write) {
    await this._setup();
    this.dirty = false; this.writing = !!write;
    const q = write ? await this._lock() : this.pool;
    const [[row]] = await q.query('SELECT version FROM ct_state WHERE id = 1');
    if (row.version !== this.version) {
      const [[full]] = await q.query('SELECT version, doc FROM ct_state WHERE id = 1');
      this.data = Object.assign(RemoteDB.empty(), full.doc ? JSON.parse(full.doc) : {});
      this.version = full.version;
    }
  }
  async _lock() {
    const conn = await this.pool.getConnection();
    try {
      const [[r]] = await conn.query('SELECT GET_LOCK(?, 20) AS l', [LOCK]);
      if (r.l !== 1) { const e = new Error('The store is busy, please try again.'); e.status = 503; throw e; }
    } catch (e) { conn.release(); throw e; }
    this.conn = conn;
    return conn;
  }
  // End of an API request: save changes (if any) and release the lock. Safe to call more than once.
  async end() {
    const conn = this.conn; this.conn = null;
    try {
      if (!this.dirty) return;
      this.dirty = false;
      const doc = JSON.stringify(this.data);
      if (conn) {
        await conn.query('UPDATE ct_state SET doc = ?, version = version + 1 WHERE id = 1', [doc]);
        const [[r]] = await conn.query('SELECT version FROM ct_state WHERE id = 1');
        this.version = r.version;
      } else {
        // read-only request that changed something: only save if nobody else wrote in the meantime
        const [res] = await this.pool.query('UPDATE ct_state SET doc = ?, version = version + 1 WHERE id = 1 AND version = ?', [doc, this.version]);
        if (res.affectedRows) this.version += 1; else this.version = -1;
      }
    } catch (e) { this.version = -1; throw e; }
    finally {
      if (conn) { try { await conn.query('DO RELEASE_LOCK(?)', [LOCK]); } catch (_) {} conn.release(); }
    }
  }

  async putUpload(name, buf, mime) {
    await this._setup();
    await this.pool.query('REPLACE INTO ct_uploads (k, mime, data) VALUES (?,?,?)', [name, mime, buf]);
  }
  async getUpload(name) {
    await this._setup();
    const [[r]] = await this.pool.query('SELECT mime, data FROM ct_uploads WHERE k = ?', [name]);
    return r || null;
  }
}
module.exports = { RemoteDB };
