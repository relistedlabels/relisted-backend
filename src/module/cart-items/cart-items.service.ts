import { Injectable } from '@nestjs/common';
import { CreateCartItemDto } from './dto/create-cart-item.dto';
import { UpdateCartItemDto } from './dto/update-cart-item.dto';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { bad } from 'src/utils/error';
import { userEntity } from '../auth/auth.types';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  //  create cart for user
  async CreateCart(userId: string) {
    let cart = await this.prisma.cart.findUnique({ where: { userId } });
    if (!cart) {
      cart = await this.prisma.cart.create({ data: { userId } });
    }
    return cart;
  }

  // Add item to cart
  async addCartItem(dto: CreateCartItemDto, user: userEntity) {
    const cart = await this.CreateCart(user.id);

    const product = await this.prisma.product.findUnique({
      where: { id: dto.productId },
    });


    // Prevent duplicate
    const existing = await this.prisma.cartItem.findFirst({
      where: { cartId: cart.id, productId: dto.productId },
    });
    if (existing) bad('Product already in cart');

    return this.prisma.cartItem.create({
      data: { cartId: cart.id, productId: dto.productId, days: dto.days },
    });
  }

  // Update cart item (rental days)
  async updateCartItem(
    cartItemId: string,
    dto: UpdateCartItemDto,
    user: userEntity,
  ) {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: cartItemId },
      include: { cart: true },
    });
    if (!item || item.cart.userId !== user.id) bad('Cart item not found');

    return this.prisma.cartItem.update({
      where: { id: cartItemId },
      data: { days: dto.days },
    });
  }
  // Fetch cart with totals
  async getCart(user: userEntity) {
    const cart = await this.prisma.cart.findUnique({
      where: { userId: user.id },
      include: { items: { include: { product: true } } },
    });

    if (!cart) return { items: [], total: 0 };

    const total = cart.items.reduce(
      (sum, item) => sum + item.product.dailyPrice * item.days,
      0,
    );

    return { cartId: cart.id, items: cart.items, total };
  }

  // Remove cart item
  async removeCartItem(cartItemId: string, user: userEntity) {
    const item = await this.prisma.cartItem.findUnique({
      where: { id: cartItemId },
      include: { cart: true },
    });
    if (!item || item.cart.userId !== user.id) bad('Cart item not found');

    await this.prisma.cartItem.delete({ where: { id: cartItemId } });
    return { message: 'Item removed from cart' };
  }
}
