import { Controller, Get, Post, Body, Patch, Param, Delete, Req } from '@nestjs/common';
import { CartService } from './cart-items.service';
import { CreateCartItemDto } from './dto/create-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { userEntity } from '../auth/auth.types';

@Controller('cart-items')
export class CartItemsController {
  constructor(private readonly cartItemsService: CartService) {}


  @Auth()
  @Post('item')
  addCartItem( @Body() dto: CreateCartItemDto,@AuthUser() user:userEntity) {
    return this.cartItemsService.addCartItem( dto,user);
  }


  @Auth()
  @Patch('item/:id')
  updateCartItem( @Param('id') id: string, @Body() dto: UpdateCartItemDto,@AuthUser() user:userEntity) {
    return this.cartItemsService.updateCartItem( id, dto,user);
  }


  @Auth()

  @Get()
  getCart(@AuthUser() user:userEntity) {
    return this.cartItemsService.getCart(user);
  }


   @Auth()
    @Delete('item/:id')
  removeCartItem( @Param('id') id: string,@AuthUser() user:userEntity) {
    return this.cartItemsService.removeCartItem( id,user);
  }
}
