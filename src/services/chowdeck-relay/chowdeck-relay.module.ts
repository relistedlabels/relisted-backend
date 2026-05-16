import { Module } from '@nestjs/common';
import { GeocodingModule } from '../geocoding/geocoding.module';
import { ChowdeckRelayService } from './chowdeck-relay.service';

@Module({
  imports: [GeocodingModule],
  providers: [ChowdeckRelayService],
  exports: [ChowdeckRelayService],
})
export class ChowdeckRelayModule {}
