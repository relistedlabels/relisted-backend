import { Module } from '@nestjs/common';
import { ChowdeckRelayModule } from '../chowdeck-relay/chowdeck-relay.module';
import { ShipbubbleModule } from '../shipbubble/shipbubble.module';
import { TopshipModule } from '../topship/topship.module';
import { TopshipProvider } from './providers/topship.provider';
import { ChowdeckRelayProvider } from './providers/chowdeck-relay.provider';
import { ShipbubbleProvider } from './providers/shipbubble.provider';
import { DeliveryProviderService } from './delivery-provider.service';

@Module({
  imports: [TopshipModule, ChowdeckRelayModule, ShipbubbleModule],
  providers: [
    TopshipProvider,
    ChowdeckRelayProvider,
    ShipbubbleProvider,
    DeliveryProviderService,
  ],
  exports: [DeliveryProviderService],
})
export class DeliveryModule {}
