import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { ChowdeckRelayModule } from 'src/services/chowdeck-relay/chowdeck-relay.module';
import { TopshipModule } from 'src/services/topship/topship.module';
import { NotificationModule } from 'src/services/notification/notification.module';

@Global()
@Module({
  imports: [
    TopshipModule,
    ChowdeckRelayModule,
    NotificationModule,
    BullModule.registerQueue({ name: 'shipment-dispatch' }),
  ],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
