import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
} from '@nestjs/common';
import { CartService } from './cart-items.service';
import { CreateCartItemDto } from './dto/create-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { userEntity } from '../auth/auth.types';
import { ApiBearerAuth, ApiBody, ApiCookieAuth, ApiResponse } from '@nestjs/swagger';


@ApiBearerAuth('bearer')

@Controller('cart-items')
export class CartItemsController {
  constructor(private readonly cartItemsService: CartService) {}

  @Auth()
  @Post('item')
  @ApiResponse({ status: 201, description: 'Cart item added successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({ type: CreateCartItemDto })
  addCartItem(@Body() dto: CreateCartItemDto, @AuthUser() user: userEntity) {
    return this.cartItemsService.addCartItem(dto, user);
  }

  @Auth()
  @Patch('item/:id')
  @ApiResponse({ status: 200, description: 'Cart item updated successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiBody({ type: UpdateCartItemDto })
  updateCartItem(
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
    @AuthUser() user: userEntity,
  ) {
    return this.cartItemsService.updateCartItem(id, dto, user);
  }

  @Auth()
  @Get()
  @ApiResponse({
    status: 200,
    description: 'Cart items retrieved successfully',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getCart(@AuthUser() user: userEntity) {
    return this.cartItemsService.getCart(user);
  }

  @Auth()
  @Delete('item/:id')
  @ApiResponse({ status: 200, description: 'Cart item removed successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  removeCartItem(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.cartItemsService.removeCartItem(id, user);
  }
}
