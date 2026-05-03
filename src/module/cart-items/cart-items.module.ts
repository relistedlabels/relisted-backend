import { Module } from '@nestjs/common';
import { CartService } from './cart-items.service';
import { CartItemsController } from './cart-items.controller';
import { PrismaService } from 'src/services/prisma/prisma.service';

@Module({
  controllers: [CartItemsController],
  providers: [CartService, PrismaService],
})
export class CartItemsModule {}
