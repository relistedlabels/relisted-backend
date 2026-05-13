import { Module } from '@nestjs/common';
import { CartService } from './cart-items.service';
import { CartItemsController } from './cart-items.controller';

@Module({
  controllers: [CartItemsController],
  providers: [CartService],
})
export class CartItemsModule {}
