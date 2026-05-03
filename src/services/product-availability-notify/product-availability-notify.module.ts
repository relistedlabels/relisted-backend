import { Module } from '@nestjs/common';
import { ProductAvailabilityNotifyService } from './product-availability-notify.service';

@Module({
  providers: [ProductAvailabilityNotifyService],
  exports: [ProductAvailabilityNotifyService],
})
export class ProductAvailabilityNotifyModule {}
