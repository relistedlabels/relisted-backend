import { Module } from '@nestjs/common';
import { ShipmentModule } from 'src/module/shipment/shipment.module';
import { ListersModule } from 'src/module/listers/listers.module';
import { PrismaModule } from 'src/services/prisma/prisma.module';
import { WhatsAppModule } from 'src/services/whatsapp/whatsapp.module';
import { ShipbubbleWebhookController } from './shipbubble-webhook.controller';
import { ShipbubbleWebhookService } from './shipbubble-webhook.service';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

@Module({
  imports: [ShipmentModule, PrismaModule, ListersModule, WhatsAppModule],
  controllers: [ShipbubbleWebhookController, WhatsAppWebhookController],
  providers: [ShipbubbleWebhookService, WhatsAppWebhookService],
})
export class WebhookModule {}
