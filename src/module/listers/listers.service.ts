import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { userEntity } from '../auth/auth.types';
import { DisputeStatus, Message, OrderStatus, ProductStatus, Role } from '@prisma/client';
import { differenceInSeconds } from 'date-fns';

const CURRENCY = 'NGN';
const APPROVAL_WINDOW_MINUTES = 15;

// Order status mapping for listers API
const ORDER_STATUS_TO_LABEL: Record<OrderStatus, string> = {
  [OrderStatus.PROCESSING]: 'Pending Approval',
  [OrderStatus.ACCEPTED]: 'Ongoing',
  [OrderStatus.CONFIRMED]: 'Ongoing',
  [OrderStatus.IN_TRANSIT]: 'Ongoing',
  [OrderStatus.DELIVERED]: 'Ongoing',
  [OrderStatus.ACTIVE]: 'Ongoing',
  [OrderStatus.RETURN_DUE]: 'Ongoing',
  [OrderStatus.RETURNED]: 'Completed',
  [OrderStatus.COMPLETED]: 'Completed',
  [OrderStatus.CANCELLED]: 'Cancelled',
  [OrderStatus.REJECTED]: 'Cancelled',
};

const ORDER_STATUS_TO_API: Record<OrderStatus, string> = {
  [OrderStatus.PROCESSING]: 'pending_approval',
  [OrderStatus.ACCEPTED]: 'ongoing',
  [OrderStatus.CONFIRMED]: 'ongoing',
  [OrderStatus.IN_TRANSIT]: 'ongoing',
  [OrderStatus.DELIVERED]: 'ongoing',
  [OrderStatus.ACTIVE]: 'ongoing',
  [OrderStatus.RETURN_DUE]: 'ongoing',
  [OrderStatus.RETURNED]: 'completed',
  [OrderStatus.COMPLETED]: 'completed',
  [OrderStatus.CANCELLED]: 'cancelled',
  [OrderStatus.REJECTED]: 'cancelled',
};

const RENTAL_STATUS_TO_LABEL: Record<string, string> = {
  DELIVERED: 'Delivered',
  RETURN_DUE: 'Return Due',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  RETURNED: 'Returned',
};

const RENTAL_STATUS_TO_TYPE: Record<string, string> = {
  DELIVERED: 'delivered',
  RETURN_DUE: 'return_due',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  RETURNED: 'returned',
};

const PROGRESS_STEPS = [
  { id: 1, label: 'Approved', icon: 'check-circle', orderStatus: OrderStatus.ACCEPTED },
  { id: 2, label: 'Dispatched', icon: 'truck', orderStatus: OrderStatus.CONFIRMED },
  { id: 3, label: 'In Transit', icon: 'package', orderStatus: OrderStatus.IN_TRANSIT },
  { id: 4, label: 'Delivered', icon: 'home', orderStatus: OrderStatus.DELIVERED },
  { id: 5, label: 'Return Due', icon: 'reply', orderStatus: OrderStatus.RETURN_DUE },
  { id: 6, label: 'Completed', icon: 'smile', orderStatus: OrderStatus.COMPLETED },
];

@Injectable()
export class ListersService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /api/listers/inventory/top-items */
  async getTopItems(user: userEntity, limit: number = 5) {
    try {
      const products = await this.prisma.product.findMany({
        where: {
          curatorId: user.id,
          productVerified: true,
          status: { in: [ProductStatus.AVAILABLE, ProductStatus.UNAVAILABLE] },
        },
        include: {
          _count: { select: { rentals: true, reviews: true } },
          attachments: {
            include: {
              uploads: { take: 1, select: { url: true } },
            },
          },
          category: { select: { name: true } },
          reviews: { select: { rating: true } },
        },
        take: Math.min(limit * 3, 100),
      });

      const sorted = [...products].sort(
        (a, b) => (b._count?.rentals ?? 0) - (a._count?.rentals ?? 0),
      );
      const topSlice = sorted.slice(0, Math.min(limit, 50));

      const topItems = topSlice.map((p) => {
        const avgRating =
          p.reviews?.length > 0
            ? p.reviews.reduce((a, r) => a + r.rating, 0) / p.reviews.length
            : 0;
        return {
          id: p.id,
          name: p.name,
          image:
            p.attachments?.uploads?.[0]?.url ??
            'https://via.placeholder.com/300x300?text=No+Image',
          rentalsCount: p._count?.rentals ?? 0,
          price: p.originalValue ?? p.dailyPrice * 10,
          currency: CURRENCY,
          availability:
            p.status === ProductStatus.AVAILABLE && p.isActive ? 'available' : 'unavailable',
          category: p.category?.name ?? 'Uncategorized',
          condition: p.condition ?? 'Good',
          rating: Math.round(avgRating * 10) / 10 || 0,
          reviews: p._count?.reviews ?? 0,
        };
      });

      return {
        success: true,
        data: {
          topItems,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (e) {
      console.error('getTopItems error:', e);
      throw new InternalServerErrorException('Failed to fetch top items');
    }
  }

  /** GET /api/listers/rentals/recent */
  async getRecentRentals(
    user: userEntity,
    page: number = 1,
    limit: number = 10,
    status: string = 'all',
  ) {
    try {
      const skip = (page - 1) * limit;
      const where: {
        curatorId: string;
        order?: { status: { in: OrderStatus[] } };
      } = {
        curatorId: user.id,
      };
      if (status === 'delivered') {
        where.order = { status: { in: [OrderStatus.DELIVERED] } };
      } else if (status === 'return_due') {
        where.order = { status: { in: [OrderStatus.RETURN_DUE] } };
      }

      const [rentals, total] = await Promise.all([
        this.prisma.rental.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            order: { select: { orderId: true, status: true } },
            product: {
              select: {
                id: true,
                name: true,
                measurement: true,
                color: true,
                attachments: {
                  include: {
                    uploads: { take: 1, select: { url: true } },
                  },
                },
              },
            },
            user: {
              select: {
                id: true,
                name: true,
                profile: {
                  select: {
                    avatarUpload: { select: { url: true } },
                  },
                },
              },
            },
          },
        }),
        this.prisma.rental.count({ where }),
      ]);

      const recentRentals = rentals.map((r) => {
        const orderStatus = r.order?.status ?? OrderStatus.PROCESSING;
        return {
          id: r.id,
          orderId: `#${r.order?.orderId ?? 'N/A'}`,
          item: {
            id: r.product.id,
            name: r.product.name,
            size: r.product.measurement ?? 'N/A',
            color: r.product.color ?? 'N/A',
            image:
              r.product.attachments?.uploads?.[0]?.url ??
              'https://via.placeholder.com/300x300?text=No+Image',
          },
          dresser: {
            id: r.user.id,
            name: r.user.name,
            avatar:
              r.user.profile?.avatarUpload?.url ??
              'https://via.placeholder.com/64?text=U',
          },
          rentalPrice: r.totalAmount,
          currency: CURRENCY,
          returnDue: r.endDate.toISOString().split('T')[0],
          returnDueDate: r.endDate.toISOString(),
          status: RENTAL_STATUS_TO_LABEL[orderStatus] ?? orderStatus,
          statusType: RENTAL_STATUS_TO_TYPE[orderStatus] ?? orderStatus.toLowerCase(),
          rentalStartDate: r.startDate.toISOString().split('T')[0],
          rentalEndDate: r.endDate.toISOString().split('T')[0],
        };
      });

      const pages = Math.ceil(total / limit) || 1;
      return {
        success: true,
        data: {
          recentRentals,
          pagination: { total, page, limit, pages },
        },
      };
    } catch (e) {
      console.error('getRecentRentals error:', e);
      throw new InternalServerErrorException('Failed to fetch recent rentals');
    }
  }

  /** GET /api/listers/orders - orders that include at least one product from this lister */
  async getOrders(
    user: userEntity,
    status: string | undefined,
    page: number = 1,
    limit: number = 20,
    sort: string = '-createdAt',
  ) {
    try {
      const skip = (page - 1) * limit;
      const statusFilter = this.mapStatusToOrderStatuses(status);
      const [orderIds, summary] = await Promise.all([
        this.prisma.orderItem.findMany({
          where: {
            product: { curatorId: user.id },
            order: statusFilter ? { status: { in: statusFilter } } : undefined,
          },
          select: { orderId: true },
          distinct: ['orderId'],
        }),
        this.getOrdersSummary(user.id),
      ]);

      const uniqueOrderIds = [...new Set(orderIds.map((o) => o.orderId))];
      const orderWhere = {
        id: { in: uniqueOrderIds },
        ...(statusFilter && statusFilter.length > 0 ? { status: { in: statusFilter } } : {}),
      };

      const sortField = sort?.startsWith('-') ? sort.slice(1) : sort;
      const orderByField =
        sortField === 'createdAt' || !sortField
          ? 'createdAt'
          : 'createdAt';
      const [orders, total] = await Promise.all([
        this.prisma.order.findMany({
          where: orderWhere,
          skip,
          take: limit,
          orderBy:
            sort?.startsWith('-')
              ? { [orderByField]: 'desc' }
              : { [orderByField]: 'asc' },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                profile: {
                  select: { avatarUpload: { select: { url: true } } },
                },
              },
            },
            orderItems: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    measurement: true,
                    color: true,
                    attachments: {
                      include: {
                        uploads: { take: 1, select: { url: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
        this.prisma.order.count({ where: orderWhere }),
      ]);

      const ordersResponse = orders.map((o) => this.formatOrderForList(o));
      const pages = Math.ceil(total / limit) || 1;

      return {
        success: true,
        data: {
          orders: ordersResponse,
          pagination: { total, page, limit, pages },
          summary,
        },
      };
    } catch (e) {
      console.error('getOrders error:', e);
      throw new InternalServerErrorException('Failed to fetch orders');
    }
  }

  /** GET /api/listers/orders/:orderId */
  async getOrderById(user: userEntity, orderId: string) {
    try {
      await this.ensureOrderBelongsToLister(user.id, orderId);
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          rental: true,
          user: {
            select: {
              id: true,
              name: true,
              createdAt: true,
              profile: {
                select: { avatarUpload: { select: { url: true } } },
              },
            },
          },
          orderItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  measurement: true,
                  color: true,
                  originalValue: true,
                  dailyPrice: true,
                  attachments: {
                    include: {
                      uploads: { take: 1, select: { url: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      const reviewsCount = await this.prisma.review.count({
        where: { userId: order.userId },
      });
      const orderFormatted = this.formatOrderDetail(order, reviewsCount);
      return { success: true, data: { order: orderFormatted } };
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException) throw e;
      console.error('getOrderById error:', e);
      throw new InternalServerErrorException('Failed to fetch order');
    }
  }

  /** GET /api/listers/orders/:orderId/items */
  async getOrderItems(user: userEntity, orderId: string) {
    try {
      await this.ensureOrderBelongsToLister(user.id, orderId);
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          orderItems: {
            where: { product: { curatorId: user.id } },
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  measurement: true,
                  color: true,
                  condition: true,
                  originalValue: true,
                  dailyPrice: true,
                  attachments: {
                    include: {
                      uploads: { take: 1, select: { url: true } },
                    },
                  },
                },
              },
            },
          },
          rental: true,
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      const rental = order.rental;
      const items = order.orderItems.map((oi) => ({
        id: oi.product.id,
        name: oi.product.name,
        image:
          oi.product.attachments?.uploads?.[0]?.url ??
          'https://via.placeholder.com/300x300?text=No+Image',
        size: oi.product.measurement ?? 'N/A',
        color: oi.product.color ?? 'N/A',
        returnDue: rental
          ? rental.endDate.toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0],
        returnDueDate: rental?.endDate?.toISOString() ?? new Date().toISOString(),
        amount: (oi.pricePerDay ?? oi.product.dailyPrice) * oi.days,
        currency: CURRENCY,
        status: order.status.toLowerCase(),
        statusLabel: ORDER_STATUS_TO_LABEL[order.status] ?? order.status,
        rentalStartDate: rental?.startDate.toISOString().split('T')[0] ?? null,
        rentalEndDate: rental?.endDate.toISOString().split('T')[0] ?? null,
        itemValue: oi.product.originalValue ?? 0,
        condition: oi.product.condition ?? 'Good',
        canPreview: true,
      }));
      return {
        success: true,
        data: {
          items,
          orderId: order.id,
          totalItems: items.length,
        },
      };
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException) throw e;
      console.error('getOrderItems error:', e);
      throw new InternalServerErrorException('Failed to fetch order items');
    }
  }

  /** GET /api/listers/orders/:orderId/progress */
  async getOrderProgress(user: userEntity, orderId: string) {
    try {
      await this.ensureOrderBelongsToLister(user.id, orderId);
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, createdAt: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      const currentStep =
        order.status === OrderStatus.PROCESSING
          ? 'pending_approval'
          : ORDER_STATUS_TO_API[order.status] ?? order.status.toLowerCase();
      const stepIndex = PROGRESS_STEPS.findIndex(
        (s) => s.orderStatus === order.status || s.label.toLowerCase().replace(' ', '_') === currentStep,
      );
      const currentStepIndex =
        order.status === OrderStatus.PROCESSING ? 0 : Math.max(0, stepIndex);
      const steps = PROGRESS_STEPS.map((s, i) => ({
        id: s.id,
        label: s.label,
        icon: s.icon,
        completed: i < currentStepIndex,
        current: i === currentStepIndex,
        timestamp: null,
      }));
      const progressPercentage = Math.round((currentStepIndex / (PROGRESS_STEPS.length - 1)) * 100);
      return {
        success: true,
        data: {
          currentStep,
          currentStepIndex,
          steps,
          progressPercentage,
          orderId: order.id,
        },
      };
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException) throw e;
      console.error('getOrderProgress error:', e);
      throw new InternalServerErrorException('Failed to fetch order progress');
    }
  }

  /** POST /api/listers/orders/:orderId/approve
   *  Approve a pending order within the 15‑minute window.
   *  Dispatch / notification are left as placeholders.
   */
  async approveOrder(
    user: userEntity,
    orderId: string,
    notes?: string,
  ) {
    try {
      await this.ensureOrderBelongsToLister(user.id, orderId);

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: true,
        },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      // Only pending_approval (PROCESSING) orders, with still-valid approval window
      const now = new Date();
      if (
        order.status !== OrderStatus.PROCESSING ||
        !order.expiresAt ||
        order.expiresAt <= now
      ) {
        throw new ForbiddenException(
          'Order is not pending approval or approval window has expired',
        );
      }

      const approvedAt = now;

      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.ACCEPTED,
          approvedAt,
          // once approved, approval timer no longer applies
          expiresAt: null,
        },
        include: {
          user: true,
        },
      });

      // Placeholder for future dispatch workflow integration
      // e.g. await this.dispatchService.enqueueDispatch(updated, user.id, notes);

      // Placeholder for notification to dresser
      // e.g. this.eventEmitter.emit('order_approved', { orderId, dresserId: updated.userId });

      return {
        success: true,
        message: 'Order approved successfully',
        data: {
          orderId: updated.id,
          orderNumber: updated.orderId,
          status: 'approved',
          statusLabel: 'Approved',
          approvedAt: approvedAt.toISOString(),
          approvedBy: user.id,
          nextSteps: 'Prepare items for dispatch',
          notification: {
            sent: false, // placeholder until email / push is wired
            recipientId: updated.userId,
            type: 'order_approved',
          },
          notes: notes ?? null,
        },
      };
    } catch (e) {
      if (
        e instanceof NotFoundException ||
        e instanceof ForbiddenException
      ) {
        throw e;
      }
      console.error('approveOrder error:', e);
      throw new InternalServerErrorException('Failed to approve order');
    }
  }

  /** POST /api/listers/orders/:orderId/reject
   *  Reject a pending order within the 15‑minute window.
   */
  async rejectOrder(
    user: userEntity,
    orderId: string,
    body: { reason: string; notes?: string; refundType?: string },
  ) {
    try {
      await this.ensureOrderBelongsToLister(user.id, orderId);

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: true,
        },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      const now = new Date();
      if (
        order.status !== OrderStatus.PROCESSING ||
        !order.expiresAt ||
        order.expiresAt <= now
      ) {
        throw new ForbiddenException(
          'Order is not pending approval or approval window has expired',
        );
      }

      const rejectedAt = now;

      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.REJECTED,
          // when rejected, expiry no longer relevant
          expiresAt: null,
        },
        include: { user: true },
      });

      // Placeholder: refund / escrow release logic goes here

      // Placeholder: notification event
      // this.eventEmitter.emit('order_rejected', { orderId, dresserId: updated.userId, reason: body.reason });

      return {
        success: true,
        message: 'Order rejected',
        data: {
          orderId: updated.id,
          orderNumber: updated.orderId,
          status: 'rejected',
          statusLabel: 'Rejected',
          rejectedAt: rejectedAt.toISOString(),
          rejectedBy: user.id,
          reason: body.reason,
          refund: {
            amount: 0,
            reason: 'No payment charged for pending orders',
          },
          notification: {
            sent: false,
            recipientId: updated.userId,
            type: 'order_rejected',
            reason: body.reason,
          },
          notes: body.notes ?? null,
        },
      };
    } catch (e) {
      if (
        e instanceof NotFoundException ||
        e instanceof ForbiddenException
      ) {
        throw e;
      }
      console.error('rejectOrder error:', e);
      throw new InternalServerErrorException('Failed to reject order');
    }
  }

  /** PUT /api/listers/orders/:orderId/status
   *  Generic status update through the order lifecycle.
   *  Dispatch / tracking integration is left as a placeholder.
   */
  async updateOrderStatus(
    user: userEntity,
    orderId: string,
    body: {
      status: string;
      trackingNumber?: string;
      notes?: string;
      estimatedDeliveryDate?: string;
    },
  ) {
    try {
      await this.ensureOrderBelongsToLister(user.id, orderId);

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { user: true },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      const mapped = this.mapApiStatusToOrderStatus(body.status);
      if (!mapped) {
        throw new ForbiddenException('Unsupported status transition');
      }

      // We generally expect the \"approved\" transition to happen via approve endpoint
      if (
        mapped === OrderStatus.ACCEPTED &&
        order.status !== OrderStatus.PROCESSING
      ) {
        throw new ForbiddenException(
          'Order cannot be approved from its current status',
        );
      }

      const now = new Date();

      const updateData: any = {
        status: mapped,
      };

      if (mapped === OrderStatus.ACCEPTED) {
        updateData.approvedAt = now;
        updateData.expiresAt = null;
      }
      if (mapped === OrderStatus.CONFIRMED) {
        updateData.dispatchedAt = now;
      }
      if (mapped === OrderStatus.IN_TRANSIT) {
        // placeholder hook for external carrier updates
      }
      if (mapped === OrderStatus.DELIVERED) {
        updateData.deliveredAt = now;
      }
      if (mapped === OrderStatus.RETURN_DUE) {
        updateData.returnDueAt = now;
      }

      if (body.trackingNumber) {
        updateData.trackingNumber = body.trackingNumber;
        updateData.externalTrackingUrl = this.buildExternalTrackingUrl(
          body.trackingNumber,
        );
      }

      if (body.estimatedDeliveryDate) {
        // interpret as date string (YYYY-MM-DD) in local time; UI will format as needed
        updateData.estimatedDeliveryDate = new Date(
          body.estimatedDeliveryDate,
        );
      }

      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: updateData,
      });

      const timeline = {
        approvedAt: updated.approvedAt?.toISOString() ?? null,
        dispatchedAt: updated.dispatchedAt?.toISOString() ?? null,
        estimatedDeliveryDate:
          updated.estimatedDeliveryDate?.toISOString() ?? null,
        externalTrackingUrl: updated.externalTrackingUrl ?? null,
      };

      // Placeholder notification
      const notification = {
        sent: false,
        type: 'order_status_updated',
        recipientId: updated.userId,
      };

      return {
        success: true,
        message: 'Order status updated',
        data: {
          orderId: updated.id,
          previousStatus: ORDER_STATUS_TO_API[order.status] ?? order.status,
          newStatus: ORDER_STATUS_TO_API[updated.status] ?? updated.status,
          updatedAt: updated.updatedAt.toISOString(),
          timeline,
          notification,
        },
      };
    } catch (e) {
      if (
        e instanceof NotFoundException ||
        e instanceof ForbiddenException
      ) {
        throw e;
      }
      console.error('updateOrderStatus error:', e);
      throw new InternalServerErrorException('Failed to update order status');
    }
  }

  private mapStatusToOrderStatuses(status: string | undefined): OrderStatus[] | undefined {
    if (!status || status === 'all') return undefined;
    switch (status) {
      case 'pending':
        return [OrderStatus.PROCESSING];
      case 'ongoing':
        return [
          OrderStatus.ACCEPTED,
          OrderStatus.CONFIRMED,
          OrderStatus.IN_TRANSIT,
          OrderStatus.DELIVERED,
          OrderStatus.ACTIVE,
          OrderStatus.RETURN_DUE,
        ];
      case 'completed':
        return [OrderStatus.RETURNED, OrderStatus.COMPLETED];
      case 'cancelled':
        return [OrderStatus.CANCELLED, OrderStatus.REJECTED];
      default:
        return undefined;
    }
  }

  private mapApiStatusToOrderStatus(
    apiStatus: string,
  ): OrderStatus | null {
    switch (apiStatus) {
      case 'approved':
        return OrderStatus.ACCEPTED;
      case 'dispatched':
        return OrderStatus.CONFIRMED;
      case 'in_transit':
        return OrderStatus.IN_TRANSIT;
      case 'delivered':
        return OrderStatus.DELIVERED;
      case 'return_due':
        return OrderStatus.RETURN_DUE;
      case 'completed':
        return OrderStatus.COMPLETED;
      default:
        return null;
    }
  }

  private async getOrdersSummary(curatorId: string) {
    const orderIds = await this.prisma.orderItem
      .findMany({
        where: { product: { curatorId } },
        select: { orderId: true },
        distinct: ['orderId'],
      })
      .then((rows) => [...new Set(rows.map((r) => r.orderId))]);
    const counts = await this.prisma.order.groupBy({
      by: ['status'],
      where: { id: { in: orderIds } },
      _count: true,
    });
    const map = new Map(counts.map((c) => [c.status, c._count]));
    return {
      pendingApprovalCount: map.get(OrderStatus.PROCESSING) ?? 0,
      ongoingCount: [
        OrderStatus.ACCEPTED,
        OrderStatus.CONFIRMED,
        OrderStatus.IN_TRANSIT,
        OrderStatus.DELIVERED,
        OrderStatus.ACTIVE,
        OrderStatus.RETURN_DUE,
      ].reduce((a, s) => a + (map.get(s) ?? 0), 0),
      completedCount:
        (map.get(OrderStatus.RETURNED) ?? 0) + (map.get(OrderStatus.COMPLETED) ?? 0),
      cancelledCount:
        (map.get(OrderStatus.CANCELLED) ?? 0) + (map.get(OrderStatus.REJECTED) ?? 0),
    };
  }

  private formatOrderForList(order: any) {
    const expiresAt = order.expiresAt;
    const now = new Date();
    const timeRemainingSeconds =
      order.status === OrderStatus.PROCESSING && expiresAt && expiresAt > now
        ? Math.max(0, differenceInSeconds(expiresAt, now))
        : 0;
    const totalAmount = order.orderItems.reduce(
      (sum: number, oi: any) => sum + (oi.pricePerDay ?? 0) * (oi.days ?? 0),
      0,
    );
    return {
      id: order.id,
      orderNumber: order.orderId,
      createdAt: order.createdAt.toISOString(),
      expiresAt: expiresAt?.toISOString() ?? null,
      timeRemainingSeconds,
      itemCount: order.orderItems.length,
      totalAmount,
      currency: CURRENCY,
      status: ORDER_STATUS_TO_API[order.status] ?? order.status,
      statusLabel: ORDER_STATUS_TO_LABEL[order.status] ?? order.status,
      currentStep: order.status.toLowerCase(),
      dresser: {
        id: order.user.id,
        name: order.user.name,
        avatar:
          order.user.profile?.avatarUpload?.url ??
          'https://via.placeholder.com/64?text=U',
        rating: 4.5,
      },
      items: order.orderItems.map((oi: any) => ({
        id: oi.product.id,
        name: oi.product.name,
        size: oi.product.measurement ?? 'N/A',
        color: oi.product.color ?? 'N/A',
        image:
          oi.product.attachments?.uploads?.[0]?.url ??
          'https://via.placeholder.com/300?text=No+Image',
      })),
    };
  }

  private formatOrderDetail(order: any, reviewsCount: number) {
    const expiresAt = order.expiresAt;
    const now = new Date();
    const timeRemainingSeconds =
      order.status === OrderStatus.PROCESSING && expiresAt && expiresAt > now
        ? Math.max(0, differenceInSeconds(expiresAt, now))
        : 0;
    const totalAmount = order.orderItems.reduce(
      (sum: number, oi: any) => sum + (oi.pricePerDay ?? 0) * (oi.days ?? 0),
      0,
    );
    const itemValueTotal = order.orderItems.reduce(
      (sum: number, oi: any) => sum + (oi.product?.originalValue ?? 0),
      0,
    );
    const statusColors: Record<string, { bg: string; text: string }> = {
      pending_approval: { bg: '#FFF9E5', text: '#D4A017' },
      ongoing: { bg: '#E8F4FD', text: '#1E88E5' },
      completed: { bg: '#E8F5E9', text: '#2E7D32' },
      cancelled: { bg: '#FFEBEE', text: '#C62828' },
    };
    const apiStatus = ORDER_STATUS_TO_API[order.status] ?? order.status;
    const colors = statusColors[apiStatus] ?? { bg: '#F5F5F5', text: '#616161' };
    return {
      id: order.id,
      orderNumber: order.orderId,
      createdAt: order.createdAt.toISOString(),
      expiresAt: expiresAt?.toISOString() ?? null,
      timeRemainingSeconds,
      status: apiStatus,
      statusLabel: ORDER_STATUS_TO_LABEL[order.status] ?? order.status,
      statusColor: colors.bg,
      statusTextColor: colors.text,
      itemCount: order.orderItems.length,
      totalAmount,
      currency: CURRENCY,
      dresser: {
        id: order.user.id,
        name: order.user.name,
        avatar:
          order.user.profile?.avatarUpload?.url ??
          'https://via.placeholder.com/64?text=U',
        rating: 4.5,
        reviews: reviewsCount,
        memberSince: order.user.createdAt.toISOString().split('T')[0],
      },
      items: order.orderItems.map((oi: any) => ({
        id: oi.product.id,
        name: oi.product.name,
        image:
          oi.product.attachments?.uploads?.[0]?.url ??
          'https://via.placeholder.com/300?text=No+Image',
        size: oi.product.measurement ?? 'N/A',
        color: oi.product.color ?? 'N/A',
        rentalFee: (oi.pricePerDay ?? oi.product.dailyPrice) * oi.days,
        itemValue: oi.product.originalValue ?? 0,
        returnDue: order.rental?.endDate?.toISOString().split('T')[0] ?? null,
        status: order.status.toLowerCase(),
        statusLabel: ORDER_STATUS_TO_LABEL[order.status] ?? order.status,
      })),
      timeline: {
        dateOrdered: order.createdAt.toISOString().split('T')[0],
        itemsCount: order.orderItems.length,
        itemsDelivered: order.status === OrderStatus.DELIVERED ? order.orderItems.length : 0,
        currentStep: apiStatus,
      },
      escrow: {
        rentalFeeTotal: totalAmount,
        itemValueHeld: itemValueTotal,
        totalHeld: totalAmount + itemValueTotal,
        currency: CURRENCY,
        releaseCondition: 'Upon successful return confirmation',
      },
      canApprove: order.status === OrderStatus.PROCESSING && timeRemainingSeconds > 0,
      canReject: order.status === OrderStatus.PROCESSING,
      approvalRequired: order.status === OrderStatus.PROCESSING,
      approvalExpiredAt: expiresAt?.toISOString() ?? null,
    };
  }

  /** Placeholder helper for future dispatch API / carrier integration */
  private buildExternalTrackingUrl(
    trackingNumber?: string,
  ): string | null {
    if (!trackingNumber) return null;
    // In future, this could switch based on carrier (FedEx/UPS/etc.)
    return `https://tracking.example.com/${trackingNumber}`;
  }

  // ---------------------------------------------------------------------------
  // LISTER DISPUTES
  // ---------------------------------------------------------------------------

  /** 19. GET /api/listers/disputes/stats */
  async getDisputeStats(user: userEntity, timeframe?: string) {
    try {
      const now = new Date();
      let fromDate: Date | undefined;
      if (timeframe === 'month') {
        fromDate = new Date(now);
        fromDate.setMonth(now.getMonth() - 1);
      } else if (timeframe === 'week') {
        fromDate = new Date(now);
        fromDate.setDate(now.getDate() - 7);
      }

      const whereBase: any = {
        order: {
          rental: {
            curatorId: user.id,
          },
        },
      };
      if (fromDate) {
        whereBase.createdAt = { gte: fromDate };
      }

      const [allDisputes, totalOrdersForLister] = await Promise.all([
        this.prisma.dispute.findMany({
          where: whereBase,
          select: { status: true, createdAt: true, updatedAt: true },
        }),
        this.prisma.order.count({
          where: {
            rental: { curatorId: user.id },
          },
        }),
      ]);

      const totalDisputes = allDisputes.length;
      const pendingDisputes = allDisputes.filter(
        (d) => d.status === DisputeStatus.PENDING,
      ).length;
      const inReviewDisputes = allDisputes.filter(
        (d) => d.status === DisputeStatus.IN_REVIEW,
      ).length;
      const resolvedDisputes = allDisputes.filter(
        (d) => d.status === DisputeStatus.RESELOVED,
      ).length;
      const rejectedDisputes = allDisputes.filter(
        (d) => d.status === DisputeStatus.REJECTED,
      ).length;

      // Average resolution time for resolved disputes
      const resolved = allDisputes.filter(
        (d) => d.status === DisputeStatus.RESELOVED,
      );
      let averageResolutionTime = 'N/A';
      if (resolved.length > 0) {
        const totalMs = resolved.reduce((sum, d) => {
          const diff = d.updatedAt.getTime() - d.createdAt.getTime();
          return sum + diff;
        }, 0);
        const avgMs = totalMs / resolved.length;
        const days = Math.max(1, Math.round(avgMs / (1000 * 60 * 60 * 24)));
        averageResolutionTime = `${days} day${days > 1 ? 's' : ''}`;
      }

      const litRate =
        totalOrdersForLister > 0
          ? (totalDisputes / totalOrdersForLister) * 100
          : 0;
      const litiousChargeRate = `${litRate.toFixed(1)}%`;

      return {
        success: true,
        data: {
          disputeStats: {
            totalDisputes,
            pendingDisputes,
            inReviewDisputes,
            resolvedDisputes,
            rejectedDisputes,
            averageResolutionTime,
            litiousChargeRate,
          },
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (e) {
      console.error('getDisputeStats error:', e);
      throw new InternalServerErrorException('Failed to fetch dispute stats');
    }
  }

  /** 20. GET /api/listers/disputes */
  async getDisputesList(
    user: userEntity,
    page = 1,
    limit = 10,
    status: string = 'all',
    search?: string,
    sortBy: string = '-dateSubmitted',
  ) {
    try {
      const skip = (page - 1) * limit;

      const where: any = {
        order: {
          rental: { curatorId: user.id },
        },
      };

      // Status filter
      if (status && status !== 'all') {
        switch (status) {
          case 'pending_review':
            where.status = DisputeStatus.PENDING;
            break;
          case 'in_review':
            where.status = DisputeStatus.IN_REVIEW;
            break;
          case 'resolved':
            where.status = DisputeStatus.RESELOVED;
            break;
          case 'rejected':
            where.status = DisputeStatus.REJECTED;
            break;
          default:
            break;
        }
      }

      // Search across disputeId, orderNumber, item name
      if (search && search.trim()) {
        const q = search.trim();
        where.OR = [
          { disputeId: { contains: q, mode: 'insensitive' } },
          { order: { orderId: { contains: q, mode: 'insensitive' } } },
          {
            order: {
              orderItems: {
                some: {
                  product: { name: { contains: q, mode: 'insensitive' } },
                },
              },
            },
          },
        ];
      }

      // Sorting
      let orderBy: any = { createdAt: 'desc' };
      if (sortBy === 'status') {
        orderBy = { status: 'asc' };
      } else if (sortBy === '-status') {
        orderBy = { status: 'desc' };
      } else if (sortBy === 'dateSubmitted') {
        orderBy = { createdAt: 'asc' };
      } else if (sortBy === '-dateSubmitted') {
        orderBy = { createdAt: 'desc' };
      }
      // \"amount\" sort will be applied in-memory after fetching, since amount is derived

      const [rawDisputes, total] = await Promise.all([
        this.prisma.dispute.findMany({
          where,
          skip,
          take: limit,
          orderBy,
          include: {
            order: {
              include: {
                rental: true,
                orderItems: {
                  include: {
                    product: { select: { name: true } },
                  },
                },
              },
            },
            user: { select: { name: true } },
          },
        }),
        this.prisma.dispute.count({ where }),
      ]);

      const mapped = rawDisputes.map((d) => {
        const order = d.order;
        const rental = order?.rental;
        const itemName =
          order?.orderItems?.[0]?.product?.name ?? 'Unknown item';
        const curatorName = d.user.name;
        const amount = rental?.totalAmount ?? 0;
        const statusApi = this.mapDisputeStatusToApi(d.status);
        const statusPresentation = this.mapDisputeStatusPresentation(
          statusApi,
        );

        const submitted = d.createdAt;

        return {
          disputeId: d.disputeId,
          itemName,
          curator: curatorName,
          orderNumber: order?.orderId,
          status: statusApi,
          statusLabel: statusPresentation.label,
          statusIcon: statusPresentation.icon,
          statusColor: statusPresentation.textColor,
          statusBgColor: statusPresentation.bgColor,
          dateSubmitted: submitted.toISOString(),
          displayDate: submitted.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          }),
          category: d.issueCategory,
          amount,
          currency: CURRENCY,
        };
      });

      // Optional in-memory sort by amount if requested
      let disputes = mapped;
      if (sortBy === 'amount') {
        disputes = [...mapped].sort((a, b) => a.amount - b.amount);
      } else if (sortBy === '-amount') {
        disputes = [...mapped].sort((a, b) => b.amount - a.amount);
      }

      const pages = Math.ceil(total / limit) || 1;
      return {
        success: true,
        data: {
          disputes,
          pagination: { total, page, limit, pages },
        },
      };
    } catch (e) {
      console.error('getDisputesList error:', e);
      throw new InternalServerErrorException('Failed to fetch disputes');
    }
  }

  /** 21. POST /api/listers/disputes */
  async createDispute(
    user: userEntity,
    body: {
      orderId: string;
      orderNumber?: string;
      category: string;
      description: string;
      preferredResolution?: string;
      evidenceFiles?: string[];
    },
  ) {
    try {
      if (!body.orderId || !body.category || !body.description) {
        throw new ForbiddenException('Missing required fields');
      }
      if (body.description.length < 20) {
        throw new ForbiddenException(
          'Description must be at least 20 characters long',
        );
      }

      const order = await this.prisma.order.findUnique({
        where: { id: body.orderId },
        include: {
          rental: true,
        },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }

      // Lister-only ownership check – order must involve this curator
      const rental = order.rental;
      if (!rental || rental.curatorId !== user.id) {
        throw new ForbiddenException(
          'You can only raise disputes for your own rentals',
        );
      }

      const existing = await this.prisma.dispute.findFirst({
        where: {
          orderId: order.id,
          userId: user.id,
        },
      });
      if (existing) {
        // 422-style semantics
        throw new ForbiddenException(
          'A dispute already exists for this order',
        );
      }

      // Generate a human-friendly disputeId (e.g. DQ-0234)
      const sequence = Date.now().toString().slice(-4);
      const disputeId = `DQ-${sequence}`;

      const created = await this.prisma.dispute.create({
        data: {
          disputeId,
          orderId: order.id,
          userId: user.id,
          issueCategory: body.category,
          description: body.description,
          status: DisputeStatus.PENDING,
          attachment:
            body.evidenceFiles && body.evidenceFiles.length > 0
              ? {
                  create: {
                    uploads: {
                      connect: body.evidenceFiles.map((id) => ({ id })),
                    },
                  },
                }
              : undefined,
        },
      });

      // Placeholder for notification (email / push)

      return {
        success: true,
        message: 'Dispute created successfully',
        data: {
          disputeId: created.disputeId,
          orderId: created.orderId,
          orderNumber: order.orderId,
          category: created.issueCategory,
          status: 'pending_review',
          statusLabel: 'Pending Review',
          createdAt: created.createdAt.toISOString(),
          estimatedResolutionTime: '5-7 business days',
          notification: {
            sent: false,
            type: 'dispute_created',
            message:
              "Your dispute has been submitted. You'll receive updates via email.",
          },
        },
      };
    } catch (e) {
      if (
        e instanceof NotFoundException ||
        e instanceof ForbiddenException
      ) {
        throw e;
      }
      console.error('createDispute error:', e);
      throw new InternalServerErrorException('Failed to create dispute');
    }
  }

  private async findListerDisputeOrThrow(
    user: userEntity,
    disputeId: string,
  ) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { disputeId },
      include: {
        order: {
          include: {
            rental: true,
            orderItems: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    curator: {
                      select: { id: true, name: true },
                    },
                  },
                },
              },
            },
          },
        },
        user: true,
        attachment: {
          include: {
            uploads: true,
          },
        },
        chatRooms: {
          include: {
            message: true,
          },
        },
      },
    });
    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    const curatorId = dispute.order?.rental?.curatorId;
    if (curatorId !== user.id) {
      throw new ForbiddenException('Dispute not found or access denied');
    }

    return dispute;
  }

  /** 22. GET /api/listers/disputes/:disputeId */
  async getDisputeDetails(user: userEntity, disputeId: string) {
    try {
      const dispute = await this.findListerDisputeOrThrow(user, disputeId);

      const statusApi = this.mapDisputeStatusToApi(dispute.status);
      const statusPresentation =
        this.mapDisputeStatusPresentation(statusApi);

      const order = dispute.order;
      const orderNumber = order?.orderId;
      const itemName =
        order?.orderItems?.[0]?.product?.name ?? 'Unknown item';
      const curatorName =
        order?.orderItems?.[0]?.product?.curator?.name ?? 'Unknown';
      const createdAtIso = dispute.createdAt.toISOString();
      const lastUpdatedAtIso = dispute.updatedAt.toISOString();

      // Very simple estimated resolution date: +7 days
      const estimatedResolutionDate = new Date(dispute.createdAt);
      estimatedResolutionDate.setDate(estimatedResolutionDate.getDate() + 7);

      // Evidence summary
      const uploads = dispute.attachment?.uploads ?? [];

      const evidence = {
        filesCount: uploads.length,
        files: uploads.map((u) => ({
          fileId: u.id,
          fileName: u.name,
          fileType: u.type.startsWith('image') ? 'image' : 'document',
          fileUrl: u.url,
          uploadedAt: u.createdAt.toISOString(),
        })),
      };

      // Timeline derived from status and timestamps (can be enriched later)
      const timeline = {
        events: [
          {
            status: 'Submitted',
            date: createdAtIso,
            description: 'Dispute created and submitted for review',
          },
          {
            status:
              statusApi === 'in_review' || statusApi === 'resolved'
                ? 'In Review'
                : 'Pending Review',
            date: createdAtIso,
            description:
              'Our team is reviewing your case and evidence',
          },
        ],
      };

      const messages = dispute.chatRooms?.message ?? [];

      const messagesSummary = {
        count: messages.length,
        lastMessage:
          messages.length > 0
            ? this.mapMessageToSummary(messages[messages.length - 1])
            : null,
      };

      return {
        success: true,
        data: {
          dispute: {
            disputeId: dispute.disputeId,
            orderNumber,
            status: statusApi,
            statusLabel: statusPresentation.label,
            statusIcon: statusPresentation.icon,
            statusColor: statusPresentation.bgColor,
            createdAt: createdAtIso,
            lastUpdatedAt: lastUpdatedAtIso,
            estimatedResolutionDate:
              estimatedResolutionDate.toISOString(),
            overview: {
              itemName,
              curator: curatorName,
              category: dispute.issueCategory,
              dateSubmitted: dispute.createdAt
                .toISOString()
                .split('T')[0],
              preferredResolution: null,
              description: dispute.description,
            },
            evidence,
            timeline,
            resolution: {
              status:
                dispute.status === DisputeStatus.RESELOVED
                  ? 'resolved'
                  : 'reviewing',
              resolutionDetails: null,
              refundAmount: null,
              refundDate: null,
            },
            messages: messagesSummary,
          },
        },
      };
    } catch (e) {
      if (
        e instanceof NotFoundException ||
        e instanceof ForbiddenException
      ) {
        throw e;
      }
      console.error('getDisputeDetails error:', e);
      throw new InternalServerErrorException(
        'Failed to fetch dispute details',
      );
    }
  }

  /** 23. GET /api/listers/disputes/:disputeId/overview */
  async getDisputeOverview(user: userEntity, disputeId: string) {
    const dispute = await this.findListerDisputeOrThrow(user, disputeId);
    const order = dispute.order;
    const itemName =
      order?.orderItems?.[0]?.product?.name ?? 'Unknown item';
    const curatorName =
      order?.orderItems?.[0]?.product?.curator?.name ?? 'Unknown';
    return {
      success: true,
      data: {
        overview: {
          itemInformation: {
            itemName,
            curator: curatorName,
            orderId: order?.orderId,
          },
          disputeDetails: {
            category: dispute.issueCategory,
            dateSubmitted: dispute.createdAt
              .toISOString()
              .split('T')[0],
            preferredResolution: null,
            description: dispute.description,
          },
        },
      },
    };
  }

  /** 24. GET /api/listers/disputes/:disputeId/evidence */
  async getDisputeEvidence(user: userEntity, disputeId: string) {
    const dispute = await this.findListerDisputeOrThrow(user, disputeId);
    const uploads = dispute.attachment?.uploads ?? [];
    const files = uploads.map((u) => ({
      fileId: u.id,
      fileName: u.name,
      fileType: u.type.startsWith('image') ? 'image' : 'document',
      fileUrl: u.url,
      fileSize: `${(u.size / (1024 * 1024)).toFixed(1)}MB`,
      uploadedAt: u.createdAt.toISOString(),
      uploadedBy: u.userId,
    }));
    const totalSizeMb =
      uploads.reduce((sum, u) => sum + u.size, 0) / (1024 * 1024);

    return {
      success: true,
      data: {
        evidence: {
          files,
          totalFiles: files.length,
          totalSize: `${totalSizeMb.toFixed(1)}MB`,
        },
      },
    };
  }

  /** 25. GET /api/listers/disputes/:disputeId/timeline */
  async getDisputeTimeline(user: userEntity, disputeId: string) {
    const dispute = await this.findListerDisputeOrThrow(user, disputeId);
    const createdAt = dispute.createdAt;
    const updatedAt = dispute.updatedAt;
    const events = [
      {
        eventId: `${dispute.id}-created`,
        status: 'Submitted',
        date: createdAt.toISOString(),
        displayDate: createdAt.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
        description: 'Dispute created and submitted for review',
        timestamp: createdAt.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      },
    ];

    if (dispute.status === DisputeStatus.IN_REVIEW) {
      events.push({
        eventId: `${dispute.id}-inreview`,
        status: 'In Review',
        date: updatedAt.toISOString(),
        displayDate: updatedAt.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
        description:
          'Our team is reviewing your case and evidence',
        timestamp: updatedAt.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    }

    if (dispute.status === DisputeStatus.RESELOVED) {
      events.push({
        eventId: `${dispute.id}-resolved`,
        status: 'Resolved',
        date: updatedAt.toISOString(),
        displayDate: updatedAt.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
        description: 'Dispute has been resolved',
        timestamp: updatedAt.toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    }

    const currentStatus = this.mapDisputeStatusToApi(dispute.status);

    return {
      success: true,
      data: {
        timeline: {
          events,
          totalEvents: events.length,
          currentStatus,
        },
      },
    };
  }

  /** 26. GET /api/listers/disputes/:disputeId/resolution */
  async getDisputeResolution(user: userEntity, disputeId: string) {
    const dispute = await this.findListerDisputeOrThrow(user, disputeId);
    const apiStatus = this.mapDisputeStatusToApi(dispute.status);

    if (apiStatus === 'resolved') {
      // Placeholder resolved shape
      return {
        success: true,
        data: {
          resolution: {
            status: 'resolved',
            statusLabel: 'Resolved',
            resolutionDetails:
              'Full refund issued due to confirmed issue.',
            refundAmount: 0,
            currency: CURRENCY,
            formattedAmount: `₦0`,
            refundDate: dispute.updatedAt.toISOString(),
            refundStatus: 'processed',
            resolvedAt: dispute.updatedAt.toISOString(),
            resolvedBy: 'RELISTED Admin',
            appealAvailable: false,
          },
        },
      };
    }

    return {
      success: true,
      data: {
        resolution: {
          status: 'reviewing',
          statusLabel: 'Under Review',
          resolutionDetails: null,
          refundAmount: null,
          refundDate: null,
          refundStatus: null,
          resolvedAt: null,
          resolvedBy: null,
          appealAvailable: false,
        },
      },
    };
  }

  /** 27. GET /api/listers/disputes/:disputeId/messages */
  async getDisputeMessages(
    user: userEntity,
    disputeId: string,
    page = 1,
    limit = 50,
  ) {
    const dispute = await this.findListerDisputeOrThrow(user, disputeId);

    const skip = (page - 1) * limit;

    const room =
      dispute.chatRooms ??
      (await this.prisma.chatRoom.findFirst({
        where: { disputeId: dispute.id },
        include: { message: true },
      }));

    if (!room) {
      return {
        success: true,
        data: {
          messages: [],
          pagination: { total: 0, page, limit, pages: 0 },
        },
      };
    }

    const [messages, total] = await Promise.all([
      this.prisma.message.findMany({
        where: { chatRoomId: room.id },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.message.count({ where: { chatRoomId: room.id } }),
    ]);

    const mapped = messages.map((m) =>
      this.mapMessageToConversationItem(m),
    );

    const pages = Math.ceil(total / limit) || 1;
    return {
      success: true,
      data: {
        messages: mapped,
        pagination: { total, page, limit, pages },
      },
    };
  }

  /** 28. POST /api/listers/disputes/:disputeId/messages */
  async addDisputeMessage(
    user: userEntity,
    disputeId: string,
    body: { content: string; mediaIds?: string[] },
  ) {
    if (!body.content || !body.content.trim()) {
      throw new ForbiddenException('Message content cannot be empty');
    }

    const dispute = await this.findListerDisputeOrThrow(user, disputeId);

    let room =
      dispute.chatRooms ??
      (await this.prisma.chatRoom.findFirst({
        where: { disputeId: dispute.id },
      }));

    if (!room) {
      room = await this.prisma.chatRoom.create({
        data: {
          disputeId: dispute.id,
        },
      });
    }

    const message = await this.prisma.message.create({
      data: {
        senderId: user.id,
        senderRole: Role.LISTER,
        content: body.content,
        type: 'user',
        chatRoomId: room.id,
      },
    });

    // Placeholder: associate mediaIds via a separate table / attachments if needed
    // Placeholder: notification to admin / renter

    const createdAt = message.createdAt.toISOString();
    return {
      success: true,
      message: 'Message sent successfully',
      data: {
        messageId: message.id,
        type: 'user',
        content: message.content,
        createdAt,
        displayTimestamp: message.createdAt.toLocaleString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        senderId: user.id,
      },
    };
  }

  /** 29. POST /api/listers/disputes/:disputeId/withdraw */
  async withdrawDispute(
    user: userEntity,
    disputeId: string,
    body: { reason?: string; notes?: string },
  ) {
    const dispute = await this.findListerDisputeOrThrow(user, disputeId);

    if (dispute.status !== DisputeStatus.PENDING) {
      throw new ForbiddenException(
        'Dispute cannot be withdrawn from its current status',
      );
    }

    const previousStatus = this.mapDisputeStatusToApi(dispute.status);

    const updated = await this.prisma.dispute.update({
      where: { id: dispute.id },
      data: {
        status: DisputeStatus.WITHDRAW,
      },
    });

    // Placeholder: refund any dispute fee (if such fees exist)

    return {
      success: true,
      message: 'Dispute withdrawn successfully',
      data: {
        disputeId: updated.disputeId,
        previousStatus,
        newStatus: 'withdrawn',
        withdrawnAt: updated.updatedAt.toISOString(),
        refundData: {
          refunded: true,
          refundAmount: 0,
          reason: 'No fees charged for this dispute',
        },
        notification: {
          sent: false,
          type: 'dispute_withdrawn',
          message: 'Your dispute has been withdrawn.',
        },
      },
    };
  }

  // ---------------------------------------------------------------------------
  // DISPUTE HELPERS
  // ---------------------------------------------------------------------------

  private mapDisputeStatusToApi(status: DisputeStatus): string {
    switch (status) {
      case DisputeStatus.PENDING:
        return 'pending_review';
      case DisputeStatus.IN_REVIEW:
        return 'in_review';
      case DisputeStatus.RESELOVED:
        return 'resolved';
      case DisputeStatus.REJECTED:
        return 'rejected';
      case DisputeStatus.WITHDRAW:
        return 'withdrawn';
      default:
        return 'pending_review';
    }
  }

  private mapDisputeStatusPresentation(apiStatus: string) {
    switch (apiStatus) {
      case 'in_review':
        return {
          label: 'In Review',
          icon: 'document',
          textColor: 'text-blue-800',
          bgColor: 'bg-blue-100',
        };
      case 'pending_review':
        return {
          label: 'Pending Review',
          icon: 'clock',
          textColor: 'text-yellow-800',
          bgColor: 'bg-yellow-100',
        };
      case 'resolved':
        return {
          label: 'Resolved',
          icon: 'check-circle',
          textColor: 'text-green-800',
          bgColor: 'bg-green-100',
        };
      case 'rejected':
        return {
          label: 'Rejected',
          icon: 'x-circle',
          textColor: 'text-red-800',
          bgColor: 'bg-red-100',
        };
      case 'withdrawn':
        return {
          label: 'Withdrawn',
          icon: 'minus-circle',
          textColor: 'text-gray-800',
          bgColor: 'bg-gray-100',
        };
      default:
        return {
          label: 'Pending Review',
          icon: 'clock',
          textColor: 'text-yellow-800',
          bgColor: 'bg-yellow-100',
        };
    }
  }

  private mapMessageToConversationItem(m: Message) {
    const base = {
      messageId: m.id,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      displayTimestamp: m.createdAt.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    if (m.type === 'status') {
      return {
        ...base,
        type: 'status',
        createdBy: 'system',
      };
    }

    if (m.senderRole === Role.ADMIN) {
      return {
        ...base,
        type: 'admin',
        createdBy: m.senderId,
        adminName: 'Support Team',
      };
    }

    // Assume everything else from this endpoint is user/lister
    return {
      ...base,
      type: 'user',
      createdBy: m.senderId,
    };
  }

  private mapMessageToSummary(m: Message) {
    return {
      id: m.id,
      type:
        m.type === 'status'
          ? 'status'
          : m.senderRole === Role.ADMIN
          ? 'admin'
          : 'user',
      content: m.content,
      timestamp: m.createdAt.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // LISTER PROFILE, VERIFICATIONS & ISSUE CATEGORIES
  // ---------------------------------------------------------------------------

  /** 30. GET /api/issue-categories (global) is implemented in a separate controller. */

  /** 31. GET /api/listers/profile */
  async getListerProfile(user: userEntity, includeAddresses: boolean) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: {
        user: true,
        address: true,
        avatarUpload: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const addresses = includeAddresses && profile.address
      ? [
          {
            addressId: profile.address.id,
            type: 'residential',
            street: profile.address.street,
            city: profile.address.city,
            state: profile.address.state,
            postalCode: profile.address.zipCode,
            country: profile.address.country,
            isDefault: profile.address.isDefault,
          },
        ]
      : [];

    return {
      success: true,
      data: {
        profile: {
          userId: profile.userId,
          fullName: profile.user.name,
          email: profile.user.email,
          phone: profile.phoneNumber,
          role: profile.user.role,
          profileImage: profile.avatarUpload?.url ?? null,
          dateJoined: profile.user.createdAt.toISOString(),
          addresses,
        },
      },
    };
  }

  /** 32. PUT /api/listers/profile */
  async updateListerProfile(
    user: userEntity,
    body: { fullName?: string; phone?: string },
  ) {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: user.id },
    });
    if (!currentUser) {
      throw new NotFoundException('User not found');
    }

    if (body.fullName) {
      // Update name on User
      await this.prisma.user.update({
        where: { id: user.id },
        data: { name: body.fullName },
      });
    }

    if (body.phone) {
      await this.prisma.profile.update({
        where: { userId: user.id },
        data: { phoneNumber: body.phone },
      });
    }

    const updatedProfile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: { user: true },
    });
    if (!updatedProfile) {
      throw new NotFoundException('Profile not found');
    }

    return {
      success: true,
      message: 'Profile updated successfully',
      data: {
        profile: {
          userId: updatedProfile.userId,
          fullName: updatedProfile.user.name,
          email: updatedProfile.user.email,
          phone: updatedProfile.phoneNumber,
          role: updatedProfile.user.role,
          updatedAt: updatedProfile.updatedAt.toISOString(),
        },
      },
    };
  }

  /** 33. GET /api/listers/profile/addresses */
  async getListerAddresses(user: userEntity) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: { address: true },
    });
    if (!profile || !profile.address) {
      return {
        success: true,
        data: { addresses: [], total: 0 },
      };
    }

    const addr = profile.address;
    const addresses = [
      {
        addressId: addr.id,
        type: 'residential',
        street: addr.street,
        city: addr.city,
        state: addr.state,
        postalCode: addr.zipCode,
        country: addr.country,
        isDefault: addr.isDefault,
        createdAt: addr.createdAt.toISOString(),
      },
    ];

    return {
      success: true,
      data: {
        addresses,
        total: addresses.length,
      },
    };
  }

  /** 34. POST /api/listers/profile/addresses
   *  Note: current schema supports a single Address per Profile.
   *  This endpoint will upsert that single address.
   */
  async addListerAddress(
    user: userEntity,
    body: {
      type?: string;
      street: string;
      city: string;
      state: string;
      postalCode?: string;
      country: string;
      isDefault?: boolean;
    },
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: { address: true },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const data = {
      street: body.street,
      city: body.city,
      state: body.state,
      zipCode: body.postalCode ?? null,
      country: body.country,
      isDefault: body.isDefault ?? true,
    };

    const address = profile.address
      ? await this.prisma.address.update({
          where: { id: profile.address.id },
          data,
        })
      : await this.prisma.address.create({
          data: {
            ...data,
            profile: { connect: { id: profile.id } },
          },
        });

    return {
      success: true,
      message: 'Address added successfully',
      data: {
        address: {
          addressId: address.id,
          type: body.type ?? 'residential',
          street: address.street,
          city: address.city,
          state: address.state,
          postalCode: address.zipCode,
          country: address.country,
          isDefault: address.isDefault,
          createdAt: address.createdAt.toISOString(),
        },
      },
    };
  }

  /** 35. POST /api/listers/profile/avatar
   *  This endpoint expects an existing upload ID to be linked as avatar.
   *  File upload is handled by the /upload module.
   */
  async updateProfileAvatar(
    user: userEntity,
    body: { uploadId: string },
  ) {
    if (!body.uploadId) {
      throw new ForbiddenException('uploadId is required');
    }

    await this.prisma.profile.update({
      where: { userId: user.id },
      data: {
        avatarUpload: {
          connect: { id: body.uploadId },
        },
      },
    });

    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: { avatarUpload: true },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    return {
      success: true,
      message: 'Profile avatar updated successfully',
      data: {
        profileImage: profile.avatarUpload?.url ?? null,
        uploadedAt: profile.avatarUpload?.createdAt.toISOString() ?? null,
      },
    };
  }

  /** 36. GET /api/listers/profile/business */
  async getBusinessProfile(user: userEntity) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: { businessInfo: true },
    });
    if (!profile || !profile.businessInfo) {
      throw new NotFoundException('Business profile not found');
    }
    const b = profile.businessInfo;

    // Simple metrics placeholders
    const totalRentals = await this.prisma.rental.count({
      where: { curatorId: user.id },
    });
    const averageRatingAgg = await this.prisma.review.aggregate({
      _avg: { rating: true },
      where: { curatorId: user.id },
    });

    return {
      success: true,
      data: {
        businessProfile: {
          businessId: b.id,
          businessName: b.businessName,
          businessCategory: b.businessCategory ?? 'Fashion & Accessories',
          businessDescription:
            b.businessDescription ??
            'Premium fashion rental service',
          businessEmail: b.businessEmail,
          businessPhone: b.businessPhone ?? null,
          businessAddress: b.businessAddress,
          website: b.website ?? null,
          taxId: null,
          businessRegistration: b.businessRegistrationNumber,
          verificationStatus: profile.isApproved ? 'verified' : 'pending',
          verificationBadge: profile.isApproved ? 'blue' : 'yellow',
          averageResponseTime: '2 hours',
          totalRentals,
          averageRating: averageRatingAgg._avg.rating ?? 0,
          createdAt: profile.createdAt.toISOString(),
          updatedAt: profile.updatedAt.toISOString(),
        },
      },
    };
  }

  /** 37. PUT /api/listers/profile/business */
  async updateBusinessProfile(
    user: userEntity,
    body: {
      businessName?: string;
      businessCategory?: string;
      businessDescription?: string;
      businessEmail?: string;
      businessPhone?: string;
      businessAddress?: string;
      website?: string;
    },
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: { businessInfo: true },
    });
    if (!profile || !profile.businessInfo) {
      throw new NotFoundException('Business profile not found');
    }

    const updated = await this.prisma.businessInfo.update({
      where: { id: profile.businessInfo.id },
      data: {
        ...(body.businessName && { businessName: body.businessName }),
        ...(body.businessCategory && {
          businessCategory: body.businessCategory,
        }),
        ...(body.businessDescription && {
          businessDescription: body.businessDescription,
        }),
        ...(body.businessEmail && { businessEmail: body.businessEmail }),
        ...(body.businessPhone && { businessPhone: body.businessPhone }),
        ...(body.businessAddress && {
          businessAddress: body.businessAddress,
        }),
        ...(body.website && { website: body.website }),
      },
    });

    return {
      success: true,
      message: 'Business details updated successfully',
      data: {
        businessProfile: {
          businessId: updated.id,
          businessName: updated.businessName,
          businessCategory: updated.businessCategory,
          businessDescription: updated.businessDescription,
          businessEmail: updated.businessEmail,
          businessPhone: updated.businessPhone,
          businessAddress: updated.businessAddress,
          website: updated.website,
          updatedAt: new Date().toISOString(),
        },
      },
    };
  }

  /** 38. GET /api/listers/verifications/status */
  async getVerificationStatus(user: userEntity) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: { ninUpload: true, businessInfo: true },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const ninStatus = profile.ninUpload ? 'verified' : 'not_verified';
    const bvnStatus = profile.bvn ? 'verified' : 'not_verified';
    const businessStatus = profile.businessInfo
      ? 'verified'
      : 'not_verified';

    const maskBvn = (val?: string | null) =>
      val && val.length >= 4
        ? `XXXXX${val.slice(-4)}`
        : null;

    return {
      success: true,
      data: {
        verifications: {
          nin: {
            status: ninStatus,
            document: 'National Identification Number',
            verifiedDate: profile.ninUpload
              ? profile.ninUpload.createdAt.toISOString()
              : null,
            expiresAt: null,
          },
          bvn: {
            status: bvnStatus,
            document: 'Bank Verification Number',
            verifiedDate: null,
            maskedValue: maskBvn(profile.bvn),
          },
          businessRegistration: {
            status: businessStatus,
            document: 'Business Registration',
            verifiedDate: null,
            registrationNumber:
              profile.businessInfo?.businessRegistrationNumber ??
              null,
          },
        },
      },
    };
  }

  /** 39. GET /api/listers/verifications/documents */
  async getVerificationDocuments(user: userEntity) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: { ninUpload: true },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const documents: any[] = [];
    if (profile.ninUpload) {
      documents.push({
        documentId: profile.ninUpload.id,
        type: 'NIN',
        documentUrl: profile.ninUpload.url,
        status: 'verified',
        uploadedDate: profile.ninUpload.createdAt.toISOString(),
        verifiedDate: profile.ninUpload.createdAt.toISOString(),
        notes: 'Document verified successfully',
      });
    }

    return {
      success: true,
      data: { documents },
    };
  }

  /** 40. POST /api/listers/verifications/nin
   *  Links an existing upload as NIN document and records basic metadata.
   */
  async uploadNinDocument(
    user: userEntity,
    body: { uploadId: string; ninNumber?: string },
  ) {
    if (!body.uploadId) {
      throw new ForbiddenException('uploadId is required');
    }

    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const updated = await this.prisma.profile.update({
      where: { userId: user.id },
      data: {
        ninUpload: {
          connect: { id: body.uploadId },
        },
      },
      include: { ninUpload: true },
    });

    return {
      success: true,
      message: 'NIN document uploaded successfully',
      data: {
        document: {
          documentId: updated.ninUpload?.id ?? body.uploadId,
          type: 'NIN',
          documentUrl: updated.ninUpload?.url ?? null,
          status: 'pending_verification',
          uploadedDate:
            updated.ninUpload?.createdAt.toISOString() ??
            new Date().toISOString(),
          estimatedVerificationTime: '24-48 hours',
        },
      },
    };
  }

  /** 41. GET /api/listers/verifications/bvn */
  async getBvnInfo(user: userEntity) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const maskBvn = (val?: string | null) =>
      val && val.length >= 4 ? `XXXXX${val.slice(-4)}` : null;

    return {
      success: true,
      data: {
        bvn: {
          maskedValue: maskBvn(profile.bvn),
          status: profile.bvn ? 'verified' : 'not_verified',
          verifiedDate: null,
          bankName: null,
          accountName: null,
        },
      },
    };
  }

  /** 42. PUT /api/listers/verifications/emergency-contact */
  async updateEmergencyContact(
    user: userEntity,
    body: {
      fullName: string;
      email?: string;
      phone: string;
      relationship: string;
    },
  ) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: { emergencyContact: true },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const data = {
      name: body.fullName,
      email: body.email ?? null,
      phoneNumber: body.phone,
      relationship: body.relationship,
      city: '',
      state: '',
    };

    const contact = profile.emergencyContact
      ? await this.prisma.emergencyContact.update({
          where: { id: profile.emergencyContact.id },
          data,
        })
      : await this.prisma.emergencyContact.create({
          data: {
            ...data,
            profile: { connect: { id: profile.id } },
          },
        });

    return {
      success: true,
      message: 'Emergency contact updated successfully',
      data: {
        emergencyContact: {
          contactId: contact.id,
          fullName: contact.name,
          email: (contact as any).email ?? null,
          phone: contact.phoneNumber,
          relationship: contact.relationship,
          updatedAt: new Date().toISOString(),
        },
      },
    };
  }

  async ensureOrderBelongsToLister(curatorId: string, orderId: string) {
    const hasItem = await this.prisma.orderItem.findFirst({
      where: {
        orderId,
        product: { curatorId },
      },
    });
    if (!hasItem) throw new ForbiddenException('Order not found or access denied');
  }

  // PUBLIC METHODS

  async getPublicListers(query: any) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      role: Role.LISTER,
      // Only active/verified listers ideally
      isVerified: true,
      isSuspended: false,
    };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { profile: { businessInfo: { businessName: { contains: query.search, mode: 'insensitive' } } } },
      ];
    }

    const [listers, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy:
          query.sort === 'newest'
            ? { createdAt: 'desc' }
            : { curatorReviews: { _count: 'desc' } }, // default sort by popularity/rating count
        select: {
          id: true,
          name: true,
          createdAt: true,
          isVerified: true,
          profile: {
            select: {
              avatarUpload: { select: { url: true } },
              businessInfo: {
                select: {
                  businessName: true,
                  businessDescription: true,
                },
              },
            },
          },
          _count: {
            select: {
              products: { where: { status: ProductStatus.AVAILABLE } },
              curatorReviews: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    const data = await Promise.all(
      listers.map(async (lister) => {
        // Calculate average rating
        const ratingAgg = await this.prisma.review.aggregate({
          where: { curatorId: lister.id },
          _avg: { rating: true },
        });

        return {
          id: lister.id,
          name: lister.profile?.businessInfo?.businessName || lister.name,
          avatar: lister.profile?.avatarUpload?.url || null,
          role: 'lister',
          rating: Math.round((ratingAgg._avg.rating || 0) * 10) / 10,
          reviewCount: lister._count.curatorReviews,
          shopDescription: lister.profile?.businessInfo?.businessDescription || '',
          itemCount: lister._count.products,
          joined: lister.createdAt,
          isVerified: lister.isVerified,
          featured: false, // logic for featured?
        };
      }),
    );

    return {
      success: true,
      data,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: limit,
      },
    };
  }

  async getPublicListerProfile(userId: string) {
    const lister = await this.prisma.user.findUnique({
      where: { id: userId, role: Role.LISTER },
      include: {
        profile: {
          include: {
            avatarUpload: { select: { url: true } },
            businessInfo: true,
            address: true,
          },
        },
        _count: {
          select: {
            products: { where: { status: ProductStatus.AVAILABLE } },
            curatorReviews: true,
          },
        },
      },
    });

    if (!lister) throw new NotFoundException('Lister not found');

    const ratingAgg = await this.prisma.review.aggregate({
      where: { curatorId: lister.id },
      _avg: { rating: true },
    });

    // Get featured products (e.g. recent 5 available)
    const featuredProducts = await this.prisma.product.findMany({
      where: {
        curatorId: lister.id,
        status: ProductStatus.AVAILABLE,
        isActive: true,
        productVerified: true,
      },
      take: 4,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        dailyPrice: true,
        attachments: {
          select: { uploads: { take: 1, select: { url: true } } },
        },
      },
    });

    // Get recent reviews
    const recentReviews = await this.prisma.review.findMany({
      where: { curatorId: lister.id },
      take: 2,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            name: true,
            profile: { select: { avatarUpload: { select: { url: true } } } },
          },
        },
      },
    });

    return {
      success: true,
      data: {
        user: {
          id: lister.id,
          name: lister.profile?.businessInfo?.businessName || lister.name,
          avatar: lister.profile?.avatarUpload?.url || null,
          role: 'lister',
          bio: lister.profile?.businessInfo?.businessDescription || '', // Use description as bio
          shopDescription: lister.profile?.businessInfo?.businessDescription || '',
          rating: Math.round((ratingAgg._avg.rating || 0) * 10) / 10,
          reviewCount: lister._count.curatorReviews,
          itemCount: lister._count.products,
          joined: lister.createdAt,
          isVerified: lister.isVerified,
          verificationDate: lister.updatedAt, // Approximate
          featured: false,
          shopPolicies: {
            returnPolicy: 'Full refund within 30 days of rental', // placeholder
            deliveryTime: '2-3 business days',
            cancellationPolicy: 'Free cancellation up to 48 hours before rental',
          },
          featuredProducts: featuredProducts.map((p) => ({
            id: p.id,
            name: p.name,
            dailyPrice: p.dailyPrice,
            image: p.attachments?.uploads?.[0]?.url || null,
          })),
          recentReviews: recentReviews.map((r) => ({
            reviewId: r.id,
            renterName: r.user.name,
            rating: r.rating,
            text: r.comment,
            date: r.createdAt,
          })),
        },
      },
    };
  }

  async getListerPublicProducts(userId: string, query: any) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      curatorId: userId,
      status: ProductStatus.AVAILABLE,
      isActive: true,
      productVerified: true,
    };

    if (query.category) {
      where.category = { name: { equals: query.category, mode: 'insensitive' } };
    }
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy:
          query.sort === 'price_low'
            ? { dailyPrice: 'asc' }
            : query.sort === 'price_high'
            ? { dailyPrice: 'desc' }
            : { createdAt: 'desc' }, // default newest
        include: {
          brand: { select: { name: true } },
          category: { select: { name: true } },
          attachments: {
            include: { uploads: { take: 1, select: { url: true } } },
          },
          _count: { select: { reviews: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    const data = await Promise.all(
      products.map(async (p) => {
        const ratingAgg = await this.prisma.review.aggregate({
          where: { productId: p.id },
          _avg: { rating: true },
        });
        return {
          id: p.id,
          name: p.name,
          brand: p.brand?.name || null,
          category: p.category?.name || null,
          dailyPrice: p.dailyPrice,
          image: p.attachments?.uploads?.[0]?.url || null,
          rating: Math.round((ratingAgg._avg.rating || 0) * 10) / 10,
          reviews: p._count.reviews,
          isInStock: p.status === ProductStatus.AVAILABLE,
        };
      }),
    );

    return {
      success: true,
      data: {
        products: data,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit,
        },
      },
    };
  }

  async getListerPublicReviews(userId: string, query: any) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const skip = (page - 1) * limit;

    const where = {
      curatorId: userId,
      // Only show reviews for completed rentals? Or all reviews?
      // Assuming all public reviews are okay
    };

    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy:
          query.sort === 'oldest'
            ? { createdAt: 'asc' }
            : query.sort === 'rating_high'
            ? { rating: 'desc' }
            : query.sort === 'rating_low'
            ? { rating: 'asc' }
            : { createdAt: 'desc' }, // default newest
        include: {
          user: {
            select: {
              name: true,
              profile: { select: { avatarUpload: { select: { url: true } } } },
            },
          },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    const ratingAgg = await this.prisma.review.aggregate({
      where: { curatorId: userId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    
    // Count 5-star reviews
    const fiveStarCount = await this.prisma.review.count({
      where: { curatorId: userId, rating: 5 },
    });

    const data = reviews.map((r) => ({
      id: r.id,
      name: r.user.name,
      avatarUrl: r.user.profile?.avatarUpload?.url || null,
      rating: r.rating,
      comment: r.comment,
      date: r.createdAt,
      isMostHelpful: r.rating === 5 && (r.comment?.length ?? 0) > 50, // simple heuristic
    }));

    return {
      success: true,
      data: {
        reviews: data,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit,
        },
        summary: {
          totalReviews: total,
          averageRating: Math.round((ratingAgg._avg.rating || 0) * 10) / 10,
          fiveStarCount,
        },
      },
    };
  }
}
