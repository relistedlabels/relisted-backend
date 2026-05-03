import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { CartService } from './cart-items.service';
import { CreateCartItemDto } from './dto/create-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { RequestAvailabilityDto } from './dto/request-availability.dto';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { userEntity } from '../auth/auth.types';
import {
  ApiBearerAuth,
  ApiBody,
  ApiResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

@ApiTags('Cart Items')
@ApiBearerAuth()
@Controller('cart-items')
export class CartItemsController {
  constructor(private readonly cartItemsService: CartService) {}

  /**
   * Add an item to the cart
   */
  @Auth()
  @Post('item')
  @ApiOperation({ summary: 'Add an item to the cart' })
  @ApiBody({ type: CreateCartItemDto })
  @ApiResponse({
    status: 201,
    description: 'Cart item added successfully',
    schema: {
      example: {
        id: 'uuid',
        cartId: 'uuid',
        productId: 'uuid',
        days: 5,
        createdAt: '2026-01-28T12:00:00.000Z',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  addCartItem(@Body() dto: CreateCartItemDto, @AuthUser() user: userEntity) {
    return this.cartItemsService.addCartItem(dto, user);
  }

  /**
   * Update a cart item
   */
  @Auth()
  @Patch('item/:id')
  @ApiOperation({ summary: 'Update a cart item' })
  @ApiParam({ name: 'id', description: 'Cart item ID', example: 'uuid' })
  @ApiBody({ type: UpdateCartItemDto })
  @ApiResponse({
    status: 200,
    description: 'Cart item updated successfully',
    schema: {
      example: {
        id: 'uuid',
        cartId: 'uuid',
        productId: 'uuid',
        days: 7,
        updatedAt: '2026-01-28T12:10:00.000Z',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  updateCartItem(
    @Param('id') id: string,
    @Body() dto: UpdateCartItemDto,
    @AuthUser() user: userEntity,
  ) {
    return this.cartItemsService.updateCartItem(id, dto, user);
  }

  /**
   * Get all items in the logged-in user's cart
   */
  @Auth()
  @Get()
  @ApiOperation({ summary: 'Get all cart items for the logged-in user' })
  @ApiResponse({
    status: 200,
    description: 'Cart items retrieved successfully',
    schema: {
      example: [
        {
          id: 'uuid',
          cartId: 'uuid',
          productId: 'uuid',
          days: 5,
          product: {
            id: 'uuid',
            name: 'Nike Shoes',
            dailyPrice: 1000,
          },
          createdAt: '2026-01-28T12:00:00.000Z',
          rentalRequests: [
            {
              requestId: 'uuid',
              expiresAt: '2026-01-28T12:30:00.000Z',
              status: 'PENDING',
              startDate: null,
              endDate: null,
              rentalDays: null,
              createdAt: '2026-01-28T12:00:00.000Z',
            },
          ],
          rentalRequest: {
            requestId: 'uuid',
            expiresAt: '2026-01-28T12:30:00.000Z',
            status: 'PENDING',
            startDate: null,
            endDate: null,
            rentalDays: null,
            createdAt: '2026-01-28T12:00:00.000Z',
          },
        },
      ],
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  getCart(@AuthUser() user: userEntity) {
    return this.cartItemsService.getCart(user);
  }

  /**
   * Remove a cart item
   */
  @Auth()
  @Delete('item/:id')
  @ApiOperation({ summary: 'Remove a cart item' })
  @ApiParam({ name: 'id', description: 'Cart item ID', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Cart item removed successfully',
    schema: {
      example: {
        message: 'Cart item removed successfully',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  removeCartItem(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.cartItemsService.removeCartItem(id, user);
  }

  /**
   * Request/re-request availability for a cart item
   */
  @Auth()
  @Post(':id/request')
  @ApiOperation({ summary: 'Request availability for a cart item' })
  @ApiParam({ name: 'id', description: 'Cart item ID', example: 'uuid' })
  @ApiBody({ type: RequestAvailabilityDto })
  @ApiResponse({
    status: 200,
    description:
      'Availability request created or reactivated (expired request set back to PENDING)',
    schema: {
      example: {
        id: 'uuid',
        cartItemId: 'uuid',
        productId: 'uuid',
        status: 'PENDING',
        expiresAt: '2026-01-28T12:30:00.000Z',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  requestAvailability(
    @Param('id') id: string,
    @AuthUser() user: userEntity,
    @Body() body: RequestAvailabilityDto,
  ) {
    return this.cartItemsService.requestAvailability(id, user, body);
  }
}
