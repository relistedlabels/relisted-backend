import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { userEntity } from '../auth/auth.types';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';

@Controller('order')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}
  
  @Auth()
  @Get('summary')
  getCheckoutSummary(@AuthUser() user: userEntity) {
    return this.orderService.getCheckoutSummary(user);
  }

  @Auth()
  @Post()
  create(@AuthUser() user: userEntity, @Body('pricingTier') pricingTier?: string) {
    return this.orderService.checkout(user, pricingTier);
  }

  @Auth()
  @Post('resale/confirm')
  confirmResaleOrder(@AuthUser() user: userEntity, @Body('orderId') orderId: string) {
    return this.orderService.confirmResaleOrder(user, orderId);
  }

}
