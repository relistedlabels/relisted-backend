import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
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
  getCheckoutSummary(
    @AuthUser() user: userEntity,
    @Query('returnStreet') returnStreet?: string,
    @Query('returnCity') returnCity?: string,
    @Query('returnState') returnState?: string,
    @Query('returnCountry') returnCountry?: string,
    @Query('returnPostalCode') returnPostalCode?: string,
    @Query('returnLandmark') returnLandmark?: string,
    @Query('returnInstructions') returnInstructions?: string,
  ) {
    const returnPickupAddress =
      returnStreet || returnCity || returnState
        ? {
            street: returnStreet,
            city: returnCity,
            state: returnState,
            country: returnCountry,
            postalCode: returnPostalCode,
            landmark: returnLandmark,
            instructions: returnInstructions,
          }
        : undefined;

    return this.orderService.getCheckoutSummary(user, returnPickupAddress);
  }

  @Auth()
  @Post()
  create(@AuthUser() user: userEntity, @Body() dto: CreateOrderDto) {
    return this.orderService.checkout(user, dto);
  }

  @Auth()
  @Post('resale/confirm')
  confirmResaleOrder(
    @AuthUser() user: userEntity,
    @Body('orderId') orderId: string,
    @Body('shipmentId') shipmentId?: string,
  ) {
    return this.orderService.confirmResaleOrder(user, orderId, { shipmentId });
  }

  @Auth()
  @Post('rental/confirm')
  confirmRentalOrder(
    @AuthUser() user: userEntity,
    @Body('orderId') orderId: string,
    @Body('shipmentId') shipmentId?: string,
  ) {
    return this.orderService.confirmRentalOrder(user, orderId, { shipmentId });
  }
}
