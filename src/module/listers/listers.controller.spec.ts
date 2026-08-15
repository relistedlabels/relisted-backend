import { Test, TestingModule } from '@nestjs/testing';
import { ListersController } from './listers.controller';
import { ListersService } from './listers.service';
import { UploadService } from '../upload/upload.service';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';

describe('ListersController', () => {
  let controller: ListersController;
  let service: ListersService;

  const mockUser = {
    id: 'user-1',
    sub: 'user-1',
    email: 'lister@test.com',
    isVerified: true,
    name: 'Test Lister',
  };

  const mockListersService = {
    getTopItems: jest.fn().mockResolvedValue({
      success: true,
      data: { topItems: [], generatedAt: new Date().toISOString() },
    }),
    getRecentRentals: jest.fn().mockResolvedValue({
      success: true,
      data: { recentRentals: [], pagination: { total: 0, page: 1, limit: 10, pages: 0 } },
    }),
    getOrders: jest.fn().mockResolvedValue({
      success: true,
      data: { orders: [], pagination: { total: 0, page: 1, limit: 20, pages: 0 }, summary: {} },
    }),
    getOrderById: jest.fn().mockResolvedValue({ success: true, data: { order: {} } }),
    getOrderItems: jest.fn().mockResolvedValue({
      success: true,
      data: { items: [], orderId: 'ord-1', totalItems: 0 },
    }),
    getOrderProgress: jest.fn().mockResolvedValue({
      success: true,
      data: { currentStep: 'processing', steps: [], progressPercentage: 0, orderId: 'ord-1' },
    }),
  };

  const mockCanActivate = { canActivate: () => true };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListersController],
      providers: [
        {
          provide: ListersService,
          useValue: mockListersService,
        },
        { provide: UploadService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockCanActivate)
      .overrideGuard(RoleGuard)
      .useValue(mockCanActivate)
      .compile();

    controller = module.get<ListersController>(ListersController);
    service = module.get<ListersService>(ListersService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getTopItems', () => {
    it('should return top items and call service with limit', async () => {
      const result = await controller.getTopItems(mockUser as any, '5');
      expect(service.getTopItems).toHaveBeenCalledWith(mockUser, 5);
      expect(result.success).toBe(true);
      expect(result.data.topItems).toEqual([]);
    });
  });

  describe('getRecentRentals', () => {
    it('should return recent rentals with pagination', async () => {
      const result = await controller.getRecentRentals(
        mockUser as any,
        '1',
        '10',
        'all',
      );
      expect(service.getRecentRentals).toHaveBeenCalledWith(mockUser, 1, 10, 'all');
      expect(result.success).toBe(true);
      expect(result.data.recentRentals).toEqual([]);
    });
  });

  describe('getOrders', () => {
    it('should return orders with status filter and pagination', async () => {
      const result = await controller.getOrders(
        mockUser as any,
        'pending',
        '1',
        '20',
        '-createdAt',
      );
      expect(service.getOrders).toHaveBeenCalledWith(
        mockUser,
        'pending',
        1,
        20,
        '-createdAt',
      );
      expect(result.success).toBe(true);
      expect(result.data.orders).toEqual([]);
    });
  });

  describe('getOrderById', () => {
    it('should return single order details', async () => {
      const result = await controller.getOrderById(mockUser as any, 'order-123');
      expect(service.getOrderById).toHaveBeenCalledWith(mockUser, 'order-123');
      expect(result.success).toBe(true);
      expect(result.data.order).toBeDefined();
    });
  });

  describe('getOrderItems', () => {
    it('should return items for an order', async () => {
      const result = await controller.getOrderItems(mockUser as any, 'order-123');
      expect(service.getOrderItems).toHaveBeenCalledWith(mockUser, 'order-123');
      expect(result.success).toBe(true);
      expect(result.data.items).toEqual([]);
    });
  });

  describe('getOrderProgress', () => {
    it('should return order progress steps', async () => {
      const result = await controller.getOrderProgress(mockUser as any, 'order-123');
      expect(service.getOrderProgress).toHaveBeenCalledWith(mockUser, 'order-123');
      expect(result.success).toBe(true);
      expect(result.data.currentStep).toBe('processing');
    });
  });
});
