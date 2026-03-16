import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { OrderService } from './src/module/order/order.service';
import { PrismaService } from './src/services/prisma/prisma.service';

async function testCheckoutFlow() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const orderService = app.get(OrderService);
  const prisma = app.get(PrismaService);

  try {
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
            console.log(`Adding product ${product.id} (Curator: ${product.curatorId}) to cart for user ${user.id}`);
            if (!user.cart) {
                await prisma.cart.create({ data: { userId: user.id } });
            }
            const cart = await prisma.cart.findUnique({ where: { userId: user.id } });
            await prisma.cartItem.create({
                data: { cartId: cart!.id, productId: product.id, days: 3 },
            });
            
            // Re-fetch
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

    console.log(`Testing for user: ${userWithCart.email} (${userWithCart.id})`);
    console.log(`Cart items: ${userWithCart.cart?.items.length}`);

    // EXTRA STEP: Fund the wallet to ensure checkout succeeds
    console.log('\n--- Step 0: Funding Wallet ---');
    const updatedWallet = await prisma.wallet.update({
        where: { userId: userWithCart.id },
        data: { mainBalance: 1000000, availableBalance: 1000000 } // 1M NGN
    });
    console.log(`Wallet funded. New balance: ${updatedWallet.mainBalance}`);

    // 2. Get Checkout Summary
    console.log('\n--- Step 1: Getting Checkout Summary ---');
    const summaryResponse = await orderService.getCheckoutSummary(userWithCart as any);
    console.log('Summary Result:', JSON.stringify(summaryResponse, null, 2));

    if (!summaryResponse.success || !summaryResponse.data.shippingTiers?.length) {
      console.error('Failed to get summary or no shipping tiers available.');
      return;
    }

    // 3. Select a shipping tier
    const selectedTier = summaryResponse.data.shippingTiers[0].name;
    console.log(`\n--- Step 2: Performing Checkout with Tier: ${selectedTier} ---`);

    // 4. Perform Checkout
    const checkoutResponse = await orderService.checkout(userWithCart as any, selectedTier);
    console.log('Checkout Result:', JSON.stringify(checkoutResponse, null, 2));

    // 5. Verify Balances
    console.log('\n--- Step 3: Verifying Balances ---');
    const finalRenterWallet = await prisma.wallet.findUnique({ where: { userId: userWithCart.id } });
    console.log('Final Renter Wallet:', JSON.stringify(finalRenterWallet, null, 2));

    const listerIds = [...new Set(userWithCart.cart?.items.map(i => i.product.curatorId))];
    for (const lid of listerIds) {
        const lWallet = await prisma.wallet.findUnique({ where: { userId: lid } });
        const name = userWithCart.cart?.items.find(i => i.product.curatorId === lid)?.product.curator.name || lid;
        console.log(`Final Lister Wallet (${name} - ${lid}):`, JSON.stringify(lWallet, null, 2));
    }

  } catch (error) {
    console.error('Error during checkout flow test:', error);
  } finally {
    await app.close();
  }
}

testCheckoutFlow();
