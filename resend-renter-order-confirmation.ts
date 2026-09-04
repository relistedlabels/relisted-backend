/**
 * Lightweight one-off: resend renter checkout confirmation (no Nest bootstrap).
 *
 * Do NOT use NestFactory here — booting AppModule OOMs small prod instances (~512MB).
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register resend-renter-order-confirmation.ts ORD-1788244993106-497
 *   npx ts-node -r tsconfig-paths/register resend-renter-order-confirmation.ts ORD-1788244993106-497 --dry-run
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { join } from 'path';
import { readFile, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import Handlebars from 'handlebars';
import { Resend } from 'resend';

dotenv.config({ path: join(process.cwd(), '.env') });

Handlebars.registerHelper('eq', (v1, v2) => v1 === v2);
Handlebars.registerHelper('gt', (a: unknown, b: unknown) => Number(a) > Number(b));

const CONFIRM_ORDER_SUBJECT = 'Your Relisted order confirmation';

async function renderConfirmOrder(
  context: Record<string, unknown>,
): Promise<string> {
  const templatePath = join(
    process.cwd(),
    'src/services/mail/templates/confirm-order.hbs',
  );
  const content = await readFile(templatePath, 'utf-8');
  return Handlebars.compile(content)(context);
}

async function sendConfirmOrderEmail(
  to: string,
  html: string,
): Promise<void> {
  const devBypass = process.env.DEV_EMAIL_BYPASS === 'true';
  if (devBypass) {
    const dir = join(process.cwd(), 'dev-emails');
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    const filepath = join(dir, `confirm-order-${Date.now()}.html`);
    await writeFile(filepath, html);
    console.log(`[DEV EMAIL BYPASS] Saved to ${filepath}`);
    return;
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set.');
  }
  const from =
    process.env.MAIL_DEFAULT?.trim() || 'Relisted <onboarding@resend.dev>';
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    subject: CONFIRM_ORDER_SUBJECT,
    html,
  });
  if (error) {
    throw new Error(error.message);
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const dryRun = args.includes('--dry-run');
  const orderIdArg = args.find((a) => !a.startsWith('-'));

  if (!orderIdArg?.trim()) {
    console.error(
      'Usage: resend-renter-order-confirmation.ts <orderId> [--dry-run]',
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const order = await prisma.order.findFirst({
      where: { orderId: orderIdArg.trim() },
      include: {
        user: { select: { email: true, name: true } },
      },
    });

    if (!order) {
      console.error(`Order not found: ${orderIdArg}`);
      process.exit(1);
    }

    if (!order.user?.email?.trim()) {
      console.error(`Order ${order.orderId} has no renter email.`);
      process.exit(1);
    }

    const clientBase = (process.env.CLIENT_URL || 'https://relisted.com').replace(
      /\/$/,
      '',
    );
    const payload = {
      email: order.user.email.trim(),
      customerName: order.user.name || 'Customer',
      orderId: order.orderId,
      totalAmount: order.totalAmountPaid,
      platformName: 'Relisted',
      orderLink: `${clientBase}/renters/orders/${order.orderId}`,
    };

    console.log(
      dryRun ? '[dry-run] Would send confirm-order to:' : 'Sending confirm-order to:',
      payload.email,
    );
    console.log(JSON.stringify(payload, null, 2));

    if (dryRun) {
      return;
    }

    const html = await renderConfirmOrder(payload);
    await sendConfirmOrderEmail(payload.email, html);
    console.log(`Done. Confirmation email sent to ${payload.email}.`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
