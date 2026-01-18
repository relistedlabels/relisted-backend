import { Test, TestingModule } from '@nestjs/testing';
import { CartItemsController } from './cart-items.controller';
import { CartService } from './cart-items.service';

describe('CartItemsController', () => {
  let controller: CartItemsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CartItemsController],
      providers: [CartService],
    }).compile();

    controller = module.get<CartItemsController>(CartItemsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
