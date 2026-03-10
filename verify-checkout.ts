import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { OrderService } from './src/module/order/order.service';
import { PrismaService } from './src/services/prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const prisma = app.get(PrismaService);
  const orderService = app.get(OrderService);

  console.log('--- Setting up test data ---');
  
  const suffix = Date.now();
  
  const renter = await prisma.user.create({
    data: {
      email: `test_renter_${suffix}@checkout.com`,
      name: 'Test Renter',
      password: 'password',
      role: 'RENTER',
      profile: {
         create: {
            phoneNumber: '08000000000',
            address: {
               create: { street: '123 Renter St', city: 'Lagos', state: 'Lagos', country: 'Nigeria' }
            }
         }
      },
      wallet: {
         create: { mainBalance: 500000, availableBalance: 500000 }
      }
    }
  });

  const lister1 = await prisma.user.create({
      data: {
        email: `lister1_${suffix}@checkout.com`,
        name: 'Test Lister 1',
        password: 'password',
        role: 'LISTER',
        profile: {
           create: {
              phoneNumber: '08000000001',
              address: {
                 create: { street: '456 Lister St', city: 'Abuja', state: 'FCT', country: 'Nigeria' }
              }
           }
        }
      }
  });

  const lister2 = await prisma.user.create({
      data: {
        email: `lister2_${suffix}@checkout.com`,
        name: 'Test Lister 2',
        password: 'password',
        role: 'LISTER',
        profile: {
           create: {
              phoneNumber: '08000000002',
              address: {
                 create: { street: '789 Lister St', city: 'Ibadan', state: 'Oyo', country: 'Nigeria' }
              }
           }
        }
      }
  });

  let p1 = await prisma.product.findFirst({ where: { name: 'Lister 1 Product' }});
  if (!p1) {
    p1 = await prisma.product.create({
      data: {
         name: 'Lister 1 Product', subText: 'Test', description: 'Test', condition: 'New', measurement: 'M',
         dailyPrice: 5000, originalValue: 50000, color: 'Red', careInstruction: 'Wash', careSteps: 'Wash', stylingTip: 'Style',
         curatorId: lister1!.id, isActive: true
      }
    });
  }

  let p2 = await prisma.product.findFirst({ where: { name: 'Lister 2 Product' }});
  if (!p2) {
    p2 = await prisma.product.create({
      data: {
         name: 'Lister 2 Product', subText: 'Test', description: 'Test', condition: 'New', measurement: 'M',
         dailyPrice: 10000, originalValue: 100000, color: 'Blue', careInstruction: 'Wash', careSteps: 'Wash', stylingTip: 'Style',
         curatorId: lister2!.id, isActive: true
      }
    });
  }

  let cart = await prisma.cart.create({ data: { userId: renter.id } });
  
  await prisma.cartItem.createMany({
     data: [
       { cartId: cart.id, productId: p1.id, days: 2 }, // lister 1 items: 5000*2 + 50000 + 2000 = 62000
       { cartId: cart.id, productId: p2.id, days: 3 }  // lister 2 items: 10000*3 + 100000 + 2000 = 132000
     ]
  });

  console.log('--- Calling OrderService.checkout ---');
  try {
     const result = await orderService.checkout(renter as any);
     console.log('Checkout Result:', result);
     
     const updatedWallet = await prisma.wallet.findUnique({ where: { userId: renter.id }});
     console.log('Updated Wallet Balance:', updatedWallet!.availableBalance);
     console.log('Expected deductions: 62000 (L1) + 132000 (L2) + Topship Shipping per lister');
  } catch (err) {
     console.error('Checkout Error:', err);
  }
  
  await app.close();
}

bootstrap();
