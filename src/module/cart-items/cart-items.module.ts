import { Module } from '@nestjs/common';
import { CartService } from './cart-items.service';
import { CartItemsController } from './cart-items.controller';
import { AvailabilityRequestReminderScheduler } from './availability-request-reminder.scheduler';

@Module({
  controllers: [CartItemsController],
  providers: [CartService, AvailabilityRequestReminderScheduler],
})
export class CartItemsModule {}
