import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { OrderService } from './src/module/order/order.service';
import { RentersService } from './src/module/renters/renters.service';
import { PrismaService } from './src/services/prisma/prisma.service';

async function testOrderPersistence() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const orderService = app.get(OrderService);
  const rentersService = app.get(RentersService);
  const prisma = app.get(PrismaService);

  try {
    console.log('--- Step 1: Finding/Setting up User with Cart ---');
    let userWithCart = await prisma.user.findFirst({
      where: {
        cart: { items: { some: {} } },
        profile: { address: { isNot: null } },
        wallet: { isNot: null }
      },
      include: {
        cart: { include: { items: { include: { product: { include: { curator: true } } } } } },
        profile: { include: { address: true } },
        wallet: true
      }
    });
    
    if (!userWithCart) {
        console.log('No user with cart found. Setting up a new cart...');
        const user = await prisma.user.findFirst({ include: { cart: true, profile: { include: { address: true } } } });
        const product = await prisma.product.findFirst({ where: { curatorId: { not: user?.id }, isActive: true } });
        
        if (user && product) {
            console.log(`Setting up user ${user.id} and product ${product.id}`);
            
            // Ensure profile exists
            if (!user.profile) {
                console.log('User has no profile. Creating one...');
                await prisma.profile.create({
                    data: {
                        userId: user.id,
                        phoneNumber: '08012345678'
                    }
                });
            }
            
            const profile = await prisma.profile.findUnique({ where: { userId: user.id }, include: { address: true } });

            if (!user.cart) await prisma.cart.create({ data: { userId: user.id } });
            const cart = await prisma.cart.findUnique({ where: { userId: user.id } });
            await prisma.cartItem.create({ data: { cartId: cart!.id, productId: product.id, days: 3 } });

            // Ensure address exists
            if (!profile?.address) {
                console.log('User has no address. Creating one...');
                await prisma.address.create({
                    data: {
                        profileId: profile!.id,
                        street: '123 Test St',
                        city: 'Lagos',
                        state: 'Lagos',
                        country: 'Nigeria'
                    }
                });
            }
            
            userWithCart = await prisma.user.findUnique({
              where: { id: user.id },
              include: {
                cart: { include: { items: { include: { product: { include: { curator: true } } } } } },
                profile: { include: { address: true } },
                wallet: true
              }
            }) as any;
        }
    }

    if (!userWithCart) {
      console.log('Could not setup test data.');
      return;
    }

    // Fund wallet
    const wallet = await prisma.wallet.upsert({
        where: { userId: userWithCart.id },
        update: { mainBalance: 1000000, availableBalance: 1000000 },
        create: { userId: userWithCart.id, mainBalance: 1000000, availableBalance: 1000000 }
    });
    console.log(`Wallet funded. Balance: ${wallet.mainBalance}`);

    console.log(`\n--- Step 2: Checkout for ${userWithCart.email} ---`);
    const summary = await orderService.getCheckoutSummary(userWithCart as any);
    const tier = summary.data.shippingTiers[0].name;
    const checkoutRes = await orderService.checkout(userWithCart as any, tier);
    
    if (!checkoutRes.success) {
        console.error('Checkout failed:', checkoutRes.message);
        return;
    }

    const createdOrderId = checkoutRes.data.orders[0].orderId;
    console.log(`Order created: ${createdOrderId}`);

    console.log('\n--- Step 3: Fetching Order Details via RentersService ---');
    const orderDetailsRes = await rentersService.getOrder(userWithCart.id, createdOrderId);
    
    console.log('Order Details Response:', JSON.stringify(orderDetailsRes, null, 2));

    // Verify fields
    const order = orderDetailsRes.data.order;
    const fieldsToVerify = ['totalAmount', 'deliveryFee', 'serviceFee', 'lister', 'items'];
    console.log('\n--- Field Verification ---');
    fieldsToVerify.forEach(f => {
        console.log(`${f}: ${order[f] !== undefined ? 'PRESENT' : 'MISSING'}`);
    });

    if (order.lister) {
        console.log('Lister details:', order.lister);
    }

    if (order.items && order.items.length > 0) {
        console.log('First item details:', order.items[0]);
    }

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await app.close();
  }
}

testOrderPersistence();
