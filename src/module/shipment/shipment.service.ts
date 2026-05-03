import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { ListShipmentsDto } from './dto/list-shipments.dto';

@Injectable()
export class ShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('shipment-dispatch') private readonly dispatchQueue: Queue,
  ) {}

  // ─── List ──────────────────────────────────────────────────────────────────

  async listShipments(dto: ListShipmentsDto) {
    const {
      status,
      type,
      dateFrom,
      dateTo,
      orderId,
      page = 1,
      limit = 20,
    } = dto;

    const where: any = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (orderId) {
      const order = await this.prisma.order.findFirst({
        where: { OR: [{ id: orderId }, { orderId }] },
        select: { id: true },
      });
      if (!order) {
        return {
          success: true,
          data: {
            shipments: [],
            total: 0,
            page,
            limit,
            totalPages: 0,
          },
        };
      }
      where.orderId = order.id;
    }
    if (dateFrom || dateTo) {
      where.scheduledDate = {};
      if (dateFrom) where.scheduledDate.gte = new Date(dateFrom);
      if (dateTo) where.scheduledDate.lte = new Date(dateTo);
    }

    const [shipments, total] = await Promise.all([
      this.prisma.shipment.findMany({
        where,
        include: {
          order: {
            select: {
              orderId: true,
              userId: true,
              orderListers: true,
              user: { select: { name: true, email: true } },
            },
          },
          attemptLogs: { orderBy: { attemptedAt: 'asc' } },
        },
        orderBy: { scheduledDate: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.shipment.count({ where }),
    ]);

    return {
      success: true,
      data: {
        shipments,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── Get single ────────────────────────────────────────────────────────────

  async getShipment(id: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            user: { select: { name: true, email: true } },
            orderItems: { include: { product: { select: { name: true } } } },
          },
        },
        attemptLogs: { orderBy: { attemptedAt: 'asc' } },
      },
    });

    if (!shipment) throw new NotFoundException('Shipment not found');
    return { success: true, data: shipment };
  }

  // ─── Get shipments for an order ────────────────────────────────────────────

  async getOrderShipments(orderId: string) {
    // Accept both internal UUID and human-readable orderId
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: orderId }, { orderId }] },
      select: { id: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const shipments = await this.prisma.shipment.findMany({
      where: { orderId: order.id },
      include: { attemptLogs: { orderBy: { attemptedAt: 'asc' } } },
      orderBy: { scheduledDate: 'asc' },
    });

    return { success: true, data: shipments };
  }

  // ─── Cancel ────────────────────────────────────────────────────────────────

  async cancelShipment(id: string) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id } });
    if (!shipment) throw new NotFoundException('Shipment not found');

    if (shipment.status !== 'PENDING') {
      throw new BadRequestException(
        `Only PENDING shipments can be cancelled. Current status: ${shipment.status}`,
      );
    }

    await this.prisma.shipment.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    return { success: true, message: 'Shipment cancelled' };
  }

  // ─── Manual redispatch (admin) ─────────────────────────────────────────────

  async redispatch(id: string) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id } });
    if (!shipment) throw new NotFoundException('Shipment not found');

    if (shipment.status !== 'DISPATCH_FAILED') {
      throw new BadRequestException(
        `Only DISPATCH_FAILED shipments can be redispatched. Current status: ${shipment.status}`,
      );
    }

    // Reset attempt counter so the processor treats this as a fresh 3-attempt cycle
    await this.prisma.shipment.update({
      where: { id },
      data: { status: 'PENDING', dispatchAttempts: 0 },
    });

    // Atomically lock
    const locked = await this.prisma.shipment.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'DISPATCHING' },
    });
    if (locked.count === 0) {
      throw new ConflictException(
        'Shipment was already picked up by another process',
      );
    }

    await this.dispatchQueue.add(
      'dispatch',
      { shipmentId: id },
      { attempts: 1 },
    );

    return { success: true, message: 'Redispatch enqueued successfully' };
  }

  // ─── Tracking (polls provider) ─────────────────────────────────────────────

  async getTracking(id: string) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id } });
    if (!shipment) throw new NotFoundException('Shipment not found');

    return {
      success: true,
      data: {
        shipmentId: shipment.id,
        status: shipment.status,
        providerShipmentId: shipment.providerShipmentId,
        providerTrackingUrl: shipment.providerTrackingUrl,
        trackingId: shipment.trackingId,
        dispatchedAt: shipment.dispatchedAt,
        scheduledDate: shipment.scheduledDate,
        type: shipment.type,
      },
    };
  }

  // ─── Cancel all shipments for an order (used on order cancellation) ────────

  async cancelOrderShipments(orderId: string) {
    await this.prisma.shipment.updateMany({
      where: { orderId, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
  }
}
