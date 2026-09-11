import { Module } from '@nestjs/common';
import { ChowdeckRelayModule } from '../chowdeck-relay/chowdeck-relay.module';
import { ShipbubbleModule } from '../shipbubble/shipbubble.module';
import { TshipModule } from '../tship/tship.module';
import { TopshipModule } from '../topship/topship.module';
import { TopshipProvider } from './providers/topship.provider';
import { ChowdeckRelayProvider } from './providers/chowdeck-relay.provider';
import { ShipbubbleProvider } from './providers/shipbubble.provider';
import { TshipProvider } from './providers/tship.provider';
import { DeliveryProviderService } from './delivery-provider.service';

@Module({
  imports: [TopshipModule, ChowdeckRelayModule, ShipbubbleModule, TshipModule],
  providers: [
    TopshipProvider,
    ChowdeckRelayProvider,
    ShipbubbleProvider,
    TshipProvider,
    DeliveryProviderService,
  ],
  exports: [DeliveryProviderService],
})
export class DeliveryModule {}
