import { AppModule } from './src/app.module';
import { NestFactory } from '@nestjs/core';
import { ProductService } from './src/module/product/product.service';
import { OrderService } from './src/module/order/order.service';
import { PrismaService } from './src/services/prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const productService = app.get(ProductService);
  const orderService = app.get(OrderService);
  const prisma = app.get(PrismaService);

  try {
    // 1. Setup Test User
    const email = `test_collateral_${Date.now()}@test.com`;
    const user = await prisma.user.create({
      data: {
        email,
        password: "hashedpassword",
        name: "Test Collateral User",
        role: "LISTER",
        isVerified: true,
      }
    });

    console.log(`Created test user: ${user.id}`);

    // Create Renter
    const renterEmail = `renter_collateral_${Date.now()}@test.com`;
    const renter = await prisma.user.create({
      data: {
        email: renterEmail,
        password: "hashedpassword",
        name: "Test Renter",
        role: "RENTER",
        isVerified: true,
      }
    });
    
    // Create Profile and Address for Renter (needed for checkout)
    await prisma.profile.create({
        data: {
            userId: renter.id,
            phoneNumber: "08012345678",
            address: {
                create: {
                    street: "123 Renter St",
                    city: "Lagos",
                    state: "Lagos",
                    country: "Nigeria"
                }
            }
        }
    });

    await prisma.wallet.create({
      data: {
        userId: renter.id,
        mainBalance: 1000000,
        availableBalance: 1000000,
      }
    });

    // 2. Create Product with collateralPrice
    console.log("Creating product with collateralPrice...");
    const createDto: any = {
      name: "Collateral Test Product",
      subText: "Test",
      description: "Test description",
      condition: "New",
      measurement: "Medium",
      originalValue: 100000,
      collateralPrice: 50000, // This should be used
      dailyPrice: 5000,
      color: "Blue",
      careInstruction: "Wash carefully",
      stylingTip: "Wear it well",
      categoryId: (await prisma.productCategory.findFirst())?.id,
      quantity: 1
    };

    const userEntity: any = { id: user.id };
    const createResult = await productService.create(createDto, userEntity);
    const productId = createResult.product.id;
    
    // Verify it's verified for checkout
    await prisma.product.update({
        where: { id: productId },
        data: { productVerified: true, isActive: true, status: 'AVAILABLE' }
    });

    // 3. Add to Cart
    await prisma.cart.create({
        data: {
            userId: renter.id,
            items: {
                create: {
                    productId,
                    days: 2
                }
            }
        }
    });

    // 4. Check Order Summary
    console.log("Checking order summary...");
    const summaryResult = await orderService.getCheckoutSummary({ id: renter.id } as any);
    console.log("Summary Collateral Total:", summaryResult.data.summary.collateralTotal);
    
    if (summaryResult.data.summary.collateralTotal === 50000) {
        console.log("✅ Summary correctly used collateralPrice!");
    } else {
        console.error("❌ Summary FAILED to use collateralPrice. Value:", summaryResult.data.summary.collateralTotal);
    }

    // 5. Checkout and verify order item
    console.log("Executing checkout...");
    const checkoutResult = await orderService.checkout({ id: renter.id } as any);
    
    const orderItems = await prisma.orderItem.findMany({
        where: { productId },
        include: { order: true }
    });
    
    // We need to check if OrderItem has collateralAmount or similar if implemented, 
    // but the task was to use it in calculation. 
    // Let's check the wallet deduction.
    const walletAfter = await prisma.wallet.findUnique({ where: { userId: renter.id } });
    const expectedDeduction = (5000 * 2) + 50000 + 2000 + 3000 + (3000/100); // rental + collateral + cleaning + shipping + pickup(min 1)
    // Actually pickup is separate. 
    console.log("Wallet Balance After:", walletAfter?.mainBalance);

    // Clean up
    console.log("Cleaning up generated resources...");
    await prisma.orderItem.deleteMany({ where: { productId } });
    await prisma.order.deleteMany({ where: { userId: renter.id } });
    await prisma.cartItem.deleteMany({ where: { productId } });
    await prisma.cart.deleteMany({ where: { userId: renter.id } });
    await prisma.walletTransaction.deleteMany({ where: { walletId: (await prisma.wallet.findUnique({where:{userId:renter.id}}))?.id } });
    await prisma.wallet.deleteMany({ where: { userId: renter.id } });
    await prisma.address.deleteMany({ where: { profile: { userId: renter.id } } });
    await prisma.profile.deleteMany({ where: { userId: renter.id } });
    await prisma.product.delete({ where: { id: productId } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.user.delete({ where: { id: renter.id } });

    console.log("Cleanup complete!");
  } catch (error: any) {
    console.error("Test execution failed:", error);
  } finally {
    await app.close();
  }
}

bootstrap();
