import { Module } from '@nestjs/common';
import { ShipmentModule } from 'src/module/shipment/shipment.module';
import { ShipbubbleWebhookController } from './shipbubble-webhook.controller';
import { ShipbubbleWebhookService } from './shipbubble-webhook.service';

@Module({
  imports: [ShipmentModule],
  controllers: [ShipbubbleWebhookController],
  providers: [ShipbubbleWebhookService],
})
export class WebhookModule {}
