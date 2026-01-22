import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { bad } from 'src/utils/error';
import { userEntity } from '../auth/auth.types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus, ProductStatus } from '@prisma/client';
import { Order_Verification } from 'src/services/event/event.types';
import { addMinutes } from 'date-fns';
import { Order } from './entities/order.entity';

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
          include: {
            product: {
              include: { curator: true },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      bad('Cart is empty');
    }

    const createdOrders: any[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const item of cart.items) {
        const product = item.product;

        if (!product.isActive) bad(`${product.name} is not active`);
        if (item.days <= 0) bad('Invalid rental duration');

        const rentalAmount = product.dailyPrice * item.days;
        const collateralAmount = Number(product.originalValue) || 0;
        const cleaningFee = 2000;
        const totalAmount = rentalAmount + collateralAmount + cleaningFee;
        

        const order = await tx.order.create({
          data: {
            orderId: await this.generateOrderId(),
            userId: user.sub,
          },
        });

        await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: product.id,
            days: item.days,
            pricePerDay: product.dailyPrice,
          },
        });

        createdOrders.push(order);

        this.eventEmitter.emit(
          'Order_Verification',
          new Order_Verification(
            product.curator.email,
            user.name,
            order.id,
            product.curator.name,
            totalAmount,

            'new_order',
            '3',

            
            'relisted',
            product.name,
            rentalAmount
          ),
        );
      }

      await tx.cartItem.deleteMany({
        where: { cartId: cart.id },
      });
    });

    return {
      message: 'Orders created. Awaiting lister confirmation.',
      ordersCreated: createdOrders.length,
    };
  }


  async listerOrderApproval(orderId:string,user:userEntity){
      const orderItem = await this.prisma.orderItem.findFirst({
      where: {  orderId:orderId },
      include: { product: true, order: true },
    });
    if(!orderItem) bad("order not found")
    if(orderItem.product.curatorId !==user.sub) bad("you can't approve this order ")

       if (orderItem.order.status !== OrderStatus.PROCESSING) {
      throw new BadRequestException(
        'Order has already been confirmed or processed'
      );
    }
      // accept order 
  // return await this.prisma.orderItem.update({
  //  where:{
  //   id:orderItem.id
  //  },
  //  data:{
  //   status:
  //  }
  // })

  }
  async generateOrderId() {
    return `ORD-${Date.now()}`;
  }
}
