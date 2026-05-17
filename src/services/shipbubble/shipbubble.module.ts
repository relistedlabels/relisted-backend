import { Module } from '@nestjs/common';
import { ShipbubbleAddressCacheService } from './shipbubble-address-cache.service';
import { ShipbubbleService } from './shipbubble.service';

@Module({
  providers: [ShipbubbleAddressCacheService, ShipbubbleService],
  exports: [ShipbubbleAddressCacheService, ShipbubbleService],
})
export class ShipbubbleModule {}
