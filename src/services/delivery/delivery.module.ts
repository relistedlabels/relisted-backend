import { Module } from '@nestjs/common';
import { ChowdeckRelayModule } from '../chowdeck-relay/chowdeck-relay.module';
import { TopshipModule } from '../topship/topship.module';
import { TopshipProvider } from './providers/topship.provider';
import { ChowdeckRelayProvider } from './providers/chowdeck-relay.provider';
import { DeliveryProviderService } from './delivery-provider.service';

@Module({
  imports: [TopshipModule, ChowdeckRelayModule],
  providers: [TopshipProvider, ChowdeckRelayProvider, DeliveryProviderService],
  exports: [DeliveryProviderService],
})
export class DeliveryModule {}
