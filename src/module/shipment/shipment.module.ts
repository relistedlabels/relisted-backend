import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ScheduleModule } from '@nestjs/schedule';
import { ShipmentService } from './shipment.service';
import { ShipmentQuoteService } from './shipment-quote.service';
import { ShipmentController } from './shipment.controller';
import { ShipmentDispatchProcessor } from './shipment-dispatch.processor';
import { ShipmentDispatchScheduler } from './shipment-dispatch.scheduler';
import { ShipmentTrackingSyncService } from './shipment-tracking-sync.service';
import { DeliveryModule } from 'src/services/delivery/delivery.module';
import { NotificationModule } from 'src/services/notification/notification.module';
import { MailModule } from 'src/services/mail/mail.module';
import { TopshipModule } from 'src/services/topship/topship.module';
import { ChowdeckRelayModule } from 'src/services/chowdeck-relay/chowdeck-relay.module';
import { ShipbubbleModule } from 'src/services/shipbubble/shipbubble.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.registerQueue({ name: 'shipment-dispatch' }),
    DeliveryModule,
    NotificationModule,
    MailModule,
    TopshipModule,
    ChowdeckRelayModule,
    ShipbubbleModule,
  ],
  controllers: [ShipmentController],
  providers: [
    ShipmentService,
    ShipmentQuoteService,
    ShipmentDispatchProcessor,
    ShipmentDispatchScheduler,
    ShipmentTrackingSyncService,
  ],
  exports: [ShipmentService, ShipmentTrackingSyncService, ShipmentQuoteService],
})
export class ShipmentModule {}
