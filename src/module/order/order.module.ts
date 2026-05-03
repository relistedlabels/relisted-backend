import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { TopshipModule } from 'src/services/topship/topship.module';
import { NotificationModule } from 'src/services/notification/notification.module';

@Global()
@Module({
  imports: [
    TopshipModule,
    NotificationModule,
    BullModule.registerQueue({ name: 'shipment-dispatch' }),
  ],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
