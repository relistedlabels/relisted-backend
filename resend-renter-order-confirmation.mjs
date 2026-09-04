/**
 * Minimal memory resend script (~few MB). Use this on small prod instances.
 *
 *   node resend-renter-order-confirmation.mjs ORD-1788244993106-497 --dry-run
 *   node resend-renter-order-confirmation.mjs ORD-1788244993106-497
 *
 * Requires: DATABASE_URL, RESEND_API_KEY (and optionally MAIL_DEFAULT, CLIENT_URL)
 */
import pg from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function loadEnvFile() {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildConfirmOrderHtml({ customerName, orderId, totalAmount, orderLink }) {
  const name = escapeHtml(customerName);
  const id = escapeHtml(orderId);
  const total = escapeHtml(Number(totalAmount).toLocaleString('en-NG'));
  const link = escapeHtml(orderLink);
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Order Confirmed</title></head>
<body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;">
  <div style="max-width:600px;margin:0 auto;padding:20px;border:1px solid #ddd;border-radius:8px;">
    <h2>Hello ${name},</h2>
    <p>Your order has been confirmed successfully!</p>
    <p><strong>Order ID:</strong> ${id}</p>
    <p><strong>Total Amount:</strong> ₦${total}</p>
    <div style="background:#f8f9fa;padding:15px;border-radius:5px;margin:15px 0;border-left:4px solid #1d72b8;">
      <p><strong>Shipping information</strong></p>
      <p>Your tracking link will be sent to you on your rental start date. You will be able to track your shipment in real time once it is dispatched.</p>
    </div>
    <p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#1d72b8;color:#fff;text-decoration:none;border-radius:5px;">View order</a></p>
    <p>You can view your order details and track its status in your account dashboard.</p>
    <p>Thanks,<br>The Relisted Team</p>
  </div>
</body>
</html>`;
}

async function sendViaResend(to, subject, html) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error('RESEND_API_KEY is not set.');
  const from =
    process.env.MAIL_DEFAULT?.trim() || 'Relisted <onboarding@resend.dev>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body}`);
  }
}

async function main() {
  loadEnvFile();

  const args = process.argv.slice(2).filter((a) => a !== '--');
  const dryRun = args.includes('--dry-run');
  const orderIdArg = args.find((a) => !a.startsWith('-'));

  if (!orderIdArg?.trim()) {
    console.error(
      'Usage: node resend-renter-order-confirmation.mjs <orderId> [--dry-run]',
    );
    process.exit(1);
  }

  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error('DATABASE_URL is not set.');
  }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
  });

  try {
    const { rows } = await pool.query(
      `SELECT o."orderId", o."totalAmountPaid", u.email, u.name
       FROM "Order" o
       JOIN "User" u ON u.id = o."userId"
       WHERE o."orderId" = $1
       LIMIT 1`,
      [orderIdArg.trim()],
    );

    const row = rows[0];
    if (!row) {
      console.error(`Order not found: ${orderIdArg}`);
      process.exit(1);
    }
    if (!row.email?.trim()) {
      console.error(`Order ${row.orderId} has no renter email.`);
      process.exit(1);
    }

    const clientBase = (process.env.CLIENT_URL || 'https://relisted.com').replace(
      /\/$/,
      '',
    );
    const payload = {
      email: row.email.trim(),
      customerName: row.name || 'Customer',
      orderId: row.orderId,
      totalAmount: row.totalAmountPaid,
      orderLink: `${clientBase}/renters/orders/${row.orderId}`,
    };

    console.log(
      dryRun ? '[dry-run] Would send to:' : 'Sending to:',
      payload.email,
    );
    console.log(JSON.stringify(payload, null, 2));

    if (dryRun) return;

    const html = buildConfirmOrderHtml(payload);
    await sendViaResend(
      payload.email,
      'Your Relisted order confirmation',
      html,
    );
    console.log(`Done. Confirmation email sent to ${payload.email}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
