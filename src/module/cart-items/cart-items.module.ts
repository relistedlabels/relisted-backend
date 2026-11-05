import { Module } from '@nestjs/common';
import { CartService } from './cart-items.service';
import { CartItemsController } from './cart-items.controller';
import { AvailabilityRequestReminderScheduler } from './availability-request-reminder.scheduler';
import { SiteFeaturesModule } from '../site-features/site-features.module';

@Module({
  imports: [SiteFeaturesModule],
  controllers: [CartItemsController],
  providers: [CartService, AvailabilityRequestReminderScheduler],
  exports: [CartService],
})
export class CartItemsModule {}
