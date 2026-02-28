const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany({ where: { role: 'LISTER' } });
    if (users.length === 0) {
        console.log('No listers found');
        return;
    }
    const lister = users[0];
    console.log(`Checking orders for lister: ${lister.email} (id: ${lister.id})`);

    const orderItems = await prisma.orderItem.findMany({
        where: { product: { curatorId: lister.id } },
        include: { product: true, order: true }
    });

    console.log(`Found ${orderItems.length} order items for this lister products`);
    if (orderItems.length > 0) {
        console.log('Sample orderItem:', orderItems[0]);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
