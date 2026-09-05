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
import { ReconcileManualShipmentDto } from './dto/reconcile-manual-shipment.dto';
import { DispatchNowShipmentDto } from './dto/dispatch-now-shipment.dto';
import { ShipmentQuoteService } from './shipment-quote.service';
import { selectOrderItemsForShipmentLeg } from './order-items-for-shipment-leg';
import { isRelistedDispatchShippingTier } from 'src/constants/relisted-dispatch-shipping';
import {
  buildDefaultDispatchWindow,
  buildDefaultReturnDispatchWindow,
} from 'src/utils/dispatch-windows';
import { startOfDay } from 'date-fns';
import { formatDispatchWindowLagos } from 'src/module/shipment/dispatch-window-format';
import { sendShipmentLegStatusNotification } from './shipment-status-notifications';
import { buildShippingEmailTrackingFields } from './shipment-tracking-url.util';
import { PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY } from 'src/utils/product-attachment-upload-order';
import { formatAdminReturnRequest } from '../order/admin-return-request.format';

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
    private readonly shipmentQuoteService: ShipmentQuoteService,
  ) {}

  // ─── List ──────────────────────────────────────────────────────────────────

  private async buildListShipmentsWhere(
    dto: Pick<
      ListShipmentsDto,
      'status' | 'type' | 'dateFrom' | 'dateTo' | 'orderId' | 'manualFulfillment'
    >,
  ): Promise<{ where: Record<string, unknown>; orderMissing: boolean }> {
    const { status, type, dateFrom, dateTo, orderId, manualFulfillment } = dto;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (type) where.type = type;
    if (orderId) {
      const order = await this.prisma.order.findFirst({
        where: { OR: [{ id: orderId }, { orderId }] },
        select: { id: true },
      });
      if (!order) {
        return { where, orderMissing: true };
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
      if (dateFrom) {
        (where.scheduledDate as Record<string, Date>).gte = new Date(
          `${dateFrom}T00:00:00.000Z`,
        );
      }
      if (dateTo) {
        (where.scheduledDate as Record<string, Date>).lte = new Date(
          `${dateTo}T23:59:59.999Z`,
        );
      }
    }

    return { where, orderMissing: false };
  }

  async listShipments(dto: ListShipmentsDto) {
    const { page = 1, limit = 20 } = dto;
    const { where, orderMissing } = await this.buildListShipmentsWhere(dto);
    if (orderMissing) {
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

  async getShipmentCosts(dto: ListShipmentsDto) {
    const providerF = String(dto.provider ?? 'all').trim().toLowerCase();
    const courierF = String(dto.courier ?? 'all').trim().toLowerCase();
    const empty = {
      totalKobo: 0,
      count: 0,
      trend: [] as { month: string; kobo: number; count: number }[],
      groups: [] as { key: string; label: string; kobo: number; count: number }[],
      providers: [] as string[],
      couriers: [] as string[],
    };
    const { where, orderMissing } = await this.buildListShipmentsWhere(dto);
    if (orderMissing) return { success: true, data: empty };

    const rows = await this.prisma.shipment.findMany({
      where,
      select: {
        scheduledDate: true,
        pricingTier: true,
        pickupPartner: true,
        manualFulfillment: true,
        shipmentCharge: true,
        pickupCharge: true,
        vatCharge: true,
        actualFulfillmentCostKobo: true,
      },
    });

    const costKobo = (r: (typeof rows)[0]) =>
      r.actualFulfillmentCostKobo != null
        ? r.actualFulfillmentCostKobo
        : (r.shipmentCharge ?? 0) + (r.pickupCharge ?? 0) + (r.vatCharge ?? 0);
    const providerOf = (r: (typeof rows)[0]) => {
      if (r.manualFulfillment) return 'manual';
      const t = String(r.pricingTier ?? '').toLowerCase();
      if (t === 'shipbubble' || t.startsWith('shipbubble:')) return 'shipbubble';
      if (t === 'chowdeck_relay') return 'chowdeck_relay';
      return 'topship';
    };
    const courierOf = (r: (typeof rows)[0]) => {
      if (r.manualFulfillment) return 'relisted';
      const t = String(r.pricingTier ?? '').toLowerCase();
      if (t.startsWith('shipbubble:')) return t.slice('shipbubble:'.length);
      if (t) return t;
      return String(r.pickupPartner ?? '').toLowerCase() || 'unknown';
    };
    const label = (key: string) =>
      key === 'topship'
        ? 'Topship'
        : key === 'shipbubble'
          ? 'Shipbubble'
          : key === 'chowdeck_relay'
            ? 'Chowdeck Relay'
            : key === 'manual'
              ? 'Relisted dispatch'
              : key.charAt(0).toUpperCase() + key.slice(1);

    const providers = [...new Set(rows.map(providerOf))];
    const couriers = [
      ...new Set(
        rows
          .filter((r) => providerF === 'all' || providerOf(r) === providerF)
          .map(courierOf),
      ),
    ];
    const filtered = rows.filter(
      (r) =>
        (providerF === 'all' || providerOf(r) === providerF) &&
        (courierF === 'all' || courierOf(r) === courierF),
    );

    const trendMap = new Map<string, { month: string; kobo: number; count: number }>();
    const groupMap = new Map<string, { key: string; label: string; kobo: number; count: number }>();
    let totalKobo = 0;
    for (const r of filtered) {
      const kobo = costKobo(r);
      totalKobo += kobo;
      const month = r.scheduledDate.toISOString().slice(0, 7);
      const t = trendMap.get(month) ?? { month, kobo: 0, count: 0 };
      t.kobo += kobo;
      t.count += 1;
      trendMap.set(month, t);
      const gKey =
        providerF !== 'all' || courierF !== 'all' ? courierOf(r) : providerOf(r);
      const g = groupMap.get(gKey) ?? { key: gKey, label: label(gKey), kobo: 0, count: 0 };
      g.kobo += kobo;
      g.count += 1;
      groupMap.set(gKey, g);
    }

    return {
      success: true,
      data: {
        totalKobo,
        count: filtered.length,
        trend: [...trendMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
        groups: [...groupMap.values()].sort((a, b) => b.kobo - a.kobo),
        providers,
        couriers,
      },
    };
  }

  // ─── Get single ────────────────────────────────────────────────────────────

  async getShipment(id: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        returnRequests: { orderBy: { createdAt: 'desc' }, take: 1 },
        order: {
          include: {
            user: { select: { name: true, email: true } },
            orderItems: { include: shipmentOrderItemProductInclude },
            returnRequests: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
        attemptLogs: { orderBy: { attemptedAt: 'asc' } },
      },
    });

    if (!shipment) throw new NotFoundException('Shipment not found');

    const withItems = this.withLegOrderItems(shipment);
    const linkedReturnRequest =
      shipment.returnRequests?.[0] ??
      shipment.order?.returnRequests?.[0] ??
      null;

    return {
      success: true,
      data: {
        ...withItems,
        returnRequest: formatAdminReturnRequest(linkedReturnRequest),
      },
    };
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

  // ─── Rate preview (admin) ──────────────────────────────────────────────────

  async getRatePreview(id: string, forImmediate = false) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id } });
    if (!shipment) throw new NotFoundException('Shipment not found');

    if (!['PENDING', 'DISPATCH_FAILED'].includes(shipment.status)) {
      throw new BadRequestException(
        `Rate preview is only available for PENDING or DISPATCH_FAILED shipments. Current status: ${shipment.status}`,
      );
    }

    const data = await this.shipmentQuoteService.previewRates(id, forImmediate);
    return { success: true, data };
  }

  // ─── Dispatch now / book carrier (admin) ───────────────────────────────────

  async dispatchNow(id: string, dto: DispatchNowShipmentDto = {}) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id } });
    if (!shipment) throw new NotFoundException('Shipment not found');

    if (!['PENDING', 'DISPATCH_FAILED'].includes(shipment.status)) {
      throw new BadRequestException(
        `Only PENDING or DISPATCH_FAILED shipments can be dispatched now. Current status: ${shipment.status}`,
      );
    }

    if (shipment.manualFulfillment) {
      const tier = String(dto.pricingTier ?? '').trim();
      if (!tier || isRelistedDispatchShippingTier(tier)) {
        throw new BadRequestException(
          'Select a carrier pricing tier to book this Relisted dispatch shipment.',
        );
      }
    }

    if (shipment.type === 'RETURN') {
      const returnRequest = await this.prisma.returnRequest.findFirst({
        where: { orderId: shipment.orderId, shipmentId: id },
      });
      if (!returnRequest) {
        throw new BadRequestException(
          'Return shipments require a renter return request before carrier booking.',
        );
      }
    }

    const updateWindow = dto.updateWindow !== false;
    const forImmediate =
      updateWindow && this.isScheduledInFuture(shipment);
    const updateData: Record<string, unknown> = {};

    if (shipment.status === 'DISPATCH_FAILED') {
      updateData.dispatchAttempts = 0;
    }

    if (updateWindow && forImmediate) {
      const now = new Date();
      const window =
        shipment.type === 'RETURN'
          ? buildDefaultReturnDispatchWindow(now)
          : buildDefaultDispatchWindow(now);
      updateData.scheduledWindowStart = window.start;
      updateData.scheduledWindowEnd = window.end;
      updateData.scheduledDate = startOfDay(window.start);
    }

    const tierInput = String(dto.pricingTier ?? '').trim();
    if (tierInput) {
      const preview = await this.shipmentQuoteService.previewRates(
        id,
        forImmediate || updateWindow,
      );
      const matched = this.shipmentQuoteService.findTierInPreview(
        preview.tiers,
        tierInput,
      );
      if (!matched) {
        throw new BadRequestException(
          `Selected pricing tier "${tierInput}" is not available for this shipment.`,
        );
      }
      if (isRelistedDispatchShippingTier(matched.pricingTier)) {
        throw new BadRequestException(
          'Cannot book Relisted dispatch through carrier dispatch. Use manual complete instead.',
        );
      }
      const charges = this.shipmentQuoteService.tierToShipmentCharges(matched);
      const tierChanged =
        String(shipment.pricingTier ?? '').trim().toLowerCase() !==
        charges.pricingTier.trim().toLowerCase();
      updateData.pricingTier = charges.pricingTier;
      updateData.shipmentCharge = charges.shipmentCharge;
      updateData.pickupCharge = charges.pickupCharge;
      updateData.vatCharge = charges.vatCharge;
      updateData.pickupId = charges.pickupId;
      updateData.pickupPartner = charges.pickupPartner;
      updateData.manualFulfillment = false;
      if (tierChanged) {
        updateData.providerShipmentId = null;
      }
    } else if (shipment.manualFulfillment) {
      throw new BadRequestException(
        'Relisted dispatch shipments require a carrier pricing tier.',
      );
    }

    if (Object.keys(updateData).length > 0) {
      await this.prisma.shipment.update({
        where: { id },
        data: updateData,
      });
    }

    if (shipment.status === 'DISPATCH_FAILED') {
      await this.prisma.shipment.update({
        where: { id },
        data: { status: 'PENDING' },
      });
    }

    await this.enqueueDispatchJob(id);

    return {
      success: true,
      message: 'Dispatch enqueued successfully',
    };
  }

  // ─── Manual redispatch (admin) ─────────────────────────────────────────────

  async redispatch(id: string) {
    const shipment = await this.prisma.shipment.findUnique({ where: { id } });
    if (!shipment) throw new NotFoundException('Shipment not found');

    if (shipment.manualFulfillment) {
      throw new BadRequestException(
        'This shipment uses Relisted dispatch. Book a carrier from the admin shipment detail instead of redispatch.',
      );
    }

    if (shipment.status !== 'DISPATCH_FAILED') {
      throw new BadRequestException(
        `Only DISPATCH_FAILED shipments can be redispatched. Current status: ${shipment.status}`,
      );
    }

    await this.prisma.shipment.update({
      where: { id },
      data: { status: 'PENDING', dispatchAttempts: 0 },
    });

    await this.enqueueDispatchJob(id);

    return { success: true, message: 'Redispatch enqueued successfully' };
  }

  private isScheduledInFuture(
    shipment: Pick<
      import('@prisma/client').Shipment,
      'scheduledWindowStart' | 'scheduledDate'
    >,
  ): boolean {
    const now = Date.now();
    const start = shipment.scheduledWindowStart
      ? new Date(shipment.scheduledWindowStart).getTime()
      : new Date(shipment.scheduledDate).getTime();
    return start > now;
  }

  private async enqueueDispatchJob(id: string) {
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
  }

  // ─── Manual Relisted dispatch: mark booked / sent (no Topship) ─────────────

  async completeManualFulfillment(id: string, dto: ManualCompleteShipmentDto) {
    const shipment = await this.loadShipmentForManualOps(id);

    if (!shipment.manualFulfillment) {
      throw new BadRequestException(
        'Only Relisted dispatch (manual fulfillment) shipments can be completed this way. Use reconcile manual for courier-tier legs handled outside the carrier.',
      );
    }

    if (!['PENDING', 'DISPATCHING'].includes(shipment.status)) {
      throw new BadRequestException(
        `Shipment must be PENDING or DISPATCHING. Current status: ${shipment.status}`,
      );
    }

    await this.applyManualDispatched(id, dto);
    await this.syncOrderAfterManualDispatch(shipment.orderId);
    await this.notifyManualDispatched(shipment, dto);

    return {
      success: true,
      message: 'Shipment marked as dispatched',
    };
  }

  // ─── Reconcile courier-tier leg handled outside automated booking ──────────

  async reconcileManualFulfillment(id: string, dto: ReconcileManualShipmentDto) {
    const shipment = await this.loadShipmentForManualOps(id);

    if (shipment.manualFulfillment) {
      throw new BadRequestException(
        'This shipment is already manual fulfillment. Use mark dispatched instead.',
      );
    }

    if (!['PENDING', 'DISPATCHING', 'DISPATCH_FAILED'].includes(shipment.status)) {
      throw new BadRequestException(
        `Only PENDING, DISPATCHING, or DISPATCH_FAILED shipments can be reconciled. Current status: ${shipment.status}`,
      );
    }

    const trackingId =
      dto.trackingId !== undefined ? dto.trackingId.trim() || null : undefined;
    const trackingUrl =
      dto.trackingUrl !== undefined ? dto.trackingUrl.trim() || null : undefined;
    const note =
      dto.adminReconcileNote !== undefined
        ? dto.adminReconcileNote.trim() || null
        : undefined;

    await this.prisma.shipment.update({
      where: { id },
      data: {
        status: 'DISPATCHED',
        dispatchedAt: new Date(),
        manualFulfillment: true,
        reconciledAsManualAt: new Date(),
        providerShipmentId: null,
        ...(trackingId !== undefined ? { trackingId } : {}),
        ...(trackingUrl !== undefined ? { providerTrackingUrl: trackingUrl } : {}),
        ...(dto.actualFulfillmentCostKobo !== undefined
          ? { actualFulfillmentCostKobo: dto.actualFulfillmentCostKobo }
          : {}),
        ...(note !== undefined ? { adminReconcileNote: note } : {}),
      },
    });

    await this.syncOrderAfterManualDispatch(shipment.orderId);
    await this.notifyManualDispatched(shipment, dto, { reconciled: true });

    return {
      success: true,
      message: 'Shipment marked as dispatched',
    };
  }

  private async loadShipmentForManualOps(id: string) {
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
    return shipment;
  }

  private async applyManualDispatched(
    id: string,
    dto: Pick<ManualCompleteShipmentDto, 'trackingId' | 'trackingUrl'>,
  ) {
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
  }

  private async syncOrderAfterManualDispatch(orderId: string) {
    try {
      await syncOrderStatusFromShipments(this.prisma, orderId);
    } catch (syncErr: any) {
      console.warn(
        `[ShipmentService] Order status sync after manual dispatch failed for ${orderId}: ${syncErr?.message ?? syncErr}`,
      );
    }
  }

  private async notifyManualDispatched(
    shipment: Awaited<ReturnType<typeof this.loadShipmentForManualOps>>,
    dto: Pick<ManualCompleteShipmentDto, 'trackingId' | 'trackingUrl'>,
    options?: { reconciled?: boolean },
  ) {
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
    const trackingFields = buildShippingEmailTrackingFields(
      {
        pricingTier: shipment.pricingTier,
        providerTrackingUrl: turl,
        trackingId: tid,
        providerShipmentId: shipment.providerShipmentId,
      },
      { trackingNumber: tid ?? undefined, trackingUrl: turl ?? undefined },
    );

    if (!customer?.id || !humanOrderId) return;

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
        message: `Your item is being dispatched. Track here: ${trackingFields.trackingUrl ?? turl ?? 'Tracking link coming soon'}`,
        notificationType: 'SHIPMENT_DISPATCHED',
        emailData: {
          email: customer.email,
          userName: customer.name,
          orderId: humanOrderId,
          status: 'Dispatched',
          ...trackingFields,
          estimatedDelivery: undefined,
        },
      };
    } else if (isOutbound) {
      notify = {
        title: '🚚 Your rental is on its way!',
        message: `Your item is being dispatched. Track here: ${trackingFields.trackingUrl ?? turl ?? 'Tracking link coming soon'}`,
        notificationType: 'SHIPMENT_DISPATCHED',
        emailData: {
          email: customer.email,
          userName: customer.name,
          orderId: humanOrderId,
          status: 'Dispatched',
          ...trackingFields,
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
          ...trackingFields,
          estimatedDelivery: undefined,
          ...(wStart && wEnd
            ? {
                emailSubject: 'Your return is booked. Have your item ready.',
                emailHeading: 'Return booked with courier',
                pickupWindowSummary: formatDispatchWindowLagos(wStart, wEnd),
                extraNote:
                  'The carrier is booked for this window. The rider may not have picked up yet. Watch for an in-transit update next.',
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
          reconciledAsManual: options?.reconciled ?? false,
        },
        sendEmail: true,
        emailData: notify.emailData,
      });
    }
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
          pricingTier: shipment.pricingTier,
          providerTrackingUrl: shipment.providerTrackingUrl,
          providerShipmentId: shipment.providerShipmentId,
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
