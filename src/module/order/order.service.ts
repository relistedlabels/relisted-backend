import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/services/prisma/prisma.service";
import { bad } from "src/utils/error";
import { userEntity } from "../auth/auth.types";
import { EventEmitter2 } from "@nestjs/event-emitter";

@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService, private eventEmitter: EventEmitter2, ) {}

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

    const groupedByCurator: Record<string, typeof cart.items> = {};

    for (const item of cart.items) {
      const curatorId = item.product.curatorId;

      if (!groupedByCurator[curatorId]) {
        groupedByCurator[curatorId] = [];
      }
      groupedByCurator[curatorId].push(item);
    }

    const newOrder = await this.prisma.$transaction(async (tx) => {
      // create order
      const order = await tx.order.create({
      
      data: {
        orderId: await  this.generateOrderId(),
        userId:user.sub,
       
      },
      })


      for (const [curatorId, items] of Object.entries(groupedByCurator)) {
        const subOrder = await tx.subOrder.create({
          data: {
            orderId: order.id,
            curatorId,
           
          },
        });

        for (const item of items) {
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              subOrderId: subOrder.id,
              productId: item.productId,
              days: item.days,
              pricePerDay: item.product.dailyPrice, 
            },
          });
        }
          
      }
    });
    // order confimation email for curator to accept the order 
        // LISTEN  TO THE EVENT
        // this.eventEmitter.emit(
        //   'Order_Verification',
        //   new Order_Verification(email,order.id,newOrder., name, year),
        // );
    

    return {
      // orderId: newOrder.order.id,
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
