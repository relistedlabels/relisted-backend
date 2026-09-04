/**
 * One-off: resend renter checkout confirmation email for an order that predates
 * ORDER_CONFIRMATION notifications at checkout.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register resend-renter-order-confirmation.ts ORD-1788244993106-497
 *   npx ts-node -r tsconfig-paths/register resend-renter-order-confirmation.ts ORD-1788244993106-497 --dry-run
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { PrismaService } from './src/services/prisma/prisma.service';
import { MailService } from './src/services/mail/mail.service';

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

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const mail = app.get(MailService);

    const order = await prisma.order.findFirst({
      where: { orderId: orderIdArg.trim() },
      include: {
        user: { select: { id: true, email: true, name: true } },
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

    await mail.SendVerificationOrderMail(payload as never);
    console.log(`Done. Confirmation email sent to ${payload.email}.`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
