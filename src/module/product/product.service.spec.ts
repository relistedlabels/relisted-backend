import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { ProductService } from './product.service';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { ClosetService } from '../closet/closet.service';
import { MailService } from 'src/services/mail/mail.service';

const mockPrisma = {
  product: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  user: { findUnique: jest.fn() },
  tag: { findMany: jest.fn() },
  productCategory: { findUnique: jest.fn() },
  brand: { findUnique: jest.fn() },
};

const mockClosetService = {};
const mockMailService = { sendMail: jest.fn() };

describe('ProductService revenue guards', () => {
  let service: ProductService;

  const admin = { id: 'admin-1', email: 'admin@test.com', role: 'ADMIN' };
  const lister = { id: 'lister-1', email: 'l@test.com', role: 'LISTER' };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ClosetService, useValue: mockClosetService },
        { provide: MailService, useValue: mockMailService },
      ],
    }).compile();

    service = module.get<ProductService>(ProductService);
  });

  describe('create', () => {
    it('requires daily price for RENTAL listings', async () => {
      await expect(
        service.create(
          { listingType: 'RENTAL', originalValue: 10000, quantity: 1 } as never,
          lister as never,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires resale price for RESALE listings', async () => {
      await expect(
        service.create(
          { listingType: 'RESALE', originalValue: 10000, quantity: 1 } as never,
          lister as never,
        ),
      ).rejects.toThrow('Resale price is required');
    });
  });

  describe('approveProduct', () => {
    it('throws when product not found', async () => {
      mockPrisma.product.findUnique.mockResolvedValue(null);

      await expect(
        service.approveProduct('prod-1', admin as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when product already approved', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'prod-1',
        status: ProductStatus.APPROVED,
      });

      await expect(
        service.approveProduct('prod-1', admin as never),
      ).rejects.toThrow('already approved');
    });

    it('sets product to AVAILABLE and verified', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'prod-1',
        status: ProductStatus.PENDING,
      });
      mockPrisma.product.update.mockResolvedValue({
        id: 'prod-1',
        status: ProductStatus.AVAILABLE,
        productVerified: true,
        isActive: true,
      });

      const result = await service.approveProduct('prod-1', admin as never);

      expect(mockPrisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'prod-1' },
          data: expect.objectContaining({
            status: ProductStatus.AVAILABLE,
            productVerified: true,
            isActive: true,
          }),
        }),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('rejectProduct', () => {
    it('throws when rejecting an already approved product', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'prod-1',
        status: ProductStatus.APPROVED,
      });

      await expect(
        service.rejectProduct('prod-1', 'Poor photos', admin as never),
      ).rejects.toThrow('Cannot reject an approved product');
    });

    it('marks pending product as rejected and inactive', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'prod-1',
        status: ProductStatus.PENDING,
      });
      mockPrisma.product.update.mockResolvedValue({
        id: 'prod-1',
        status: ProductStatus.REJECTED,
        isActive: false,
      });

      const result = await service.rejectProduct(
        'prod-1',
        'Poor photos',
        admin as never,
      );

      expect(result.success).toBe(true);
      expect(mockPrisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ProductStatus.REJECTED,
            isActive: false,
          }),
        }),
      );
    });
  });

  describe('toggleAvailability', () => {
    it('forbids non-owner non-admin', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'prod-1',
        curatorId: 'other-lister',
        status: ProductStatus.AVAILABLE,
      });
      mockPrisma.user.findUnique.mockResolvedValue({ role: 'LISTER' });

      await expect(
        service.toggleAvailability('prod-1', false, lister as never),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects toggle when product is not approved yet', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'prod-1',
        curatorId: lister.id,
        status: ProductStatus.PENDING,
      });
      mockPrisma.user.findUnique.mockResolvedValue({ role: 'LISTER' });

      await expect(
        service.toggleAvailability('prod-1', false, lister as never),
      ).rejects.toThrow('Only approved products');
    });

    it('allows owner to mark approved product unavailable', async () => {
      mockPrisma.product.findUnique.mockResolvedValue({
        id: 'prod-1',
        curatorId: lister.id,
        status: ProductStatus.AVAILABLE,
      });
      mockPrisma.user.findUnique.mockResolvedValue({ role: 'LISTER' });
      mockPrisma.product.update.mockResolvedValue({
        id: 'prod-1',
        status: ProductStatus.UNAVAILABLE,
        isActive: false,
      });

      const result = await service.toggleAvailability(
        'prod-1',
        false,
        lister as never,
      );

      expect(result.success).toBe(true);
      expect(mockPrisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: ProductStatus.UNAVAILABLE,
            isActive: false,
          }),
        }),
      );
    });
  });
});
