'use strict';
// Minimal SMTP sender (no npm packages) + ChaskaTea order email templates.
// Works with any mailbox that offers SMTP: Zoho, Google Workspace, Hostinger, GoDaddy, Titan, etc.
const net = require('net');
const tls = require('tls');

function smtpSend(cfg, msg) {
  const port = Number(cfg.port) || 465;
  const implicit = port === 465;
  return new Promise((resolve, reject) => {
    let sock, buf = '', waiter = null, done = false;
    const timer = setTimeout(() => fail(new Error('Mail server timed out')), 20000);
    function fail(e) { if (done) return; done = true; clearTimeout(timer); try { sock && sock.destroy(); } catch (_) {} reject(e); }
    function onData(d) {
      buf += d.toString('utf8');
      const lines = buf.split('\r\n'); if (lines.length < 2) return;
      // a reply is complete when a line has "NNN " (space after code)
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i])) {
          const reply = lines.slice(0, i + 1).join('\n'); buf = lines.slice(i + 1).join('\r\n');
          const w = waiter; waiter = null; if (w) w(reply); return;
        }
      }
    }
    const read = () => new Promise((res) => { waiter = res; if (buf.includes('\r\n')) onData(''); });
    async function cmd(line, ok) {
      if (line !== null) sock.write(line + '\r\n');
      const r = await read(); const code = parseInt(r.slice(0, 3), 10);
      if (!ok.includes(code)) throw new Error('SMTP ' + (line && line.startsWith('AUTH') ? 'login' : (line || 'greeting').split(' ')[0]) + ' failed: ' + r.replace(/\s+/g, ' ').slice(0, 160));
      return r;
    }
    function attach(s) { sock = s; sock.on('data', onData); sock.on('error', fail); }
    async function run() {
      try {
        await cmd(null, [220]);
        const host = (cfg.fromEmail.split('@')[1] || 'chaskatea.com').toLowerCase();
        let ehlo = await cmd('EHLO ' + host, [250]);
        if (!implicit && /STARTTLS/i.test(ehlo)) {
          await cmd('STARTTLS', [220]);
          sock.removeListener('data', onData);
          await new Promise((res, rej) => { const t = tls.connect({ socket: sock, servername: cfg.host }, res); t.on('error', rej); attach(t); });
          ehlo = await cmd('EHLO ' + host, [250]);
        }
        await cmd('AUTH LOGIN', [334]);
        await cmd(Buffer.from(cfg.user).toString('base64'), [334]);
        await cmd(Buffer.from(cfg.password).toString('base64'), [235]);
        await cmd(`MAIL FROM:<${cfg.fromEmail}>`, [250]);
        for (const r of msg.to.concat(msg.bcc || [])) await cmd(`RCPT TO:<${r}>`, [250, 251]);
        await cmd('DATA', [354]);
        sock.write(build(cfg, msg).replace(/(^|\r\n)\./g, '$1..') + '\r\n.\r\n');
        await cmd(null, [250]);
        try { sock.write('QUIT\r\n'); } catch (_) {}
        done = true; clearTimeout(timer); sock.end(); resolve(true);
      } catch (e) { fail(e); }
    }
    if (implicit) attach(tls.connect({ host: cfg.host, port, servername: cfg.host }, run));
    else attach(net.connect({ host: cfg.host, port }, run));
  });
}

function qp(str) {
  const bytes = Buffer.from(String(str).replace(/\r?\n/g, '\r\n'), 'utf8'); let out = '', line = '';
  const push = (t) => { if (line.length + t.length > 75) { out += line + '=\r\n'; line = ''; } line += t; };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 13 && bytes[i + 1] === 10) { if (/[ \t]$/.test(line)) { const c = line.slice(-1); line = line.slice(0, -1) + '=' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'); } out += line + '\r\n'; line = ''; i++; continue; }
    if ((b >= 33 && b <= 126 && b !== 61) || b === 32 || b === 9) push(String.fromCharCode(b));
    else push('=' + b.toString(16).toUpperCase().padStart(2, '0'));
  }
  return out + line;
}
const hdr = (s) => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + Buffer.from(s, 'utf8').toString('base64') + '?=';
function build(cfg, m) {
  const bnd = 'ct' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  const domain = (cfg.fromEmail.split('@')[1] || 'chaskatea.com');
  return [
    `From: ${hdr(cfg.fromName || 'ChaskaTea')} <${cfg.fromEmail}>`,
    `To: ${m.to.join(', ')}`,
    m.replyTo ? `Reply-To: ${m.replyTo}` : null,
    `Subject: ${hdr(m.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Language: en-IN',
    'X-Mailer: ChaskaTea Store',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${bnd}"`,
    '',
    `--${bnd}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: quoted-printable', '', qp(m.text || ''),
    `--${bnd}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: quoted-printable', '', qp(m.html || ''),
    `--${bnd}--`,
  ].filter((x) => x !== null).join('\r\n');
}

// ---------------- templates ----------------
const SITE = 'https://www.chaskatea.com';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inr = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const COPY = {
  placed: (o) => ['Order received: ' + o.number, 'Thank you for your order!', `We've received your order <b>${o.number}</b>. Please keep <b>${inr(o.total)}</b> ready to pay in cash on delivery. We'll email you again when it ships.`],
  confirmed: (o, paidNow) => [paidNow ? 'Payment received, order confirmed: ' + o.number : 'Order confirmed: ' + o.number, paidNow ? 'Payment received. Thank you!' : 'Your order is confirmed',
    paidNow ? `We've received your payment of <b>${inr(o.total)}</b> for order <b>${o.number}</b>. We're getting it ready and will email you when it ships.` : `Your order <b>${o.number}</b> is confirmed and being prepared for dispatch.`],
  shipped: (o) => ['Your ChaskaTea order has shipped: ' + o.number, 'Your tea is on its way!', `Order <b>${o.number}</b> has been handed to our courier partner${o.shiprocket && o.shiprocket.courier ? ' (' + esc(o.shiprocket.courier) + ')' : ''}.`],
  out_for_delivery: (o) => ['Out for delivery today: ' + o.number, 'Arriving today', `Your order <b>${o.number}</b> is out for delivery.${o.paymentMethod === 'cod' ? ` Please keep <b>${inr(o.total)}</b> ready in cash.` : ''}`],
  delivered: (o) => ['Delivered: ' + o.number, 'Enjoy your chai!', `Your order <b>${o.number}</b> has been delivered. We hope ChaskaTea brings a little happiness to every cup. If anything isn't right, just reply to this email.`],
  cancelled: (o) => ['Order cancelled: ' + o.number, 'Your order was cancelled', `Your order <b>${o.number}</b> has been cancelled.${o.paymentStatus === 'paid' || o.paymentStatus === 'refunded' ? ' If you paid online, any refund will go back to your original payment method.' : ''} If you have questions, just reply to this email.`],
  returned: (o) => ['Return processed: ' + o.number, 'Your return has been processed', `We've processed the return for order <b>${o.number}</b>. If a refund is due, it will be credited to your original payment method.`],
};

function orderEmail(o, status, store, opts = {}) {
  const c = COPY[status]; if (!c) return null;
  const [subject, title, intro] = c(o, opts.paidNow);
  const track = o.shiprocket && o.shiprocket.awb ? (SITE + '/track?n=' + encodeURIComponent(o.number)) : '';
  const rows = o.items.map((i) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(i.name)}${i.weight && !String(i.name).includes(i.weight) ? ' · ' + esc(i.weight) : ''} × ${i.qty}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #eee">${inr(i.price * i.qty)}</td></tr>`).join('');
  const line = (k, v, b) => v ? `<tr><td style="padding:4px 0;color:#666">${k}</td><td align="right" style="padding:4px 0${b ? ';font-weight:700;color:#2e1f7a;font-size:16px' : ''}">${v}</td></tr>` : '';
  const disc = (Number(o.discount) || 0) + (Number(o.offerDiscount) || 0) + (Number(o.prepaidDiscount) || 0);
  const a = o.address || {};
  const html = `<!doctype html><html><body style="margin:0;background:#f5eedf;font-family:Arial,Helvetica,sans-serif;color:#2a2550">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5eedf;padding:24px 12px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:14px;overflow:hidden">
<tr><td align="center" style="padding:22px;border-bottom:4px solid #a4e341"><img src="${SITE}/img/logo-full.png" width="170" alt="ChaskaTea" style="display:block"></td></tr>
<tr><td style="padding:28px 28px 8px"><h1 style="margin:0 0 10px;font-size:24px;color:#2e1f7a">${title}</h1><p style="margin:0;font-size:15px;line-height:1.6">Hi ${esc((a.name || '').split(' ')[0] || 'there')},<br>${intro}</p>
${track ? `<p style="margin:18px 0 0"><a href="${esc(track)}" style="background:#2e1f7a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:700;display:inline-block">Track your parcel</a></p><p style="font-size:12px;color:#888;margin:8px 0 0">AWB: ${esc(o.shiprocket.awb)}</p>` : ''}</td></tr>
<tr><td style="padding:18px 28px"><table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${rows}
${line('Subtotal', inr(o.subtotal))}${disc ? line('Discounts', '−' + inr(disc)) : ''}${line('Shipping', Number(o.shipping) ? inr(o.shipping) : 'Free')}${Number(o.codFee) ? line('COD fee', inr(o.codFee)) : ''}${line('Total', inr(o.total), 1)}
${line('Payment', o.paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online')}</table></td></tr>
<tr><td style="padding:0 28px 22px;font-size:13px;color:#555;line-height:1.5"><b style="color:#2e1f7a">Delivering to</b><br>${esc(a.name)}<br>${esc(a.line1)}${a.line2 ? ', ' + esc(a.line2) : ''}<br>${esc(a.city)}${a.state ? ', ' + esc(a.state) : ''} ${esc(a.pincode)}<br>${esc(a.phone)}</td></tr>
<tr><td align="center" style="padding:0 28px 26px"><a href="${SITE}/track?n=${encodeURIComponent(o.number)}" style="color:#4e8a16;font-weight:700;font-size:14px">View order status</a></td></tr>
<tr><td style="background:#2e1f7a;color:#d9d4f0;padding:18px 28px;font-size:12px;line-height:1.6" align="center">Questions? Reply to this email or WhatsApp us${store.whatsapp ? ' on +' + esc(store.whatsapp) : ''}.<br><a href="${SITE}" style="color:#c8f27c">www.chaskatea.com</a> · ChaskaTea – Taste of Happiness</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${title}\n\n${intro.replace(/<[^>]+>/g, '')}\n${track ? '\nTrack: ' + track + '\n' : ''}\nItems:\n${o.items.map((i) => `- ${i.name} x ${i.qty}: ${inr(i.price * i.qty)}`).join('\n')}\nTotal: ${inr(o.total)}\n\nOrder status: ${SITE}/track?n=${o.number}\n\nChaskaTea – Taste of Happiness\n${SITE}`;
  return { subject, html, text };
}

function adminEmail(o) {
  const a = o.address || {};
  const subject = `New order ${o.number} · ${inr(o.total)} · ${o.paymentMethod === 'cod' ? 'COD' : 'Paid online'}`;
  const text = `New order ${o.number}\n${a.name}, ${a.phone}, ${o.email}\n${a.line1} ${a.line2 || ''}, ${a.city} ${a.state || ''} ${a.pincode}\n\n${o.items.map((i) => `- ${i.name} x ${i.qty}`).join('\n')}\nTotal: ${inr(o.total)} (${o.paymentMethod})\n\n${SITE}/admin#orders`;
  return { subject, text, html: '<pre style="font:14px/1.5 Arial,sans-serif">' + esc(text) + '</pre>' };
}

function testEmail(cfg) {
  const subject = 'ChaskaTea email setup is working';
  const text = `Hello,\n\nThis is a confirmation from your ChaskaTea online store at ${SITE}.\n\nYour store can now send order emails from ${cfg.fromEmail}. Customers will receive an email when they place an order, when it ships with a tracking link, and when it is delivered.\n\nYou will also receive a copy of every new order at this address.\n\nRegards,\nChaskaTea – Taste of Happiness\n${SITE}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5eedf;font-family:Arial,Helvetica,sans-serif;color:#2a2550"><table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center"><table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:14px"><tr><td style="padding:28px;font-size:15px;line-height:1.6"><h1 style="margin:0 0 12px;font-size:22px;color:#2e1f7a">Your email setup is working</h1><p>Hello,</p><p>This is a confirmation from your ChaskaTea online store at <a href="${SITE}" style="color:#4e8a16">www.chaskatea.com</a>.</p><p>Your store can now send order emails from <b>${esc(cfg.fromEmail)}</b>. Customers will receive an email when they place an order, when it ships with a tracking link, and when it is delivered.</p><p>You will also receive a copy of every new order at this address.</p><p>Regards,<br>ChaskaTea – Taste of Happiness</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

module.exports = { smtpSend, orderEmail, adminEmail, testEmail };