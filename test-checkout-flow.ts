import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { OrderService } from './src/module/order/order.service';
import { PrismaService } from './src/services/prisma/prisma.service';

async function testCheckoutFlow() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const orderService = app.get(OrderService);
  const prisma = app.get(PrismaService);

  try {
    // 1. Find a user with items in their cart
    const userWithCart = await prisma.user.findFirst({
      where: {
        cart: {
          items: {
            some: {}
          }
        },
        profile: {
          address: {
            isNot: null
          }
        },
        wallet: {
          mainBalance: {
            gt: 10000 // Ensure they have some balance
          }
        }
      },
      include: {
        cart: {
          include: {
            items: {
              include: {
                product: true
              }
            }
          }
        },
        profile: {
          include: {
            address: true
          }
        },
        wallet: true
      }
    });

    if (!userWithCart) {
        // Just find any user and a product to add to cart
        const user = await prisma.user.findFirst({ include: { cart: true, profile: { include: { address: true } } } });
        const product = await prisma.product.findFirst({ where: { isActive: true } });
        
        if (user && product) {
            console.log(`Adding product ${product.id} to cart for user ${user.id}`);
            if (!user.cart) {
                await prisma.cart.create({ data: { userId: user.id } });
            }
            const cart = await prisma.cart.findUnique({ where: { userId: user.id } });
            await prisma.cartItem.create({
                data: {
                    cartId: cart!.id,
                    productId: product.id,
                    days: 3
                }
            });
            // Re-fetch user with cart info
            return testCheckoutFlow(); // Restart with data
        }
      console.log('No suitable user/product found.');
      await app.close();
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
      await app.close();
      return;
    }

    // 3. Select a shipping tier
    const selectedTier = summaryResponse.data.shippingTiers[0].name;
    console.log(`\n--- Step 2: Performing Checkout with Tier: ${selectedTier} ---`);

    // 4. Perform Checkout
    const checkoutResponse = await orderService.checkout(userWithCart as any, selectedTier);
    console.log('Checkout Result:', JSON.stringify(checkoutResponse, null, 2));

  } catch (error) {
    console.error('Error during checkout flow test:', error);
  } finally {
    await app.close();
  }
}

testCheckoutFlow();
