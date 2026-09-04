/**
 * Minimal memory resend script (~few MB). Run on your laptop with prod env vars.
 *
 * Email HTML is rendered from src/services/mail/templates/confirm-order.hbs
 * (same template production uses). Only order line data is built in this script.
 *
 *   node resend-renter-order-confirmation.mjs ORD-1788244993106-497 --dry-run
 *   RESEND_TO_OVERRIDE=you@gmail.com node resend-renter-order-confirmation.mjs ORD-xxx
 *
 * Requires: DATABASE_URL, RESEND_API_KEY (and optionally MAIL_DEFAULT, CLIENT_URL)
 */
import pg from 'pg';
import Handlebars from 'handlebars';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const LAGOS = 'Africa/Lagos';

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


function formatEmailTimeCompact(input) {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return d
    .toLocaleTimeString('en-GB', {
      timeZone: LAGOS,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .replace(':00', '')
    .replace(/\s/g, '')
    .toLowerCase();
}

function lagosCalendarKey(d) {
  return d.toLocaleDateString('en-CA', { timeZone: LAGOS });
}

function formatOrdinalDay(day) {
  const n = Math.abs(Math.trunc(day));
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function lagosDayMonth(d) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: LAGOS,
    day: 'numeric',
    month: 'long',
  }).formatToParts(d);
  const day = Number(parts.find((p) => p.type === 'day')?.value ?? 0);
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  return { day, month, dayLabel: formatOrdinalDay(day) };
}

function formatRentalPeriodCompact(start, end) {
  if (!start || !end) return '';
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '';
  if (lagosCalendarKey(s) === lagosCalendarKey(e)) {
    const one = lagosDayMonth(s);
    return `${one.dayLabel} ${one.month}`;
  }
  const sp = lagosDayMonth(s);
  const ep = lagosDayMonth(e);
  if (sp.month === ep.month) {
    return `${sp.dayLabel}–${ep.dayLabel} ${sp.month}`;
  }
  return `${sp.dayLabel} ${sp.month} – ${ep.dayLabel} ${ep.month}`;
}

function formatWindow(start, end) {
  if (!start || !end) return null;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const startTime = formatEmailTimeCompact(s);
  const endTime = formatEmailTimeCompact(e);
  if (lagosCalendarKey(s) === lagosCalendarKey(e)) {
    const { dayLabel, month } = lagosDayMonth(s);
    return `${dayLabel} ${month}, ${startTime}–${endTime} WAT`;
  }
  const sp = lagosDayMonth(s);
  const ep = lagosDayMonth(e);
  return `${sp.dayLabel} ${sp.month} ${startTime} – ${ep.dayLabel} ${ep.month} ${endTime} WAT`;
}

function buildOrderLines(rows) {
  return rows.map((row) => {
    const productName = row.product_name || 'Item';
    const listingType = row.listing_type;
    const days = row.days ?? 0;
    const isRental =
      days > 0 &&
      (listingType === 'RENTAL' || listingType === 'RENT_OR_RESALE');
    const isPurchase =
      listingType === 'RESALE' ||
      (listingType === 'RENT_OR_RESALE' && days === 0);

    if (isRental) {
      const rentalPeriodText =
        row.rental_start && row.rental_end
          ? formatRentalPeriodCompact(row.rental_start, row.rental_end)
          : null;
      return {
        productName,
        imageUrl: row.image_url || null,
        lineType: 'rental',
        days: row.rental_days ?? days,
        rentalPeriodText,
        rentalDeliveryWindowText: formatWindow(
          row.outbound_start,
          row.outbound_end,
        ),
        returnPickupWindowText: formatWindow(row.return_start, row.return_end),
      };
    }

    if (isPurchase) {
      return {
        productName,
        imageUrl: row.image_url || null,
        lineType: 'purchase',
        purchaseDeliveryWindowText: formatWindow(
          row.resale_start,
          row.resale_end,
        ),
      };
    }

    return { productName, imageUrl: row.image_url || null, lineType: 'purchase' };
  });
}

function renderConfirmOrderHtml(context) {
  const templatePath = join(
    process.cwd(),
    'src/services/mail/templates/confirm-order.hbs',
  );
  const templateSource = readFileSync(templatePath, 'utf8');
  Handlebars.registerHelper('eq', (a, b) => a === b);
  Handlebars.registerHelper('gt', (a, b) => Number(a) > Number(b));
  return Handlebars.compile(templateSource)(context);
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
    const orderRes = await pool.query(
      `SELECT o."orderId", o."totalAmountPaid", u.email, u.name
       FROM "Order" o
       JOIN "User" u ON u.id = o."userId"
       WHERE o."orderId" = $1
       LIMIT 1`,
      [orderIdArg.trim()],
    );

    const row = orderRes.rows[0];
    if (!row) {
      console.error(`Order not found: ${orderIdArg}`);
      process.exit(1);
    }
    if (!row.email?.trim()) {
      console.error(`Order ${row.orderId} has no renter email.`);
      process.exit(1);
    }

    const linesRes = await pool.query(
      `SELECT
         p.name AS product_name,
         p."listingType" AS listing_type,
         oi.days,
         oi."imageUrl" AS image_url,
         r.days AS rental_days,
         r."startDate" AS rental_start,
         r."endDate" AS rental_end,
         ob."scheduledWindowStart" AS outbound_start,
         ob."scheduledWindowEnd" AS outbound_end,
         ret."scheduledWindowStart" AS return_start,
         ret."scheduledWindowEnd" AS return_end,
         rs."scheduledWindowStart" AS resale_start,
         rs."scheduledWindowEnd" AS resale_end
       FROM "OrderItem" oi
       JOIN "Order" o ON o.id = oi."orderId"
       JOIN "Product" p ON p.id = oi."productId"
       LEFT JOIN "Rental" r ON r."orderId" = o.id AND r."productId" = oi."productId"
       LEFT JOIN "Shipment" ob ON ob.id = oi."outboundShipmentId"
       LEFT JOIN "Shipment" ret ON ret.id = oi."returnShipmentId"
       LEFT JOIN "Shipment" rs ON rs.id = oi."resaleShipmentId"
       WHERE o."orderId" = $1
       ORDER BY oi."id"`,
      [orderIdArg.trim()],
    );

    const clientBase = (process.env.CLIENT_URL || 'https://relisted.com').replace(
      /\/$/,
      '',
    );
    const orderLines = buildOrderLines(linesRes.rows);
    const recipient =
      process.env.RESEND_TO_OVERRIDE?.trim() || row.email.trim();
    const payload = {
      email: recipient,
      renterEmail: row.email.trim(),
      customerName: row.name || 'Customer',
      orderId: row.orderId,
      totalAmount: row.totalAmountPaid,
      orderLink: `${clientBase}/renters/orders/${row.orderId}`,
      orderLines,
    };

    console.log(
      dryRun ? '[dry-run] Would send confirm-order to:' : 'Sending confirm-order to:',
      recipient,
    );
    if (recipient !== row.email.trim()) {
      console.log(`(renter on order: ${row.email.trim()})`);
    }
    console.log(JSON.stringify(payload, null, 2));

    const html = renderConfirmOrderHtml({
      customerName: payload.customerName,
      orderId: payload.orderId,
      totalAmount: Number(payload.totalAmount).toLocaleString('en-NG'),
      orderLink: payload.orderLink,
      orderLines: payload.orderLines,
      hasOrderLines: payload.orderLines.length > 0,
    });

    if (dryRun) {
      const previewDir = join(process.cwd(), 'dev-emails');
      if (!existsSync(previewDir)) mkdirSync(previewDir, { recursive: true });
      const previewPath = join(
        previewDir,
        `renter-confirm-${payload.orderId}-preview.html`,
      );
      writeFileSync(previewPath, html);
      console.log(`[dry-run] Preview saved to ${previewPath}`);
      console.log(
        html.includes('Thanks')
          ? '[dry-run] Sign-off present in rendered template.'
          : '[dry-run] WARNING: sign-off missing from rendered template.',
      );
      return;
    }

    await sendViaResend(
      recipient,
      'Your Relisted order confirmation',
      html,
    );
    console.log(`Done. Confirmation email sent to ${recipient}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
