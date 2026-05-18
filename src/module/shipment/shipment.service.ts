import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { syncOrderStatusFromShipments } from 'src/module/order/order-shipment-status.sync';
import { ListShipmentsDto } from './dto/list-shipments.dto';
import { ManualCompleteShipmentDto } from './dto/manual-complete-shipment.dto';
import { selectOrderItemsForShipmentLeg } from './order-items-for-shipment-leg';
import { formatDispatchWindowLagos } from 'src/module/shipment/dispatch-window-format';
import { sendShipmentLegStatusNotification } from './shipment-status-notifications';
import { PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY } from 'src/utils/product-attachment-upload-order';

const shipmentOrderItemProductInclude = {
  product: {
    select: {
      name: true,
      attachments: {
        include: {
          uploads: {
            orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
            select: { id: true, url: true, displayOrder: true },
          },
        },
      },
    },
  },
} as const;

@Injectable()
export class ShipmentService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('shipment-dispatch') private readonly dispatchQueue: Queue,
    private readonly notificationService: NotificationService,
  ) {}

  // ─── List ──────────────────────────────────────────────────────────────────

  async listShipments(dto: ListShipmentsDto) {
    const {
      status,
      type,
      dateFrom,
      dateTo,
      orderId,
      manualFulfillment,
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
    if (manualFulfillment === true) {
      where.manualFulfillment = true;
    } else if (manualFulfillment === false) {
      where.manualFulfillment = false;
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
              orderItems: { include: shipmentOrderItemProductInclude },
            },
          },
          attemptLogs: { orderBy: { attemptedAt: 'asc' } },
        },
        orderBy: { scheduledDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.shipment.count({ where }),
    ]);

    return {
      success: true,
      data: {
        shipments: shipments.map((s) => this.withLegOrderItems(s)),
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
            orderItems: { include: shipmentOrderItemProductInclude },
          },
        },
        attemptLogs: { orderBy: { attemptedAt: 'asc' } },
      },
    });

    if (!shipment) throw new NotFoundException('Shipment not found');

    return { success: true, data: this.withLegOrderItems(shipment) };
  }

  private withLegOrderItems<
    T extends {
      id: string;
      type: import('@prisma/client').ShipmentType;
      order?: { orderItems?: unknown[] } | null;
    },
  >(shipment: T): T {
    const legItems =
      shipment.order?.orderItems?.length &&
      selectOrderItemsForShipmentLeg(
        shipment.id,
        shipment.type,
        shipment.order.orderItems as Parameters<
          typeof selectOrderItemsForShipmentLeg
        >[2],
      );
    if (!legItems || !shipment.order) return shipment;
    return {
      ...shipment,
      order: { ...shipment.order, orderItems: legItems },
    };
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

    if (shipment.manualFulfillment) {
      throw new BadRequestException(
        'This shipment uses Relisted dispatch. Mark it dispatched from the admin shipment detail instead of redispatch.',
      );
    }

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

  // ─── Manual Relisted dispatch: mark booked / sent (no Topship) ─────────────

  async completeManualFulfillment(id: string, dto: ManualCompleteShipmentDto) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');

    if (!shipment.manualFulfillment) {
      throw new BadRequestException(
        'Only Relisted dispatch (manual fulfillment) shipments can be completed this way.',
      );
    }

    if (!['PENDING', 'DISPATCHING'].includes(shipment.status)) {
      throw new BadRequestException(
        `Shipment must be PENDING or DISPATCHING. Current status: ${shipment.status}`,
      );
    }

    const data: {
      status: 'DISPATCHED';
      dispatchedAt: Date;
      trackingId?: string | null;
      providerTrackingUrl?: string | null;
    } = {
      status: 'DISPATCHED',
      dispatchedAt: new Date(),
    };
    if (dto.trackingId !== undefined) {
      data.trackingId = dto.trackingId.trim() || null;
    }
    if (dto.trackingUrl !== undefined) {
      data.providerTrackingUrl = dto.trackingUrl.trim() || null;
    }

    await this.prisma.shipment.update({
      where: { id },
      data,
    });

    try {
      await syncOrderStatusFromShipments(this.prisma, shipment.orderId);
    } catch (syncErr: any) {
      console.warn(
        `[ShipmentService] Order status sync after manual complete failed for ${shipment.orderId}: ${syncErr?.message ?? syncErr}`,
      );
    }

    const customer = shipment.order?.user;
    const humanOrderId = shipment.order?.orderId;
    const tid =
      dto.trackingId !== undefined
        ? dto.trackingId.trim() || null
        : shipment.trackingId;
    const turl =
      dto.trackingUrl !== undefined
        ? dto.trackingUrl.trim() || null
        : shipment.providerTrackingUrl;

    if (customer?.id && humanOrderId) {
      const isOutbound = shipment.type === 'OUTBOUND';
      const isReturn = shipment.type === 'RETURN';
      const isResale = shipment.type === 'RESALE';

      type NotifyPayload = {
        title: string;
        message: string;
        notificationType: string;
        emailData: Record<string, unknown>;
      };

      let notify: NotifyPayload | null = null;

      if (isResale) {
        notify = {
          title: '🚚 Your purchase is on its way!',
          message: `Your item is being dispatched. Track here: ${turl ?? 'Tracking link coming soon'}`,
          notificationType: 'SHIPMENT_DISPATCHED',
          emailData: {
            email: customer.email,
            userName: customer.name,
            orderId: humanOrderId,
            status: 'Dispatched',
            trackingNumber: tid ?? undefined,
            trackingUrl: turl ?? undefined,
            estimatedDelivery: undefined,
          },
        };
      } else if (isOutbound) {
        notify = {
          title: '🚚 Your rental is on its way!',
          message: `Your item is being dispatched. Track here: ${turl ?? 'Tracking link coming soon'}`,
          notificationType: 'SHIPMENT_DISPATCHED',
          emailData: {
            email: customer.email,
            userName: customer.name,
            orderId: humanOrderId,
            status: 'Dispatched',
            trackingNumber: tid ?? undefined,
            trackingUrl: turl ?? undefined,
            estimatedDelivery: undefined,
          },
        };
      } else if (isReturn) {
        const wStart = shipment.scheduledWindowStart
          ? new Date(shipment.scheduledWindowStart)
          : null;
        const wEnd = shipment.scheduledWindowEnd
          ? new Date(shipment.scheduledWindowEnd)
          : null;
        const windowLine =
          wStart && wEnd
            ? ` Pickup window: ${formatDispatchWindowLagos(wStart, wEnd)}.`
            : '';
        notify = {
          title: '📦 Return booked. Get your item ready.',
          message: `Your return is booked with the carrier.${windowLine} Have the package ready during your pickup window. You will get another update when the rider collects it or when it is on the way to the lister.`,
          notificationType: 'RETURN_DISPATCHED',
          emailData: {
            email: customer.email,
            userName: customer.name,
            orderId: humanOrderId,
            status: 'Scheduled for dispatch (pickup not started yet)',
            trackingNumber: tid ?? undefined,
            trackingUrl: turl ?? undefined,
            estimatedDelivery: undefined,
            ...(wStart && wEnd
              ? {
                  emailSubject: 'Your return is booked. Have your item ready.',
                  emailHeading: 'Return booked with courier',
                  pickupWindowSummary: formatDispatchWindowLagos(wStart, wEnd),
                  extraNote:
                    'Relisted arranged this leg manually. Have your item ready for this window. Watch for an in-transit update next.',
                }
              : {
                  emailSubject: 'Your return is booked. Have your item ready.',
                  emailHeading: 'Return booked with courier',
                  extraNote:
                    'Have your item ready for pickup. You will get another update when collection starts or when the parcel is in transit.',
                }),
          },
        };
      }

      if (notify) {
        await this.notificationService.createNotification({
          userId: customer.id,
          title: notify.title,
          message: notify.message,
          type: notify.notificationType,
          metadata: {
            shipmentId: shipment.id,
            orderId: humanOrderId,
            trackingUrl: turl,
            manualFulfillment: true,
          },
          sendEmail: true,
          emailData: notify.emailData,
        });
      }
    }

    return {
      success: true,
      message: 'Shipment marked as dispatched',
    };
  }

  // ─── Manual Relisted dispatch: mark delivered (no carrier COMPLETED event) ─

  async markManualDelivered(id: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    if (!shipment) throw new NotFoundException('Shipment not found');

    if (!shipment.manualFulfillment) {
      throw new BadRequestException(
        'Only Relisted dispatch (manual fulfillment) shipments can be marked delivered this way.',
      );
    }

    if (!['DISPATCHED', 'IN_TRANSIT'].includes(shipment.status)) {
      throw new BadRequestException(
        `Shipment must be DISPATCHED or IN_TRANSIT. Current status: ${shipment.status}`,
      );
    }

    await this.prisma.shipment.update({
      where: { id },
      data: { status: 'COMPLETED' },
    });

    try {
      await syncOrderStatusFromShipments(this.prisma, shipment.orderId);
    } catch (syncErr: any) {
      console.warn(
        `[ShipmentService] Order status sync after manual delivered failed for ${shipment.orderId}: ${syncErr?.message ?? syncErr}`,
      );
    }

    try {
      await sendShipmentLegStatusNotification(
        this.notificationService,
        {
          id: shipment.id,
          type: shipment.type,
          trackingId: shipment.trackingId,
          order: shipment.order
            ? {
                orderId: shipment.order.orderId,
                user: shipment.order.user,
              }
            : null,
        },
        'COMPLETED',
      );
    } catch (notifyErr: any) {
      console.warn(
        `[ShipmentService] Delivery notification failed for ${id}: ${notifyErr?.message ?? notifyErr}`,
      );
    }

    return {
      success: true,
      message: 'Shipment marked as delivered; order status updated',
    };
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
