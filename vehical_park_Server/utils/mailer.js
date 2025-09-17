const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const nodemailer = require('nodemailer');

function req(name) {
    const v = process.env[name];
    if (!v) throw new Error(`Missing env ${name}`);
    return v;
}
const bool = v => ['1','true','yes','on'].includes(String(v||'').toLowerCase());
const num  = (v, d) => (Number.isFinite(+v) ? +v : d);

const transporter = nodemailer.createTransport({
    host: req('SMTP_HOST'),
    port: num(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE), // true for 465
    auth: {
        user: req('SMTP_USER'),
        pass: req('SMTP_PASS'),
    },
});

function formatMoneyLKR(n) {
    return new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' }).format(+n || 0);
}
function pad2(n){ return String(n).padStart(2,'0'); }
function formatDuration(ms){
    const totalMin = Math.max(0, Math.round(ms/60000));
    const h = Math.floor(totalMin/60);
    const m = totalMin%60;
    return `${pad2(h)}h ${pad2(m)}m`;
}
function round2(n){ return Math.round(n * 100) / 100; }
function escapeHtml(s=''){
    return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

/**
 * Send invoice with automatic charge from times + fixed rate.
 * If total/items are NOT provided but entry/exit/rate are, the function will compute them.
 *
 * @param {Object} opts
 * @param {string} opts.toEmail
 * @param {string} [opts.toName]
 * @param {string} opts.invoiceNumber
 * @param {Date|string|number} [opts.invoiceDate] defaults to exitTime
 * @param {number} [opts.total] optional override
 * @param {Array<{description:string, qty:number, price:number}>} [opts.items] optional override
 * @param {Date|string|number} [opts.entryTime]
 * @param {Date|string|number} [opts.exitTime]
 * @param {number} [opts.ratePerHour]  // in LKR
 * @param {string} [opts.replyTo]
 */
async function sendInvoiceEmail({
                                    toEmail,
                                    toName = '',
                                    invoiceNumber,
                                    invoiceDate,
                                    total,
                                    items,
                                    entryTime,
                                    exitTime,
                                    ratePerHour,
                                    replyTo,
                                }) {
    if (!toEmail) throw new Error('toEmail is required');
    if (!invoiceNumber) throw new Error('invoiceNumber is required');

    // If not provided, compute from times + rate
    let computed = null;
    if ((total == null || items == null) && entryTime && exitTime && ratePerHour != null) {
        const inAt  = new Date(entryTime);
        const outAt = new Date(exitTime);
        const ms    = Math.max(0, outAt - inAt);

        // Charge by the minute at a fixed hourly rate
        const perMin = (+ratePerHour) / 60;
        const minutes = Math.ceil(ms / 60000);               // round up to next minute
        const amount  = round2(minutes * perMin);

        computed = {
            safeEntry: inAt,
            safeExit:  outAt,
            minutes,
            duration:  formatDuration(ms),
            ratePerHour: +ratePerHour,
            amount,
            rows: [
                { description: 'Parking fee', qty: minutes, price: round2(perMin) } // LKR per minute
            ]
        };
    }

    const effectiveItems = items ?? (computed ? computed.rows : []);
    const effectiveTotal = (total != null) ? +total : (computed ? computed.amount : 0);

    const safeDate = new Date(invoiceDate || (computed?.safeExit ?? Date.now()));
    const dateText = safeDate.toLocaleString('en-LK');

    const lines = effectiveItems.map((it) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(it.description)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${it.qty}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatMoneyLKR(it.price)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${formatMoneyLKR(it.qty * it.price)}</td>
    </tr>`).join('');

    const extras = computed ? `
    <table style="margin:8px 0 16px 0">
      <tr><td style="padding-right:16px;color:#555">Check-in</td><td><strong>${computed.safeEntry.toLocaleString('en-LK')}</strong></td></tr>
      <tr><td style="padding-right:16px;color:#555">Check-out</td><td><strong>${computed.safeExit.toLocaleString('en-LK')}</strong></td></tr>
      <tr><td style="padding-right:16px;color:#555">Duration</td><td><strong>${computed.duration} (${computed.minutes} min)</strong></td></tr>
      <tr><td style="padding-right:16px;color:#555">Rate</td><td><strong>${formatMoneyLKR(computed.ratePerHour)}/hour</strong></td></tr>
    </table>` : '';

    const subject = `Invoice ${invoiceNumber} — ${formatMoneyLKR(effectiveTotal)}`;
    const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#222;background:#f7f7f8;padding:24px">
    <div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #eee;border-radius:10px;overflow:hidden">
      <div style="padding:16px 20px;background:#111827;color:#fff">
        <h2 style="margin:0;font-weight:600">Parking Invoice</h2>
      </div>
      <div style="padding:20px">
        <p style="margin:0 0 12px">Hi ${escapeHtml(toName || 'there')},</p>
        <p style="margin:0 0 16px">Thank you for using our parking. Your invoice details are below.</p>

        <table style="margin:8px 0 16px 0">
          <tr><td style="padding-right:16px;color:#555">Invoice #</td><td><strong>${escapeHtml(invoiceNumber)}</strong></td></tr>
          <tr><td style="padding-right:16px;color:#555">Date</td><td>${dateText}</td></tr>
          <tr><td style="padding-right:16px;color:#555">Total</td><td><strong>${formatMoneyLKR(effectiveTotal)}</strong></td></tr>
        </table>

        ${extras}

        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;border-bottom:2px solid #222">Description</th>
              <th style="text-align:center;padding:8px;border-bottom:2px solid #222">Qty</th>
              <th style="text-align:right;padding:8px;border-bottom:2px solid #222">Price</th>
              <th style="text-align:right;padding:8px;border-bottom:2px solid #222">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${lines || `<tr><td colspan="4" style="padding:12px;border-bottom:1px solid #eee;color:#888">No items</td></tr>`}
          </tbody>
        </table>

        <div style="margin-top:18px;padding-top:12px;border-top:1px dashed #ddd;text-align:right">
          <span style="color:#666;margin-right:10px">Total</span>
          <strong style="font-size:18px">${formatMoneyLKR(effectiveTotal)}</strong>
        </div>
      </div>
      <div style="padding:12px 20px;background:#fafafa;color:#6b7280;font-size:12px">
        If you have any questions, just reply to this email.
      </div>
    </div>
  </div>`.trim();

    const text = [
        `Invoice ${invoiceNumber}`,
        `Date: ${dateText}`,
        computed ? `Check-in: ${computed.safeEntry.toLocaleString('en-LK')}` : null,
        computed ? `Check-out: ${computed.safeExit.toLocaleString('en-LK')}` : null,
        computed ? `Duration: ${computed.duration} (${computed.minutes} min)` : null,
        computed ? `Rate: ${formatMoneyLKR(computed.ratePerHour)}/hour` : null,
        '',
        'Items:',
        ...effectiveItems.map(it => ` - ${it.description} x${it.qty} @ ${formatMoneyLKR(it.price)} = ${formatMoneyLKR(it.qty*it.price)}`),
        '',
        `Total: ${formatMoneyLKR(effectiveTotal)}`
    ].filter(Boolean).join('\n');

    const info = await transporter.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER, // Gmail often requires from == user
        to: toName ? `${toName} <${toEmail}>` : toEmail,
        subject,
        html,
        text,
        replyTo,
    });

    return info.messageId;
}

module.exports = { transporter, sendInvoiceEmail };
