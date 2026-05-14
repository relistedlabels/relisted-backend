import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { join } from 'path';
import { PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY } from './utils/product-attachment-upload-order';

dotenv.config({ path: join(process.cwd(), '.env') });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL missing');

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const order = await prisma.order.findFirst({
    include: {
      orderListers: true,
      orderItems: {
        include: {
          product: {
            include: {
              attachments: {
                include: {
                  uploads: { orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY },
                },
              },
              tags: true,
              curator: {
                include: { profile: { include: { avatarUpload: true } } },
              },
            },
          },
        },
      },
      rentals: true,
      user: { include: { profile: { include: { address: true } } } },
    },
  });

  if (!order) {
    console.log('No orders found in database.');
    return;
  }

  const typedOrder = order as any;
  const totalAmount =
    typedOrder.totalAmountPaid ||
    typedOrder.rentals?.[0]?.totalAmount ||
    typedOrder.orderItems.reduce(
      (sum: number, item: any) => sum + item.pricePerDay * item.days,
      0,
    );

  const finalResponse = {
    orderId: typedOrder.orderId,
    status: typedOrder.status,
    items: typedOrder.orderItems.map((i: any) => ({
      id: i.product?.id || i.productId,
      name: i.product?.name || 'Unknown',
      price: i.pricePerDay,
      quantity: i.days,
      imageUrl:
        i.imageUrl ||
        i.product?.attachments?.uploads?.[0]?.url ||
        i.product?.images?.[0] ||
        null,
    })),
    lister: {
      userId:
        (typedOrder.orderListers && typedOrder.orderListers[0]?.listerId) ||
        typedOrder.orderItems?.[0]?.product?.curator?.id,
      businessName:
        typedOrder.listerBusinessName ||
        typedOrder.orderItems?.[0]?.product?.curator?.name,
      imageUrl:
        typedOrder.listerImage ||
        typedOrder.orderItems?.[0]?.product?.curator?.profile?.avatarUpload
          ?.url ||
        null,
    },
  };

  console.log('REAL ORDER DATA SNAPSHOT:');
  console.log(JSON.stringify(finalResponse, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
