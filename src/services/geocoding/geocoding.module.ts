import { Module } from '@nestjs/common';
import { NominatimGeocodeService } from './nominatim-geocode.service';

@Module({
  providers: [NominatimGeocodeService],
  exports: [NominatimGeocodeService],
})
export class GeocodingModule {}
