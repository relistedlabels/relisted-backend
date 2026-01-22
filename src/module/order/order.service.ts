import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { bad } from 'src/utils/error';
import { userEntity } from '../auth/auth.types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ProductStatus } from '@prisma/client';
import { Order_Verification } from 'src/services/event/event.types';
import { addMinutes } from 'date-fns';

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private eventEmitter: EventEmitter2,
  ) {}

  async checkout(user: userEntity) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId: user.sub },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      bad('Cart is empty');
    }

    let rentalTotal = 0;
    let collateralTotal = 0;
    let cleaningTotal = 0;

    for (const item of cart.items) {
      const product = item.product;

      if (!product.isActive) bad(`${product.name} is not active`);
      if (product.status !== 'AVAILABLE')
        bad(`${product.name} is not available`);
      if (item.days <= 0) bad(`Invalid rental duration`);

      rentalTotal += product.dailyPrice * item.days;
      collateralTotal += Number(product.originalValue) || 0;
      cleaningTotal += 2000;
    }

    const totalAmount = rentalTotal + collateralTotal + cleaningTotal;

    const newOrder = await this.prisma.$transaction(async (tx) => {
      // create order
      const order = await tx.order.create({
        data: {
          orderId: await this.generateOrderId(),
          userId: user.sub,
          reservedUntil:addMinutes(new Date(),30)
        },
      });
      for (let item of cart.items) {
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: item.productId,
            days: item.days,
            pricePerDay: item.product.dailyPrice,
          },
        });
        // change the product status to rented
        await tx.product.update({
          where: {
            id: item.productId,
          },
          data: {
            status: ProductStatus.RESERVED,
          },
        });
      }
      // Clear cart
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id },
      });
      // redirect user to wema bank integration 
      
 // order confimation email for curator to accept the order
    // LISTEN  TO THE EVENT
    this.eventEmitter.emit(
      'Order_Verification',
      new Order_Verification(user.email,order.id,user.name, totalAmount,"relisted"),
    );
      return order;
    });

   

    return {
      // orderId: order.id,
      // status: newOrder.order.status,
      summary: {
        rentalTotal,
        collateralTotal,
        cleaningTotal,
        totalAmount,
      },
    };
  }

  

  async generateOrderId() {
    return `ORD-${Date.now()}`;
  }
}
