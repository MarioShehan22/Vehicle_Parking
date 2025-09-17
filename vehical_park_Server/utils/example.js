const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { transporter, sendInvoiceEmail } = require('./mailer');

(async () => {
    console.log('SMTP config:', {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: process.env.SMTP_SECURE,
        user: process.env.SMTP_USER,
        hasPass: !!process.env.SMTP_PASS,
    });

    // Optional: verify connectivity/credentials before sending
    try {
        await transporter.verify();
        console.log('SMTP verified ✅');
    } catch (e) {
        console.error('SMTP verify failed ❌', e);
        process.exit(1);
    }

    const id = await sendInvoiceEmail({
        toEmail: 'marioshehan025@gmail.com',
        toName: 'Jane Customer',
        invoiceNumber: 'INV-2025-0012',
        total: 249.99,
        items: [{ description: 'Monthly Parking Pass', qty: 1, price: 199.99 }],
    });
    console.log('Invoice email sent:', id);
})();
