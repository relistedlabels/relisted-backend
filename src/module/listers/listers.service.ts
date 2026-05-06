import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { userEntity } from '../auth/auth.types';
import {
  DisputeStatus,
  ListingType,
  Message,
  OrderStatus,
  ProductStatus,
  Role,
} from '@prisma/client';
import {
  differenceInSeconds,
  subMonths,
  startOfMonth,
  endOfMonth,
  subYears,
  startOfYear,
  endOfYear,
  format,
} from 'date-fns';
import { randomUUID } from 'crypto';
import { WemaServiceService } from 'src/services/wema-service/wema-service.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { UploadService } from '../upload/upload.service';
import {
  buildDefaultDispatchWindow,
  DispatchWindowRangeMap,
  DispatchWindowType,
} from 'src/utils/dispatch-windows';
import { releaseRentalEscrowOnOutboundDelivery } from '../order/release-rental-escrow-on-delivery';
import { ProductAvailabilityNotifyService } from 'src/services/product-availability-notify/product-availability-notify.service';

const CURRENCY = 'NGN';

const formatLocalDate = (value: Date | string) =>
  new Date(value).toLocaleDateString('en-CA', {
    timeZone: 'Africa/Lagos',
  });

// Order status mapping for listers API
const ORDER_STATUS_TO_LABEL: Record<OrderStatus, string> = {
  [OrderStatus.PROCESSING]: 'Processing',
  [OrderStatus.ACCEPTED]: 'Accepted',
  [OrderStatus.CONFIRMED]: 'Confirmed',
  [OrderStatus.IN_TRANSIT]: 'In Transit',
  [OrderStatus.DELIVERED]: 'Delivered',
  [OrderStatus.ACTIVE]: 'Active',
  [OrderStatus.RETURN_DUE]: 'Awaiting return',
  [OrderStatus.IN_DISPUTE]: 'In Dispute',
  [OrderStatus.RETURNED]: 'Return received',
  [OrderStatus.COMPLETED]: 'Completed',
  [OrderStatus.CANCELLED]: 'Cancelled',
  [OrderStatus.REJECTED]: 'Rejected',
};

const ORDER_STATUS_TO_API: Record<OrderStatus, string> = {
  [OrderStatus.PROCESSING]: 'processing',
  [OrderStatus.ACCEPTED]: 'accepted',
  [OrderStatus.CONFIRMED]: 'confirmed',
  [OrderStatus.IN_TRANSIT]: 'intransit',
  [OrderStatus.DELIVERED]: 'delivered',
  [OrderStatus.ACTIVE]: 'active',
  [OrderStatus.RETURN_DUE]: 'return_due',
  [OrderStatus.IN_DISPUTE]: 'in_dispute',
  [OrderStatus.RETURNED]: 'returned',
  [OrderStatus.COMPLETED]: 'completed',
  [OrderStatus.CANCELLED]: 'cancelled',
  [OrderStatus.REJECTED]: 'rejected',
};

const RENTAL_STATUS_TO_LABEL: Record<string, string> = {
  DELIVERED: 'Delivered',
  RETURN_DUE: 'Awaiting return',
  ACTIVE: 'Active',
  COMPLETED: 'Completed',
  RETURNED: 'Return received',
};

const RENTAL_STATUS_TO_TYPE: Record<string, string> = {
  DELIVERED: 'delivered',
  RETURN_DUE: 'return_due',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  RETURNED: 'returned',
};

const PROGRESS_STEPS = [
  {
    id: 1,
    label: 'Approved',
    icon: 'check-circle',
    orderStatus: OrderStatus.ACCEPTED,
  },
  {
    id: 2,
    label: 'Dispatched',
    icon: 'truck',
    orderStatus: OrderStatus.CONFIRMED,
  },
  {
    id: 3,
    label: 'In Transit',
    icon: 'package',
    orderStatus: OrderStatus.IN_TRANSIT,
  },
  {
    id: 4,
    label: 'Delivered',
    icon: 'home',
    orderStatus: OrderStatus.DELIVERED,
  },
  {
    id: 5,
    label: 'Awaiting return',
    icon: 'reply',
    orderStatus: OrderStatus.RETURN_DUE,
  },
  {
    id: 6,
    label: 'Return received',
    icon: 'check-circle',
    orderStatus: OrderStatus.RETURNED,
  },
  {
    id: 7,
    label: 'Completed',
    icon: 'smile',
    orderStatus: OrderStatus.COMPLETED,
  },
];

/** Matches rental UI: Topship booking not finished vs carrier booked (listers OrderProgress). */
const LISTER_OUTBOUND_BOOKED = new Set([
  'DISPATCHING',
  'DISPATCHED',
  'IN_TRANSIT',
  'COMPLETED',
]);

function listerRentalProgressStepIndex(
  status: OrderStatus,
  myOutboundLegs: ReadonlyArray<{ status: string }>,
): number {
  const myBooked =
    myOutboundLegs.length > 0 &&
    myOutboundLegs.every((l) => LISTER_OUTBOUND_BOOKED.has(l.status));
  switch (status) {
    case OrderStatus.PROCESSING:
      return 0;
    case OrderStatus.ACCEPTED:
      return 1;
    case OrderStatus.CONFIRMED:
      return myBooked ? 4 : 3;
    case OrderStatus.IN_TRANSIT:
      return 4;
    case OrderStatus.DELIVERED:
    case OrderStatus.ACTIVE:
      return 5;
    case OrderStatus.RETURN_DUE:
      return 6;
    case OrderStatus.RETURNED:
      return 7;
    case OrderStatus.COMPLETED:
      return 8;
    case OrderStatus.IN_DISPUTE:
      return 5;
    default:
      return 0;
  }
}

const RENTAL_LISTER_PROGRESS_UI = [
  { label: 'Pending', icon: 'clock' },
  { label: 'Approved', icon: 'check-circle' },
  { label: 'Dispatched', icon: 'truck' },
  { label: 'Processing pickup', icon: 'package' },
  { label: 'In transit', icon: 'truck' },
  { label: 'Delivered', icon: 'home' },
  { label: 'Awaiting return', icon: 'reply' },
  { label: 'Return received', icon: 'check-circle' },
  { label: 'Completed', icon: 'smile' },
] as const;

@Injectable()
export class ListersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wemaService: WemaServiceService,
    private readonly notificationService: NotificationService,
    private readonly uploadService: UploadService,
    private readonly productAvailabilityNotifyService: ProductAvailabilityNotifyService,
  ) {}

  private buildExternalTrackingUrl(trackingNumber: string) {
    const trimmed = trackingNumber.trim();
    if (!trimmed) return null;
    return `https://ship.topship.africa/tracking/${encodeURIComponent(trimmed)}`;
  }

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
          price:
            p.listingType === 'RESALE'
              ? (p.resalePrice ?? p.originalValue)
              : (p.originalValue ?? (p.dailyPrice ? p.dailyPrice * 10 : 0)),
          currency: CURRENCY,
          availability:
            p.status === ProductStatus.AVAILABLE && p.isActive
              ? 'available'
              : 'unavailable',
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
          statusType:
            RENTAL_STATUS_TO_TYPE[orderStatus] ?? orderStatus.toLowerCase(),
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

  /** PENDING + past expiresAt should read as EXPIRED so lists and approve/reject stay honest. */
  private async expireStalePendingAvailabilityRequests(listerId: string) {
    await this.prisma.availabilityRequest.updateMany({
      where: {
        listerId,
        status: 'PENDING',
        expiresAt: { lte: new Date() },
      },
      data: { status: 'EXPIRED' },
    });
  }

  /** GET /api/listers/orders - returns AvailabilityRequests for pending, Orders for ongoing/completed */
  async getOrders(
    user: userEntity,
    status: string | undefined,
    page: number = 1,
    limit: number = 20,
    sort: string = '-createdAt',
  ) {
    try {
      await this.expireStalePendingAvailabilityRequests(user.id);

      const skip = (page - 1) * limit;
      const targetStatus = status?.toLowerCase() || 'all';

      let allItems: any[] = [];
      let total = 0;

      // 1. Fetch pending requests (AvailabilityRequests)
      if (['all', 'pending', 'pending_approval'].includes(targetStatus)) {
        const [pendingCount, pendingReqs] = await Promise.all([
          this.prisma.availabilityRequest.count({
            where: { listerId: user.id, status: 'PENDING' },
          }),
          this.prisma.availabilityRequest.findMany({
            where: { listerId: user.id, status: 'PENDING' },
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
                    include: { uploads: { take: 1, select: { url: true } } },
                  },
                },
              },
            },
          }),
        ]);

        // Fetch users for these requests (Prisma lacks requester relation in standard way, must fetch manually if relation isn't mapped, but here we can just join or map)
        // For simplicity, we fetch users separately
        const userIds = [...new Set(pendingReqs.map((r) => r.requesterId))];
        const users = await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          include: {
            profile: { select: { avatarUpload: { select: { url: true } } } },
          },
        });
        const userMap = new Map(users.map((u) => [u.id, u]));

        const formattedPending = pendingReqs.map((r) => {
          const u = userMap.get(r.requesterId);
          const diff = Math.max(
            0,
            Math.floor((new Date(r.expiresAt).getTime() - Date.now()) / 1000),
          );
          return {
            id: r.id, // Using request ID
            orderNumber: `REQ-${r.id.slice(0, 8)}`,
            createdAt: r.createdAt.toISOString(),
            expiresAt: r.expiresAt.toISOString(),
            timeRemainingSeconds: diff,
            status: 'pending_approval',
            statusLabel: 'Pending Approval',
            statusColor: '#FFF3E0',
            statusTextColor: '#E65100',
            itemCount: 1,
            totalAmount: r.totalPrice || 0,
            currency: CURRENCY,
            dresser: u
              ? {
                  id: u.id,
                  name: u.name,
                  avatar:
                    u.profile?.avatarUpload?.url ??
                    'https://via.placeholder.com/64?text=U',
                  rating: 0,
                  reviews: 0,
                  memberSince: u.createdAt.toISOString().split('T')[0],
                }
              : null,
            items: [
              {
                id: r.productId,
                name: r.product.name,
                image:
                  r.product.attachments?.uploads?.[0]?.url ??
                  'https://via.placeholder.com/300?text=No+Image',
                size: r.product.measurement ?? 'N/A',
                color: r.product.color ?? 'N/A',
                rentalFee: r.totalPrice || 0,
                itemValue: r.product.originalValue || 0,
                returnDue: r.endDate
                  ? new Date(r.endDate).toISOString().split('T')[0]
                  : null,
                status: 'pending_approval',
                statusLabel: 'Pending Approval',
              },
            ],
            canApprove: diff > 0,
            canReject: diff > 0,
            approvalRequired: true,
            approvalExpiredAt: r.expiresAt.toISOString(),
          };
        });

        allItems = [...allItems, ...formattedPending];
        total += pendingCount;
      }

      // 1b. ACCEPTED availability — lister approved; renter has not paid / no Order row yet
      // ORDERED requests are excluded (they've been converted to actual orders)
      if (['all', 'ongoing'].includes(targetStatus)) {
        const [acceptedCount, acceptedReqs] = await Promise.all([
          this.prisma.availabilityRequest.count({
            where: { listerId: user.id, status: 'ACCEPTED' },
          }),
          this.prisma.availabilityRequest.findMany({
            where: { listerId: user.id, status: 'ACCEPTED' },
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
                    include: { uploads: { take: 1, select: { url: true } } },
                  },
                },
              },
            },
          }),
        ]);

        const accUserIds = [...new Set(acceptedReqs.map((r) => r.requesterId))];
        const accUsers =
          accUserIds.length === 0
            ? []
            : await this.prisma.user.findMany({
                where: { id: { in: accUserIds } },
                include: {
                  profile: {
                    select: { avatarUpload: { select: { url: true } } },
                  },
                },
              });
        const accUserMap = new Map(accUsers.map((u) => [u.id, u]));

        const formattedAccepted = acceptedReqs.map((r) => {
          const u = accUserMap.get(r.requesterId);
          return {
            id: r.id,
            orderNumber: `REQ-${r.id.slice(0, 8)}`,
            createdAt: r.createdAt.toISOString(),
            expiresAt: r.expiresAt.toISOString(),
            timeRemainingSeconds: 0,
            status: 'awaiting_payment',
            statusLabel: 'Awaiting renter payment',
            statusColor: '#E8F5E9',
            statusTextColor: '#2E7D32',
            itemCount: 1,
            totalAmount: r.totalPrice || 0,
            currency: CURRENCY,
            dresser: u
              ? {
                  id: u.id,
                  name: u.name,
                  avatar:
                    u.profile?.avatarUpload?.url ??
                    'https://via.placeholder.com/64?text=U',
                  rating: 0,
                  reviews: 0,
                  memberSince: u.createdAt.toISOString().split('T')[0],
                }
              : null,
            items: [
              {
                id: r.productId,
                name: r.product.name,
                image:
                  r.product.attachments?.uploads?.[0]?.url ??
                  'https://via.placeholder.com/300?text=No+Image',
                size: r.product.measurement ?? 'N/A',
                color: r.product.color ?? 'N/A',
                rentalFee: r.totalPrice || 0,
                itemValue: r.product.originalValue || 0,
                returnDue: r.endDate
                  ? new Date(r.endDate).toISOString().split('T')[0]
                  : null,
                status: 'awaiting_payment',
                statusLabel: 'Awaiting renter payment',
              },
            ],
            canApprove: false,
            canReject: false,
            approvalRequired: false,
            approvalExpiredAt: r.expiresAt.toISOString(),
            availabilityStatus: 'ACCEPTED',
          };
        });

        allItems = [...allItems, ...formattedAccepted];
        total += acceptedCount;
      }

      // 1c. Closed availability (declined, expired, renter withdrew) — same bucket as "cancelled" for listers
      if (['all', 'cancelled'].includes(targetStatus)) {
        const terminalStatuses = [
          'REJECTED',
          'EXPIRED',
          'CANCELLED_BY_RENTER',
        ] as const;
        const terminalWhere = {
          listerId: user.id,
          status: { in: [...terminalStatuses] },
        };
        const [terminalCount, terminalReqs] = await Promise.all([
          this.prisma.availabilityRequest.count({ where: terminalWhere }),
          this.prisma.availabilityRequest.findMany({
            where: terminalWhere,
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
                    include: { uploads: { take: 1, select: { url: true } } },
                  },
                },
              },
            },
          }),
        ]);

        const termUserIds = [
          ...new Set(terminalReqs.map((r) => r.requesterId)),
        ];
        const termUsers =
          termUserIds.length === 0
            ? []
            : await this.prisma.user.findMany({
                where: { id: { in: termUserIds } },
                include: {
                  profile: {
                    select: { avatarUpload: { select: { url: true } } },
                  },
                },
              });
        const termUserMap = new Map(termUsers.map((u) => [u.id, u]));

        const terminalLabels: Record<
          string,
          { status: string; label: string; color: string; text: string }
        > = {
          REJECTED: {
            status: 'declined',
            label: 'Declined',
            color: '#FFEBEE',
            text: '#C62828',
          },
          EXPIRED: {
            status: 'expired',
            label: 'Expired',
            color: '#ECEFF1',
            text: '#546E7A',
          },
          CANCELLED_BY_RENTER: {
            status: 'cancelled_by_renter',
            label: 'Cancelled by renter',
            color: '#ECEFF1',
            text: '#546E7A',
          },
        };

        const formattedTerminal = terminalReqs.map((r) => {
          const u = termUserMap.get(r.requesterId);
          const meta = terminalLabels[r.status] ?? {
            status: 'closed',
            label: 'Closed',
            color: '#ECEFF1',
            text: '#546E7A',
          };
          return {
            id: r.id,
            orderNumber: `REQ-${r.id.slice(0, 8)}`,
            createdAt: r.createdAt.toISOString(),
            expiresAt: r.expiresAt.toISOString(),
            timeRemainingSeconds: 0,
            status: meta.status,
            statusLabel: meta.label,
            statusColor: meta.color,
            statusTextColor: meta.text,
            itemCount: 1,
            totalAmount: r.totalPrice || 0,
            currency: CURRENCY,
            dresser: u
              ? {
                  id: u.id,
                  name: u.name,
                  avatar:
                    u.profile?.avatarUpload?.url ??
                    'https://via.placeholder.com/64?text=U',
                  rating: 0,
                  reviews: 0,
                  memberSince: u.createdAt.toISOString().split('T')[0],
                }
              : null,
            items: [
              {
                id: r.productId,
                name: r.product.name,
                image:
                  r.product.attachments?.uploads?.[0]?.url ??
                  'https://via.placeholder.com/300?text=No+Image',
                size: r.product.measurement ?? 'N/A',
                color: r.product.color ?? 'N/A',
                rentalFee: r.totalPrice || 0,
                itemValue: r.product.originalValue || 0,
                returnDue: r.endDate
                  ? new Date(r.endDate).toISOString().split('T')[0]
                  : null,
                status: meta.status,
                statusLabel: meta.label,
              },
            ],
            canApprove: r.status === 'EXPIRED',
            canReject: r.status === 'EXPIRED',
            approvalRequired: r.status === 'EXPIRED',
            approvalExpiredAt: r.expiresAt.toISOString(),
            availabilityStatus: r.status,
          };
        });

        allItems = [...allItems, ...formattedTerminal];
        total += terminalCount;
      }

      // 2. Fetch active/completed orders
      if (['all', 'ongoing', 'completed', 'cancelled'].includes(targetStatus)) {
        const orderWhere: any = {
          orderItems: { some: { product: { curatorId: user.id } } },
        };
        const statusFilter = this.mapStatusToOrderStatuses(status);
        if (statusFilter && statusFilter.length > 0) {
          orderWhere.status = { in: statusFilter };
        }

        const [orderCount, orders] = await Promise.all([
          this.prisma.order.count({ where: orderWhere }),
          this.prisma.order.findMany({
            where: orderWhere,
            include: {
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
                      listingType: true,
                      resalePrice: true,
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
        ]);

        const formattedOrders = orders.map((o) => this.formatOrderForList(o));
        allItems = [...allItems, ...formattedOrders];
        total += orderCount;
      }

      // 3. Sort and Paginate
      const isDesc = sort?.startsWith('-');
      allItems.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return isDesc ? dateB - dateA : dateA - dateB;
      });

      const paginatedItems = allItems.slice(skip, skip + limit);
      const pages = Math.ceil(total / limit) || 1;
      const summary = await this.getOrdersSummary(user.id);

      return {
        success: true,
        data: {
          orders: paginatedItems,
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
      // First check if it's an AvailabilityRequest
      const req = await this.prisma.availabilityRequest.findUnique({
        where: { id: orderId },
        include: {
          product: {
            include: {
              attachments: { include: { uploads: true } },
            },
          },
        },
      });

      if (req && req.listerId === user.id) {
        // return formatted request as order detail
        const u = await this.prisma.user.findUnique({
          where: { id: req.requesterId },
          include: { profile: { include: { avatarUpload: true } } },
        });
        return {
          success: true,
          data: { order: this.formatRequestDetail(req, u) },
        };
      }

      await this.ensureOrderBelongsToLister(user.id, orderId);
      const order = await (this.prisma.order as any).findUnique({
        where: { id: orderId },
        include: {
          rentals: true,
          returnRequests: true,
          shipments: {
            select: {
              type: true,
              scheduledDate: true,
              scheduledWindowStart: true,
              scheduledWindowEnd: true,
            },
            orderBy: { scheduledDate: 'asc' },
          },
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
                  collateralPrice: true,
                  dailyPrice: true,
                  listingType: true,
                  resalePrice: true,
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
      const productIds = [
        ...new Set(
          order.orderItems.map((oi: any) => String(oi.productId)),
        ),
      ] as string[];
      const availabilityRequests =
        productIds.length > 0
          ? await this.prisma.availabilityRequest.findMany({
              where: {
                requesterId: order.userId,
                productId: { in: productIds },
                status: 'ACCEPTED',
              },
              orderBy: { createdAt: 'desc' },
            })
          : [];
      const reviewsCount = await this.prisma.review.count({
        where: { userId: order.userId },
      });
      const orderFormatted = this.formatOrderDetail(
        order,
        reviewsCount,
        availabilityRequests,
      );
      return { success: true, data: { order: orderFormatted } };
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException)
        throw e;
      console.error('getOrderById error:', e);
      throw new InternalServerErrorException('Failed to fetch order');
    }
  }

  private formatRequestDetail(req: any, user: any) {
    const diff = Math.max(
      0,
      Math.floor((new Date(req.expiresAt).getTime() - Date.now()) / 1000),
    );
    const statusMeta: Record<
      string,
      {
        status: string;
        label: string;
        color: string;
        textColor: string;
        step: string;
      }
    > = {
      PENDING: {
        status: 'pending_approval',
        label: 'Pending Approval',
        color: '#FFF3E0',
        textColor: '#E65100',
        step: 'pending_approval',
      },
      ACCEPTED: {
        status: 'approved',
        label: 'Approved — awaiting renter payment',
        color: '#E8F5E9',
        textColor: '#2E7D32',
        step: 'awaiting_payment',
      },
      REJECTED: {
        status: 'rejected',
        label: 'Rejected',
        color: '#FFEBEE',
        textColor: '#C62828',
        step: 'rejected',
      },
      EXPIRED: {
        status: 'expired',
        label: 'Expired',
        color: '#ECEFF1',
        textColor: '#546E7A',
        step: 'expired',
      },
      CANCELLED_BY_RENTER: {
        status: 'cancelled_by_renter',
        label: 'Cancelled by renter',
        color: '#ECEFF1',
        textColor: '#546E7A',
        step: 'cancelled_by_renter',
      },
    };
    const meta = statusMeta[req.status] ?? statusMeta.PENDING;
    return {
      id: req.id,
      orderNumber: `REQ-${req.id.slice(0, 8)}`,
      createdAt: req.createdAt.toISOString(),
      expiresAt: req.expiresAt.toISOString(),
      timeRemainingSeconds: diff,
      availabilityStatus: req.status,
      status: meta.status,
      statusLabel: meta.label,
      statusColor: meta.color,
      statusTextColor: meta.textColor,
      itemCount: 1,
      totalAmount: req.totalPrice || 0,
      currency: CURRENCY,
      dresser: {
        id: user?.id,
        name: user?.name,
        avatar:
          user?.profile?.avatarUpload?.url ??
          'https://via.placeholder.com/64?text=U',
        rating: 0,
        reviews: 0,
        memberSince: user?.createdAt?.toISOString().split('T')[0],
      },
      items: [
        {
          id: req.productId,
          name: req.product.name,
          image:
            req.product.attachments?.uploads?.[0]?.url ??
            'https://via.placeholder.com/300?text=No+Image',
          size: req.product.measurement ?? 'N/A',
          color: req.product.color ?? 'N/A',
          days: req.rentalDays,
          listingType: req.product.listingType,
          purchasePrice: req.product.resalePrice || 0,
          rentalFee: req.totalPrice || 0,
          itemValue: req.product.originalValue || 0,
          returnDue: req.returnWindowEnd
            ? formatLocalDate(req.returnWindowEnd)
            : req.endDate
              ? formatLocalDate(req.endDate)
              : null,
          status: meta.status,
          statusLabel: meta.label,
        },
      ],
      canApprove: req.status === 'PENDING' || req.status === 'EXPIRED',
      canReject: req.status === 'PENDING' || req.status === 'EXPIRED',
      approvalRequired: req.status === 'PENDING' || req.status === 'EXPIRED',
      approvalExpiredAt: req.expiresAt.toISOString(),
      rejectionReason: req.rejectionReason ?? null,
      dispatchWindows: this.formatDispatchWindowsFromRequest(req),
      timeline: {
        dateOrdered: formatLocalDate(req.createdAt),
        itemsCount: 1,
        itemsDelivered: 0,
        currentStep: meta.step,
      },
      // For resale requests (rentalDays === 0 for RESALE/RENT_OR_RESALE), escrow only holds purchase price
      escrow: {
        rentalFeeTotal: req.rentalDays === 0 ? 0 : req.totalPrice || 0,
        itemValueHeld:
          req.rentalDays === 0
            ? 0
            : this.rentalDepositNgn({ product: req.product }),
        purchasePrice:
          req.rentalDays === 0
            ? req.product.resalePrice || req.totalPrice || 0
            : 0,
        totalHeld:
          req.rentalDays === 0
            ? req.product.resalePrice || req.totalPrice || 0
            : (req.totalPrice || 0) +
              this.rentalDepositNgn({ product: req.product }),
        currency: CURRENCY,
        releaseCondition:
          req.rentalDays === 0
            ? 'Upon buyer confirmation of receipt'
            : 'Upon successful return confirmation',
      },
    };
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
                  listingType: true,
                  resalePrice: true,
                  attachments: {
                    include: {
                      uploads: { take: 1, select: { url: true } },
                    },
                  },
                },
              },
            },
          },
          rentals: true,
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      const rental = order.rentals?.[0];
      const items = order.orderItems.map((oi) => ({
        id: oi.product.id,
        name: oi.product.name,
        image:
          oi.product.attachments?.uploads?.[0]?.url ??
          'https://via.placeholder.com/300x300?text=No+Image',
        size: oi.product.measurement ?? 'N/A',
        color: oi.product.color ?? 'N/A',
        days: oi.days,
        listingType: oi.product.listingType,
        purchasePrice: oi.product.resalePrice || 0,
        returnDue:
          oi.days === 0 &&
          (oi.product.listingType === 'RESALE' ||
            oi.product.listingType === 'RENT_OR_RESALE')
            ? null
            : rental
              ? rental.endDate.toISOString().split('T')[0]
              : new Date().toISOString().split('T')[0],
        returnDueDate:
          oi.days === 0 &&
          (oi.product.listingType === 'RESALE' ||
            oi.product.listingType === 'RENT_OR_RESALE')
            ? null
            : (rental?.endDate?.toISOString() ?? new Date().toISOString()),
        rentalFee:
          oi.days === 0 &&
          (oi.product.listingType === 'RESALE' ||
            oi.product.listingType === 'RENT_OR_RESALE')
            ? oi.product.resalePrice || 0
            : (oi.pricePerDay ?? oi.product.dailyPrice) * oi.days,
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
      if (e instanceof NotFoundException || e instanceof ForbiddenException)
        throw e;
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
        select: {
          id: true,
          status: true,
          createdAt: true,
          listingType: true,
          shipments: {
            where: { type: 'OUTBOUND', listerId: user.id },
            select: {
              id: true,
              status: true,
              scheduledDate: true,
              scheduledWindowStart: true,
              scheduledWindowEnd: true,
              trackingId: true,
              providerTrackingUrl: true,
              dispatchedAt: true,
            },
          },
        },
      });
      if (!order) throw new NotFoundException('Order not found');
      const currentStep =
        ORDER_STATUS_TO_API[order.status] ?? order.status.toLowerCase();

      const isPureResale =
        order.listingType === ListingType.RESALE ||
        order.listingType === ListingType.RENT_OR_RESALE;

      let currentStepIndex: number;
      let steps: Array<{
        id: number;
        label: string;
        icon: string;
        completed: boolean;
        current: boolean;
        timestamp: null;
      }>;
      let progressPercentage: number;

      if (isPureResale && order.listingType === ListingType.RESALE) {
        const stepIndex = PROGRESS_STEPS.findIndex(
          (s) =>
            s.orderStatus === order.status ||
            s.label.toLowerCase().replace(' ', '_') === currentStep,
        );
        currentStepIndex =
          order.status === OrderStatus.PROCESSING ? 0 : Math.max(0, stepIndex);
        steps = PROGRESS_STEPS.map((s, i) => ({
          id: s.id,
          label: s.label,
          icon: s.icon,
          completed: i < currentStepIndex,
          current: i === currentStepIndex,
          timestamp: null,
        }));
        progressPercentage = Math.round(
          (currentStepIndex / (PROGRESS_STEPS.length - 1)) * 100,
        );
      } else {
        const myOutbound = order.shipments ?? [];
        currentStepIndex = listerRentalProgressStepIndex(
          order.status,
          myOutbound,
        );
        steps = RENTAL_LISTER_PROGRESS_UI.map((s, i) => ({
          id: i + 1,
          label: s.label,
          icon: s.icon,
          completed: i < currentStepIndex,
          current: i === currentStepIndex,
          timestamp: null,
        }));
        progressPercentage = Math.round(
          (currentStepIndex / (RENTAL_LISTER_PROGRESS_UI.length - 1)) * 100,
        );
      }

      return {
        success: true,
        data: {
          currentStep,
          currentStepIndex,
          steps,
          progressPercentage,
          orderId: order.id,
          myOutboundShipments:
            order.listingType === ListingType.RESALE
              ? []
              : (order.shipments ?? []).map((s) => ({
                  shipmentId: s.id,
                  status: s.status,
                  scheduledDate: s.scheduledDate.toISOString(),
                  trackingId: s.trackingId,
                  providerTrackingUrl: s.providerTrackingUrl,
                  isBooked: LISTER_OUTBOUND_BOOKED.has(s.status),
                })),
        },
      };
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException)
        throw e;
      console.error('getOrderProgress error:', e);
      throw new InternalServerErrorException('Failed to fetch order progress');
    }
  }

  /** POST /api/listers/orders/:orderId/approve
   *  Approve an AvailabilityRequest (Pending order)
   */
  async approveOrder(user: userEntity, orderId: string, notes?: string) {
    try {
      const request = await this.prisma.availabilityRequest.findUnique({
        where: { id: orderId },
        include: { product: true, requester: true },
      });

      if (!request) {
        throw new NotFoundException('Order/Request not found');
      }

      if (request.listerId !== user.id) {
        throw new ForbiddenException('You do not have access to this request');
      }

      if (
        !['PENDING', 'EXPIRED'].includes(request.status) ||
        !request.expiresAt
      ) {
        throw new ForbiddenException(
          'Request is not in a state that can be approved',
        );
      }

      const updated = await this.prisma.availabilityRequest.update({
        where: { id: orderId },
        data: {
          status: 'ACCEPTED',
        },
      });

      // Notify Renter
      const isPurchaseRequest = request.rentalDays === 0;
      await this.notificationService.createNotification({
        userId: request.requesterId,
        title: isPurchaseRequest
          ? 'Purchase Request Approved'
          : 'Rental Request Approved',
        message: `Good news! Your ${isPurchaseRequest ? 'purchase' : 'rental'} request for ${(request as any).product?.name} has been approved. Please proceed to payment.`,
        type: 'RENTAL_RESPONSE',
        metadata: {
          requestId: request.id,
          productId: request.productId,
          status: 'ACCEPTED',
        },
        sendEmail: true,
        emailData: {
          email: (request as any).requester?.email,
          userName: (request as any).requester?.name,
          productName: (request as any).product?.name,
          status: 'accepted',
          requestId: request.id,
          reason: notes || 'No additional notes provided.',
          checkoutLink: `${process.env.CLIENT_URL}/shop/cart/checkout`,
          requestType: isPurchaseRequest ? 'purchase' : 'rental',
        },
      });

      return {
        success: true,
        message: 'Order approved successfully',
        data: {
          orderId: updated.id,
          orderNumber: `REQ-${updated.id.slice(0, 8)}`,
          status: 'approved',
          statusLabel: 'Approved',
          approvedAt: new Date().toISOString(),
          approvedBy: user.id,
          nextSteps:
            'Waiting for renter to complete payment and create the official Order',
          notes: notes ?? null,
        },
      };
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException) {
        throw e;
      }
      console.error('approveOrder error:', e);
      throw new InternalServerErrorException('Failed to approve order');
    }
  }

  /** POST /api/listers/orders/:orderId/reject
   *  Reject an AvailabilityRequest (Pending order)
   */
  async rejectOrder(
    user: userEntity,
    orderId: string,
    body: { reason: string; notes?: string; refundType?: string },
  ) {
    try {
      const request = await this.prisma.availabilityRequest.findUnique({
        where: { id: orderId },
        include: { product: true, requester: true },
      });

      if (!request) {
        throw new NotFoundException('Order/Request not found');
      }

      if (request.listerId !== user.id) {
        throw new ForbiddenException('You do not have access to this request');
      }

      if (
        !['PENDING', 'EXPIRED'].includes(request.status) ||
        !request.expiresAt
      ) {
        throw new ForbiddenException(
          'Request is not in a state that can be rejected',
        );
      }

      const updated = await this.prisma.availabilityRequest.update({
        where: { id: orderId },
        data: {
          status: 'REJECTED',
          rejectionReason: body.notes || body.reason,
        },
      });

      // Notify Renter
      const isPurchaseRequest = request.rentalDays === 0;
      await this.notificationService.createNotification({
        userId: request.requesterId,
        title: isPurchaseRequest
          ? 'Purchase Request Declined'
          : 'Rental Request Declined',
        message: `Unfortunately, your ${isPurchaseRequest ? 'purchase' : 'rental'} request for ${(request as any).product?.name} was declined. Reason: ${body.reason}${body.notes ? `. Notes: ${body.notes}` : ''}`,
        type: 'RENTAL_RESPONSE',
        metadata: {
          requestId: request.id,
          productId: request.productId,
          status: 'REJECTED',
        },
        sendEmail: true,
        emailData: {
          email: (request as any).requester?.email,
          userName: (request as any).requester?.name,
          productName: (request as any).product?.name,
          status: 'rejected',
          requestId: request.id,
          reason: body.reason,
          notes: body.notes || body.reason || 'No additional notes provided.',
          requestType: isPurchaseRequest ? 'purchase' : 'rental',
        },
      });

      return {
        success: true,
        message: 'Order rejected',
        data: {
          orderId: updated.id,
          orderNumber: `REQ-${updated.id.slice(0, 8)}`,
          status: 'rejected',
          statusLabel: 'Rejected',
          rejectedAt: new Date().toISOString(),
          rejectedBy: user.id,
          reason: body.reason,
          notes: body.notes ?? null,
        },
      };
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException) {
        throw e;
      }
      console.error('rejectOrder error:', e);
      throw new InternalServerErrorException('Failed to reject order');
    }
  }

  /**
   * POST /api/listers/orders/:orderId/nudge-renter
   * In-app ping when an availability request is EXPIRED so the renter can re-request or hear the item is still available.
   */
  async nudgeRenterForAvailabilityRequest(
    user: userEntity,
    requestId: string,
    intent: 'rerequest' | 'now_available',
  ) {
    if (intent !== 'rerequest' && intent !== 'now_available') {
      throw new BadRequestException(
        'intent must be "rerequest" or "now_available"',
      );
    }

    try {
      const request = await this.prisma.availabilityRequest.findUnique({
        where: { id: requestId },
        include: { product: true, requester: true },
      });

      if (!request) {
        throw new NotFoundException('Request not found');
      }
      if (request.listerId !== user.id) {
        throw new ForbiddenException('You do not have access to this request');
      }
      if (request.status !== 'EXPIRED') {
        throw new BadRequestException(
          'Reminders can only be sent for expired availability requests.',
        );
      }

      const productName = request.product?.name ?? 'this item';
      const isPurchaseRequest = (request.rentalDays ?? 0) === 0;
      const listerName = user.name || 'The curator';

      if (intent === 'rerequest') {
        await this.notificationService.createNotification({
          userId: request.requesterId,
          title: isPurchaseRequest
            ? 'Curator asked you to send a new purchase request'
            : 'Curator asked you to send a new rental request',
          message: `${listerName} could not respond in time earlier. If you still want ${productName}, open your cart and tap Request approval again.`,
          type: 'AVAILABILITY_REQUEST_REMINDER',
          metadata: {
            requestId: request.id,
            productId: request.productId,
            intent: 'rerequest',
          },
          sendEmail: false,
        });
      } else {
        await this.notificationService.createNotification({
          userId: request.requesterId,
          title: isPurchaseRequest
            ? 'Curator says the item may still be available'
            : 'Curator says the rental may still be available',
          message: `${listerName} is ready when you are. If you still want ${productName}, open your cart and send a new availability request.`,
          type: 'AVAILABILITY_REQUEST_REMINDER',
          metadata: {
            requestId: request.id,
            productId: request.productId,
            intent: 'now_available',
          },
          sendEmail: false,
        });
      }

      return {
        success: true,
        message: 'Renter notified',
        data: { requestId: request.id, intent },
      };
    } catch (e) {
      if (
        e instanceof NotFoundException ||
        e instanceof ForbiddenException ||
        e instanceof BadRequestException
      ) {
        throw e;
      }
      console.error('nudgeRenterForAvailabilityRequest error:', e);
      throw new InternalServerErrorException('Failed to notify renter');
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
        include: { user: true, orderItems: { include: { product: true } } },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      const mapped = this.mapApiStatusToOrderStatus(body.status);
      if (!mapped) {
        throw new ForbiddenException('Unsupported status transition');
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
        await releaseRentalEscrowOnOutboundDelivery(
          this.prisma,
          orderId,
          order.orderId,
        );
      }
      if (mapped === OrderStatus.RETURN_DUE) {
        updateData.returnDueAt = now;
      }
      if (mapped === OrderStatus.CANCELLED || mapped === OrderStatus.REJECTED) {
        await this.prisma.rental.deleteMany({
          where: { orderId },
        });

        // Restore product status when order is cancelled or rejected
        for (const item of order.orderItems as any[]) {
          await this.prisma.product.update({
            where: { id: item.productId },
            data: { status: 'AVAILABLE' },
          });
        }
      }

      if (body.trackingNumber) {
        updateData.trackingNumber = body.trackingNumber;
        updateData.externalTrackingUrl = this.buildExternalTrackingUrl(
          body.trackingNumber,
        );
      }

      if (body.estimatedDeliveryDate) {
        // interpret as date string (YYYY-MM-DD) in local time; UI will format as needed
        updateData.estimatedDeliveryDate = new Date(body.estimatedDeliveryDate);
      }

      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: updateData,
        include: {
          user: true,
          orderItems: { include: { product: true } },
        },
      });

      if (
        mapped === OrderStatus.CANCELLED ||
        mapped === OrderStatus.REJECTED
      ) {
        for (const item of order.orderItems as { productId: string }[]) {
          await this.productAvailabilityNotifyService.notifyWatchersProductAvailable(
            item.productId,
          );
        }
      }

      const timeline = {
        approvedAt: updated.approvedAt?.toISOString() ?? null,
        dispatchedAt: updated.dispatchedAt?.toISOString() ?? null,
        estimatedDeliveryDate:
          updated.estimatedDeliveryDate?.toISOString() ?? null,
        externalTrackingUrl: updated.externalTrackingUrl ?? null,
      };

      // Create Rental records if order is ACTIVE or DELIVERED (only for rental items)
      if (
        updated.status === OrderStatus.ACTIVE ||
        updated.status === OrderStatus.DELIVERED
      ) {
        for (const item of updated.orderItems as any[]) {
          // Only create rental records for actual rental items (days > 0)
          const isRentalItem =
            item.days > 0 &&
            (item.product.listingType === 'RENTAL' ||
              item.product.listingType === 'RENT_OR_RESALE');

          if (!isRentalItem) {
            continue; // Skip resale items and items with days = 0
          }

          // Check if rental already exists for this order item
          const existingRental = await this.prisma.rental.findFirst({
            where: {
              orderId: updated.id,
              productId: item.productId,
            },
          });

          if (!existingRental) {
            const startDate = updated.deliveredAt || now;
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + item.days);

            await this.prisma.rental.create({
              data: {
                orderId: updated.id,
                userId: updated.userId,
                productId: item.productId,
                curatorId: item.product.curatorId,
                days: item.days,
                totalAmount: item.rentalFee || 0,
                startDate,
                endDate,
              },
            });
          }
        }
      }

      // If status changed to something related to shipping, notify renter
      const shippingStatuses: OrderStatus[] = [
        OrderStatus.IN_TRANSIT,
        OrderStatus.DELIVERED,
        OrderStatus.RETURN_DUE,
      ];
      if (shippingStatuses.includes(updated.status)) {
        const firstProduct = updated.orderItems[0]?.product;
        await this.notificationService.createNotification({
          userId: updated.userId,
          title: `Order Update: ${ORDER_STATUS_TO_LABEL[updated.status]}`,
          message: `Your order for ${firstProduct?.name || 'an item'} is now ${ORDER_STATUS_TO_LABEL[updated.status]}.`,
          type: 'SHIPPING_UPDATE',
          metadata: { orderId: updated.id, status: updated.status },
          sendEmail: true,
          emailData: {
            email: updated.user?.email,
            userName: updated.user?.name,
            orderId: updated.orderId,
            status: ORDER_STATUS_TO_LABEL[updated.status],
            productName: firstProduct?.name || 'Your Item',
            trackingNumber: updated.trackingNumber || 'N/A',
            estimatedDelivery:
              updated.estimatedDeliveryDate?.toDateString() || 'N/A',
          },
        });
      }

      return {
        success: true,
        message: 'Order status updated',
        data: {
          orderId: updated.id,
          previousStatus: ORDER_STATUS_TO_API[order.status] ?? order.status,
          newStatus: ORDER_STATUS_TO_API[updated.status] ?? updated.status,
          updatedAt: updated.updatedAt.toISOString(),
          timeline,
          notification: {
            sent: shippingStatuses.includes(updated.status),
            type: 'order_status_updated',
          },
        },
      };
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof ForbiddenException) {
        throw e;
      }
      console.error('updateOrderStatus error:', e);
      throw new InternalServerErrorException('Failed to update order status');
    }
  }

  /** POST /api/listers/orders/:orderId/confirm-return-receipt */
  async confirmReturnReceipt(
    listerId: string,
    orderId: string,
    data: { actualCondition: string; damageNotes?: string; images?: string[] },
  ) {
    try {
      await this.ensureOrderBelongsToLister(listerId, orderId);

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          returnRequests: true,
          user: true,
          orderItems: {
            include: {
              product: {
                select: {
                  curatorId: true,
                  listingType: true,
                },
              },
            },
          },
          escrows: true,
        },
      });

      if (
        !order ||
        !order.returnRequests ||
        order.returnRequests.length === 0
      ) {
        throw new NotFoundException('Order or return request not found');
      }

      if (order.escrows && order.escrows.length > 0) {
        // Find escrow for this lister
        const listerEscrow = order.escrows.find((e) => e.listerId === listerId);
        if (listerEscrow) {
          if (
            listerEscrow.status === 'RELEASED' ||
            order.status === 'COMPLETED'
          ) {
            throw new BadRequestException(
              'Collateral and cleaning fee already released for this order',
            );
          }
        }
      }

      // Verify lister owns the product
      const isListerProduct =
        (order as any).listerId === listerId ||
        order.orderItems.some(
          (item: { product?: { curatorId?: string } | null }) =>
            item.product?.curatorId === listerId,
        );
      if (!isListerProduct) {
        console.log(
          `[ListersService] Lister ${listerId} not authorized for order ${orderId}`,
        );
        throw new BadRequestException('Not authorized to confirm this return');
      }

      if (order.returnRequests[0].status === 'COMPLETED') {
        console.log(
          `[ListersService] Return already confirmed for order ${orderId}`,
        );
        throw new BadRequestException('Return already confirmed');
      }

      // Upload images if provided
      const listerConfirmationImages: string[] = [];
      if (data.images && data.images.length > 0) {
        for (const imageId of data.images) {
          const upload = await this.prisma.upload.findUnique({
            where: { id: imageId },
          });
          if (upload) {
            listerConfirmationImages.push(upload.url);
          }
        }
      }

      // Process in transaction
      console.log(
        `[ListersService] Starting transaction to confirm return for order ${orderId}`,
      );
      const result = await this.prisma.$transaction(async (tx) => {
        // Get the return request (since unique constraint on orderId was removed)
        const returnRequest = await tx.returnRequest.findFirst({
          where: { orderId: order.id },
        });

        if (!returnRequest) {
          throw new NotFoundException('Return request not found');
        }

        // Update return request status
        const updatedReturn = await tx.returnRequest.update({
          where: { id: returnRequest.id },
          data: {
            status: 'COMPLETED',
            deliveredAt: new Date(),
            listerCondition: data.actualCondition.toUpperCase() as any,
            listerDamageNotes: data.damageNotes,
            listerConfirmationImages,
          },
        });
        console.log(
          `[ListersService] Return request updated to COMPLETED for order ${orderId}`,
        );

        const openDispute = await tx.dispute.findFirst({
          where: {
            orderId: order.id,
            status: { in: [DisputeStatus.PENDING, DisputeStatus.IN_REVIEW] },
          },
          select: { disputeId: true },
        });

        if (openDispute) {
          await tx.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.RETURNED },
          });

          return {
            returnRequest: updatedReturn,
            collateralReleased: 0,
            disputeHold: true,
            disputeId: openDispute.disputeId,
          };
        }

        // Update order status
        await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.COMPLETED },
        });
        console.log(
          `[ListersService] Order status updated to COMPLETED for order ${orderId}`,
        );

        for (const item of order.orderItems as {
          productId: string;
          days: number;
          product?: { listingType?: string } | null;
        }[]) {
          const isRentalItem =
            item.days > 0 &&
            (item.product?.listingType === 'RENTAL' ||
              item.product?.listingType === 'RENT_OR_RESALE');
          if (isRentalItem) {
            await tx.product.update({
              where: { id: item.productId },
              data: { status: ProductStatus.AVAILABLE },
            });
          }
        }

        // Release collateral to renter and lister payouts (per-lister escrows)
        let totalCollateralReleased = 0;
        if (order.escrows && order.escrows.length > 0) {
          // Calculate total collateral across all escrows
          totalCollateralReleased = order.escrows.reduce(
            (sum, escrow) => sum + escrow.collateralAmount,
            0,
          );
          console.log(
            `[ListersService] Releasing total collateral NGN ${totalCollateralReleased} for order ${orderId}`,
          );

          // 1. Credit renter wallet (Collateral Release)
          const renterWallet = await tx.wallet.findUnique({
            where: { userId: order.userId },
          });

          if (renterWallet) {
            const actualCollateralToRelease = Math.min(
              totalCollateralReleased,
              renterWallet.collateralBalance,
            );

            if (actualCollateralToRelease > 0) {
              await tx.wallet.update({
                where: { id: renterWallet.id },
                data: {
                  availableBalance: { increment: actualCollateralToRelease },
                  collateralBalance: { decrement: actualCollateralToRelease },
                },
              });

              await tx.walletTransaction.create({
                data: {
                  walletId: renterWallet.id,
                  amount: actualCollateralToRelease,
                  type: 'MAIN',
                  status: 'SUCCESS',
                  note: `Collateral released for returned order ${order.orderId}`,
                  orderId: order.id,
                },
              });
            }
          }

          // 2. Credit each lister wallet (Rental + Cleaning + Resale)
          for (const escrow of order.escrows) {
            const rentalAmount = escrow.rentalAmount || 0;
            const cleaningFee = escrow.cleaningFee || 0;
            const resaleAmount = escrow.resaleAmount || 0;
            const totalListerPayout = rentalAmount + cleaningFee + resaleAmount;

            if (totalListerPayout > 0) {
              console.log(
                `[ListersService] Releasing NGN ${totalListerPayout} (Rental: ${rentalAmount}, Cleaning: ${cleaningFee}, Resale: ${resaleAmount}) to lister ${escrow.listerId}`,
              );
              const listerWallet = await tx.wallet.upsert({
                where: { userId: escrow.listerId },
                create: {
                  userId: escrow.listerId,
                  mainBalance: totalListerPayout,
                  availableBalance: totalListerPayout,
                },
                update: {
                  mainBalance: { increment: totalListerPayout },
                  availableBalance: { increment: totalListerPayout },
                },
              });

              // Create wallet transaction for lister
              const payoutNote = `Final payout released for completed order ${order.orderId} (Rental + Cleaning + Resale)`;

              await tx.walletTransaction.create({
                data: {
                  walletId: listerWallet.id,
                  amount: totalListerPayout,
                  type: 'MAIN',
                  status: 'SUCCESS',
                  note: payoutNote,
                  orderId: order.id,
                },
              });
            }
          }

          // 3. Finalize Escrow Status (Audit: Everything has been released)
          // Update all escrows for this order to RELEASED
          for (const escrow of order.escrows) {
            await tx.escrow.update({
              where: { id: escrow.id },
              data: {
                status: 'RELEASED',
                releasedAt: new Date(),
              },
            });
          }
          console.log(
            `[ListersService] Escrows fully settled and released for order ${orderId}`,
          );
        } else {
          console.error(
            `[ListersService] CRITICAL: No escrow found for order ${orderId} - collateral cannot be released automatically. Manual intervention required.`,
          );
          // Note: We still complete the return, but collateral release requires manual intervention
        }

        return {
          returnRequest: updatedReturn,
          collateralReleased: totalCollateralReleased,
          disputeHold: false,
        };
      });

    // Send email notifications after transaction completes
    const clientUrl = process.env.CLIENT_URL || 'https://relisted.com';

    // Send notification to renter about collateral release
    if (result.collateralReleased > 0 && order.user?.email) {
      const firstItem = order.orderItems[0] as any;
      const productName = firstItem?.product?.name;
      const orderLink = `${clientUrl}/renters/orders/${order.orderId}`;
      try {
        await this.notificationService.createNotification({
          userId: order.user.id,
          title: 'Collateral Released',
          message: `Your collateral of NGN ${result.collateralReleased.toLocaleString()} has been released to your wallet for order ${order.orderId}.`,
          type: 'ESCROW_RELEASE',
          sendEmail: true,
          emailData: {
            email: order.user.email,
            userName: order.user.name || 'there',
            orderId: order.orderId,
            orderLink,
            amountReleased: result.collateralReleased,
            userType: 'renter',
            productName,
          },
        });
        console.log(
          `[ListersService] Sent escrow release notification to renter for order ${order.orderId}`,
        );
      } catch (err: any) {
        console.error(
          `[ListersService] Failed to send escrow release notification to renter for order ${order.orderId}: ${err.message}`,
        );
      }
    }

    // Send notification to listers about rental payment release
    for (const escrow of order.escrows) {
      const rentalAmount = escrow.rentalAmount || 0;
      const cleaningFee = escrow.cleaningFee || 0;
      const resaleAmount = escrow.resaleAmount || 0;
      const totalListerPayout = rentalAmount + cleaningFee + resaleAmount;

      if (totalListerPayout > 0) {
        const lister = await this.prisma.user.findUnique({
          where: { id: escrow.listerId },
        });
        if (lister?.email) {
          const firstItem = order.orderItems[0] as any;
          const productName = firstItem?.product?.name;
          const orderLink = `${clientUrl}/listers/orders/${order.id}`;
          try {
            await this.notificationService.createNotification({
              userId: lister.id,
              title: 'Payment Released',
              message: `Your payment of NGN ${totalListerPayout.toLocaleString()} has been released to your wallet for order ${order.orderId}.`,
              type: 'ESCROW_RELEASE',
              sendEmail: true,
              emailData: {
                email: lister.email,
                userName: lister.name || 'there',
                orderId: order.orderId,
                orderLink,
                amountReleased: totalListerPayout,
                userType: 'lister',
                productName,
              },
            });
            console.log(
              `[ListersService] Sent escrow release notification to lister ${lister.id} for order ${order.orderId}`,
            );
          } catch (err: any) {
            console.error(
              `[ListersService] Failed to send escrow release notification to lister ${lister.id} for order ${order.orderId}: ${err.message}`,
            );
          }
        }
      }
    }
      console.log(
        `[ListersService] Transaction completed successfully for order ${orderId}, released NGN ${result.collateralReleased} collateral`,
      );

      if (!result.disputeHold) {
        const rentalProductIds = (
          order.orderItems as {
            productId: string;
            days: number;
            product?: { listingType?: string } | null;
          }[]
        )
          .filter(
            (item) =>
              item.days > 0 &&
              (item.product?.listingType === 'RENTAL' ||
                item.product?.listingType === 'RENT_OR_RESALE'),
          )
          .map((item) => item.productId);
        for (const pid of rentalProductIds) {
          await this.productAvailabilityNotifyService.notifyWatchersProductAvailable(
            pid,
          );
        }
      }

      if (result.disputeHold) {
        await this.notificationService.createNotification({
          userId: order.userId,
          title: 'Dispute In Review',
          message: `Your return for order ${order.orderId} has been completed. Collateral release is on hold while the dispute is reviewed.`,
          type: 'DISPUTE_STATUS',
          metadata: {
            orderId: order.id,
            orderNumber: order.orderId,
            disputeId: result.disputeId,
          },
          sendEmail: true,
          emailData: {
            email: order.user.email,
            userName: order.user.name,
            disputeId: result.disputeId,
            orderId: order.orderId,
            status: 'in_review',
            disputeLink: `${process.env.CLIENT_URL || ''}/renters/dispute`,
            collateralWithheldToLister: 0,
            collateralReturnedToRenter: 0,
          },
        });
      } else {
        // Notify renter about return completion
        await this.notificationService.createNotification({
          userId: order.userId,
          title: 'Return Completed',
          message: `Your return for order ${order.orderId} has been completed and your collateral of NGN ${result.collateralReleased} has been released to your wallet.`,
          type: 'RETURN_COMPLETED',
          sendEmail: true,
          emailData: {
            email: order.user.email,
            renterName: order.user.name,
            orderId: order.orderId,
            listerCondition: result.returnRequest.listerCondition,
            listerDamageNotes: result.returnRequest.listerDamageNotes,
            collateralReleased: result.collateralReleased,
            walletUrl: `${process.env.CLIENT_URL}/renters/wallet`,
            platformName: 'Relisted',
          },
        });
        console.log(
          `[ListersService] Sent return completion notification to renter for order ${orderId}`,
        );
      }

      return {
        success: true,
        message: 'Return receipt confirmed',
        data: {
          returnRequest: result.returnRequest,
          collateralReleased: result.collateralReleased,
          order: {
            orderId: order.orderId,
            status: result.disputeHold ? 'RETURNED' : 'COMPLETED',
          },
        },
      };
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof BadRequestException)
        throw e;
      console.error('confirmReturnReceipt error:', e);
      throw new InternalServerErrorException(
        'Failed to confirm return receipt',
      );
    }
  }

  /** PATCH /api/listers/orders/:orderId/return/confirm */
  async confirmReturn(user: userEntity, orderId: string) {
    try {
      await this.ensureOrderBelongsToLister(user.id, orderId);

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { returnRequests: true, user: true },
      });

      if (
        !order ||
        !order.returnRequests ||
        order.returnRequests.length === 0
      ) {
        throw new NotFoundException('Order or return request not found');
      }

      const returnRequestId = order.returnRequests[0].id;

      const result = await this.prisma.$transaction(async (tx) => {
        const updatedReturnRequest = await tx.returnRequest.update({
          where: { id: returnRequestId },
          data: { status: 'APPROVED' },
        });

        const updatedOrder = await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.RETURNED },
        });

        return { returnRequest: updatedReturnRequest, order: updatedOrder };
      });

      await this.notificationService.createNotification({
        userId: order.userId,
        title: 'Return Confirmed',
        message: `The lister has confirmed your return for order ${order.orderId}`,
        type: 'RETURN_CONFIRMED',
        metadata: { orderId: order.id },
        sendEmail: true,
        emailData: {
          email: order.user?.email,
          userName: order.user?.name,
          orderId: order.orderId,
          status: 'Return Confirmed',
        },
      });

      return {
        success: true,
        message: 'Return confirmed successfully',
        data: result,
      };
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof BadRequestException)
        throw e;
      console.error('confirmReturn error:', e);
      throw new InternalServerErrorException('Failed to confirm return');
    }
  }

  /** PATCH /api/listers/orders/:orderId/return/reject */
  async rejectReturn(user: userEntity, orderId: string, reason?: string) {
    try {
      await this.ensureOrderBelongsToLister(user.id, orderId);

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { returnRequests: true, user: true },
      });

      if (
        !order ||
        !order.returnRequests ||
        order.returnRequests.length === 0
      ) {
        throw new NotFoundException('Order or return request not found');
      }

      const updated = await this.prisma.returnRequest.update({
        where: { id: order.returnRequests[0].id },
        data: {
          status: 'REJECTED',
          damageNotes: reason
            ? `Lister Rejection: ${reason}\nPrevious Notes: ${order.returnRequests[0].damageNotes || ''}`
            : order.returnRequests[0].damageNotes,
        },
      });

      await this.notificationService.createNotification({
        userId: order.userId,
        title: 'Return Rejected',
        message: `The lister has rejected your return for order ${order.orderId}. Reason: ${reason || 'Not specified'}`,
        type: 'RETURN_REJECTED',
        metadata: { orderId: order.id },
        sendEmail: true,
        emailData: {
          email: order.user?.email,
          userName: order.user?.name,
          orderId: order.orderId,
          status: 'Return Rejected',
          rejectionReason: reason,
        },
      });

      return {
        success: true,
        message: 'Return rejected. Dispute may be required.',
        data: updated,
      };
    } catch (e) {
      if (e instanceof NotFoundException || e instanceof BadRequestException)
        throw e;
      console.error('rejectReturn error:', e);
      throw new InternalServerErrorException('Failed to reject return');
    }
  }

  private mapStatusToOrderStatuses(
    status: string | undefined,
  ): OrderStatus[] | undefined {
    if (!status || status.toLowerCase() === 'all') return undefined;
    switch (status.toLowerCase()) {
      case 'pending':
      case 'pending_approval':
        return [];
      case 'ongoing':
        return [
          OrderStatus.PROCESSING,
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

  private mapApiStatusToOrderStatus(apiStatus: string): OrderStatus | null {
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
      case 'returned':
        return OrderStatus.RETURNED;
      case 'completed':
        return OrderStatus.COMPLETED;
      default:
        return null;
    }
  }

  private async getOrdersSummary(curatorId: string) {
    await this.expireStalePendingAvailabilityRequests(curatorId);

    const [pendingApprovalCount, awaitingPaymentCount] = await Promise.all([
      this.prisma.availabilityRequest.count({
        where: {
          listerId: curatorId,
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
      }),
      // Only count ACCEPTED requests (ORDERED requests are excluded - they've been converted to orders)
      this.prisma.availabilityRequest.count({
        where: { listerId: curatorId, status: 'ACCEPTED' },
      }),
    ]);

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
    const orderOngoingCount = [
      OrderStatus.PROCESSING,
      OrderStatus.ACCEPTED,
      OrderStatus.CONFIRMED,
      OrderStatus.IN_TRANSIT,
      OrderStatus.DELIVERED,
      OrderStatus.ACTIVE,
      OrderStatus.RETURN_DUE,
    ].reduce((a, s) => a + (map.get(s) ?? 0), 0);

    const availabilityTerminalCount =
      await this.prisma.availabilityRequest.count({
        where: {
          listerId: curatorId,
          status: { in: ['REJECTED', 'EXPIRED', 'CANCELLED_BY_RENTER'] },
        },
      });

    return {
      pendingApprovalCount,
      awaitingPaymentCount,
      ongoingCount: orderOngoingCount + awaitingPaymentCount,
      completedCount:
        (map.get(OrderStatus.RETURNED) ?? 0) +
        (map.get(OrderStatus.COMPLETED) ?? 0),
      cancelledCount:
        (map.get(OrderStatus.CANCELLED) ?? 0) +
        (map.get(OrderStatus.REJECTED) ?? 0) +
        availabilityTerminalCount,
    };
  }

  private formatOrderForList(order: any) {
    const expiresAt = order.expiresAt;
    const now = new Date();
    const timeRemainingSeconds =
      order.status === OrderStatus.PROCESSING && expiresAt && expiresAt > now
        ? Math.max(0, differenceInSeconds(expiresAt, now))
        : 0;
    const totalAmount = order.orderItems.reduce((sum: number, oi: any) => {
      // For resale items (days === 0 for RESALE/RENT_OR_RESALE), use resalePrice
      const isResaleItem =
        oi.days === 0 &&
        (oi.product?.listingType === 'RESALE' ||
          oi.product?.listingType === 'RENT_OR_RESALE');
      if (isResaleItem) {
        return sum + (oi.product?.resalePrice || 0);
      }
      // For rental items, use pricePerDay * days
      return sum + (oi.pricePerDay ?? 0) * (oi.days ?? 0);
    }, 0);
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

  /**
   * Rental security deposit (collateral) for escrow: order line snapshot first,
   * then product `collateralPrice`, else 30% of `originalValue` (matches lister pricing UI).
   */
  private rentalDepositNgn(oi: {
    collateralFee?: number | null;
    product?: {
      collateralPrice?: number | null;
      originalValue?: number | null;
    };
  }): number {
    const fromOrder = oi.collateralFee;
    if (fromOrder != null && Number.isFinite(Number(fromOrder))) {
      return Math.round(Number(fromOrder));
    }
    const cp = Number(oi.product?.collateralPrice ?? 0);
    if (cp > 0) return Math.round(cp);
    const ov = Number(oi.product?.originalValue ?? 0);
    if (ov > 0) return Math.round(ov * 0.3);
    return 0;
  }

  private formatOrderDetail(
    order: any,
    reviewsCount: number,
    availabilityRequests?: any[],
  ) {
    const expiresAt = order.expiresAt;
    const now = new Date();
    const timeRemainingSeconds =
      order.status === OrderStatus.PROCESSING && expiresAt && expiresAt > now
        ? Math.max(0, differenceInSeconds(expiresAt, now))
        : 0;
    const rentalByProduct = new Map<string, any>(
      (order.rentals ?? []).map((r: any) => [r.productId, r]),
    );
    const totalAmount = order.orderItems.reduce((sum: number, oi: any) => {
      // For resale items (days === 0 for RESALE/RENT_OR_RESALE), use resalePrice
      const isResaleItem =
        oi.days === 0 &&
        (oi.product?.listingType === 'RESALE' ||
          oi.product?.listingType === 'RENT_OR_RESALE');
      if (isResaleItem) {
        return sum + (oi.product?.resalePrice || 0);
      }
      // For rental items, use pricePerDay * days
      return sum + (oi.pricePerDay ?? 0) * (oi.days ?? 0);
    }, 0);
    const statusColors: Record<string, { bg: string; text: string }> = {
      pending_approval: { bg: '#FFF9E5', text: '#D4A017' },
      processing: { bg: '#FFF9E5', text: '#D4A017' },
      ongoing: { bg: '#E8F4FD', text: '#1E88E5' },
      returned: { bg: '#E8F5E9', text: '#2E7D32' },
      completed: { bg: '#E8F5E9', text: '#2E7D32' },
      cancelled: { bg: '#FFEBEE', text: '#C62828' },
    };
    const apiStatus = ORDER_STATUS_TO_API[order.status] ?? order.status;
    const colors = statusColors[apiStatus] ?? {
      bg: '#F5F5F5',
      text: '#616161',
    };
    const primaryReturnRequest =
      order.returnRequests?.length > 0 ? order.returnRequests[0] : null;

    const listerRentalSubtotal = order.orderItems.reduce(
      (sum: number, oi: any) => {
        const isResaleItem =
          oi.days === 0 &&
          (oi.product?.listingType === 'RESALE' ||
            oi.product?.listingType === 'RENT_OR_RESALE');
        if (isResaleItem) return sum;
        return (
          sum +
          (oi.pricePerDay ?? oi.product?.dailyPrice ?? 0) * (oi.days ?? 0)
        );
      },
      0,
    );
    const listerCleaningFeesTotal = order.orderItems.reduce(
      (sum: number, oi: any) => sum + (oi.cleaningFee ?? 0),
      0,
    );
    const listerResaleSubtotal = order.orderItems.reduce(
      (sum: number, oi: any) => {
        const isResaleItem =
          oi.days === 0 &&
          (oi.product?.listingType === 'RESALE' ||
            oi.product?.listingType === 'RENT_OR_RESALE');
        return isResaleItem ? sum + (oi.product?.resalePrice || 0) : sum;
      },
      0,
    );

    return {
      id: order.id,
      orderNumber: order.orderId,
      listingType: order.listingType,
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
      items: order.orderItems.map((oi: any) => {
        const rental = rentalByProduct.get(oi.productId);
        const isResaleLine =
          oi.days === 0 &&
          (oi.product.listingType === 'RESALE' ||
            oi.product.listingType === 'RENT_OR_RESALE');
        const endStr = rental?.endDate
          ? rental.endDate.toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];
        return {
          id: oi.product.id,
          name: oi.product.name,
          image:
            oi.product.attachments?.uploads?.[0]?.url ??
            'https://via.placeholder.com/300?text=No+Image',
          size: oi.product.measurement ?? 'N/A',
          color: oi.product.color ?? 'N/A',
          days: oi.days,
          listingType: oi.product.listingType,
          purchasePrice: oi.product.resalePrice || 0,
          returnDue: isResaleLine ? null : endStr,
          rentalStartDate: rental?.startDate
            ? rental.startDate.toISOString().split('T')[0]
            : undefined,
          rentalEndDate: rental?.endDate
            ? rental.endDate.toISOString().split('T')[0]
            : undefined,
          rentalFee:
            oi.days === 0 &&
            (oi.product.listingType === 'RESALE' ||
              oi.product.listingType === 'RENT_OR_RESALE')
              ? oi.product.resalePrice || 0
              : (oi.pricePerDay ?? oi.product.dailyPrice) * oi.days,
          cleaningFee: oi.cleaningFee ?? 0,
          itemValue: oi.product.originalValue ?? 0,
          itemValueHeld:
            oi.days === 0 &&
            (oi.product.listingType === 'RESALE' ||
              oi.product.listingType === 'RENT_OR_RESALE')
              ? oi.product.resalePrice || 0
              : this.rentalDepositNgn(oi),
          status: order.status.toLowerCase(),
          statusLabel: ORDER_STATUS_TO_LABEL[order.status] ?? order.status,
        };
      }),
      timeline: {
        dateOrdered: order.createdAt.toISOString().split('T')[0],
        itemsCount: order.orderItems.length,
        itemsDelivered:
          order.status === OrderStatus.DELIVERED ? order.orderItems.length : 0,
        currentStep: apiStatus,
      },
      returnRequest: primaryReturnRequest
        ? {
            id: primaryReturnRequest.id,
            orderId: order.orderId,
            itemCondition: primaryReturnRequest.itemCondition,
            damageNotes: primaryReturnRequest.damageNotes,
            imageUrls: primaryReturnRequest.imageUrls,
            status: primaryReturnRequest.status,
            createdAt: primaryReturnRequest.createdAt.toISOString(),
          }
        : null,
      dispatchWindows: this.mergeOrderDispatchWindows(
        order,
        availabilityRequests,
      ),
      listerMerchandise: {
        rentalSubtotal: listerRentalSubtotal,
        cleaningFeesTotal: listerCleaningFeesTotal,
        resaleSubtotal: listerResaleSubtotal,
        total:
          listerRentalSubtotal +
          listerCleaningFeesTotal +
          listerResaleSubtotal,
      },
      escrow: {
        rentalFeeTotal: order.orderItems.reduce(
          (sum: number, oi: any) =>
            oi.days === 0 &&
            (oi.product?.listingType === 'RESALE' ||
              oi.product?.listingType === 'RENT_OR_RESALE')
              ? sum
              : sum + (oi.pricePerDay ?? oi.product?.dailyPrice) * oi.days,
          0,
        ),
        itemValueHeld: order.orderItems.reduce(
          (sum: number, oi: any) =>
            oi.days === 0 &&
            (oi.product?.listingType === 'RESALE' ||
              oi.product?.listingType === 'RENT_OR_RESALE')
              ? sum + (oi.product?.resalePrice || 0)
              : sum + this.rentalDepositNgn(oi),
          0,
        ),
        purchasePrice: order.orderItems.reduce(
          (sum: number, oi: any) =>
            oi.days === 0 &&
            (oi.product?.listingType === 'RESALE' ||
              oi.product?.listingType === 'RENT_OR_RESALE')
              ? sum + (oi.product?.resalePrice || 0)
              : sum,
          0,
        ),
        totalHeld: order.orderItems.reduce(
          (sum: number, oi: any) =>
            oi.days === 0 &&
            (oi.product?.listingType === 'RESALE' ||
              oi.product?.listingType === 'RENT_OR_RESALE')
              ? sum + (oi.product?.resalePrice || 0)
              : sum +
                (oi.pricePerDay ?? oi.product?.dailyPrice) * oi.days +
                this.rentalDepositNgn(oi),
          0,
        ),
        currency: CURRENCY,
        releaseCondition:
          order.listingType === 'RESALE' ||
          order.orderItems.some((oi: any) => oi.days === 0)
            ? 'Upon buyer confirmation of receipt'
            : 'Upon successful return confirmation',
      },
    };
  }

  private formatDispatchWindowsFromRequest(req: any) {
    const dispatchWindows: Array<{
      type: DispatchWindowType;
      window: { start: string; end: string };
      mode: 'DEFAULT' | 'CUSTOM';
      scheduledDate: string;
      baseDate: string;
    }> = [];

    const pushWindow = (
      type: DispatchWindowType,
      start?: Date | string | null,
      end?: Date | string | null,
      baseDate?: Date | string | null,
    ) => {
      if (!start || !end || !baseDate) return;
      dispatchWindows.push({
        type,
        window: {
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
        },
        mode: 'CUSTOM',
        scheduledDate: formatLocalDate(baseDate),
        baseDate: formatLocalDate(baseDate),
      });
    };

    pushWindow(
      'OUTBOUND',
      req.outboundWindowStart,
      req.outboundWindowEnd,
      req.startDate,
    );
    pushWindow(
      'RETURN',
      req.returnWindowStart,
      req.returnWindowEnd,
      req.returnWindowStart ?? req.endDate,
    );
    pushWindow(
      'RESALE',
      req.resaleWindowStart,
      req.resaleWindowEnd,
      req.createdAt,
    );

    return dispatchWindows;
  }

  private mergeOrderDispatchWindows(
    order: any,
    availabilityRequests?: any[],
  ) {
    const fromShipments = this.formatDispatchWindowsFromShipments(order);
    if (fromShipments.length > 0) return fromShipments;
    if (!availabilityRequests?.length) return [];
    const merged: Array<{
      type: DispatchWindowType;
      window: { start: string; end: string };
      mode: 'DEFAULT' | 'CUSTOM';
      scheduledDate: string;
      baseDate: string;
    }> = [];
    for (const req of availabilityRequests) {
      merged.push(...this.formatDispatchWindowsFromRequest(req));
    }
    const seen = new Set<string>();
    const deduped = merged.filter((w) => {
      const key = `${w.type}|${w.window.start}|${w.window.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return this.consolidateDispatchWindowsByTypeAndDay(deduped);
  }

  /** One row per type per local calendar day (min start, max end) when multiple items contributed windows. */
  private consolidateDispatchWindowsByTypeAndDay(
    windows: Array<{
      type: DispatchWindowType;
      window: { start: string; end: string };
      mode: 'DEFAULT' | 'CUSTOM';
      scheduledDate: string;
      baseDate: string;
    }>,
  ) {
    type W = (typeof windows)[0];
    if (windows.length <= 1) return windows;

    const groups = new Map<string, W[]>();
    for (const w of windows) {
      const day = formatLocalDate(new Date(w.window.start));
      const key = `${w.type}|${day}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(w);
    }

    const out: W[] = [];
    for (const group of groups.values()) {
      if (group.length === 1) {
        out.push(group[0]);
        continue;
      }
      const tStart = Math.min(
        ...group.map((g) => new Date(g.window.start).getTime()),
      );
      const tEnd = Math.max(
        ...group.map((g) => new Date(g.window.end).getTime()),
      );
      const head = group[0];
      const startIso = new Date(tStart).toISOString();
      const endIso = new Date(tEnd).toISOString();
      out.push({
        ...head,
        window: { start: startIso, end: endIso },
        scheduledDate: formatLocalDate(new Date(tStart)),
        baseDate: formatLocalDate(new Date(tStart)),
        mode: 'CUSTOM',
      });
    }

    const orderRank = (t: DispatchWindowType) =>
      t === 'OUTBOUND' ? 0 : t === 'RETURN' ? 1 : 2;
    out.sort(
      (a, b) =>
        orderRank(a.type) - orderRank(b.type) ||
        new Date(a.window.start).getTime() -
          new Date(b.window.start).getTime(),
    );
    return out;
  }

  private formatDispatchWindowsFromShipments(order: any) {
    const shipments = Array.isArray(order.shipments) ? order.shipments : [];
    const byType = new Map<string, any>();

    for (const shipment of shipments) {
      if (shipment?.type) byType.set(shipment.type, shipment);
    }

    const dispatchWindows: Array<{
      type: DispatchWindowType;
      window: { start: string; end: string };
      mode: 'DEFAULT' | 'CUSTOM';
      scheduledDate: string;
      baseDate: string;
    }> = [];

    for (const type of ['OUTBOUND', 'RETURN', 'RESALE'] as DispatchWindowType[]) {
      const shipment = byType.get(type);
      if (!shipment?.scheduledWindowStart || !shipment?.scheduledWindowEnd) continue;

      const baseDate = shipment.scheduledDate
        ? new Date(shipment.scheduledDate)
        : new Date(shipment.scheduledWindowStart);
      const defaultWindow = buildDefaultDispatchWindow(baseDate);
      const isDefaultMode =
        new Date(shipment.scheduledWindowStart).getTime() ===
          defaultWindow.start.getTime() &&
        new Date(shipment.scheduledWindowEnd).getTime() ===
          defaultWindow.end.getTime();

      dispatchWindows.push({
        type,
        window: {
          start: new Date(shipment.scheduledWindowStart).toISOString(),
          end: new Date(shipment.scheduledWindowEnd).toISOString(),
        },
        mode: isDefaultMode ? 'DEFAULT' : 'CUSTOM',
        scheduledDate: formatLocalDate(shipment.scheduledDate),
        baseDate: formatLocalDate(baseDate),
      });
    }

    return dispatchWindows;
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
          rentals: { some: { curatorId: user.id } },
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
            rentals: { some: { curatorId: user.id } },
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
          rentals: { some: { curatorId: user.id } },
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
                rentals: true,
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
        const order: any = d.order;
        const rental = order?.rentals?.[0];
        const itemName =
          order?.orderItems?.[0]?.product?.name ?? 'Unknown item';
        const curatorName = d.user.name;
        const amount = rental?.totalAmount ?? 0;
        const statusApi = this.mapDisputeStatusToApi(d.status);
        const statusPresentation = this.mapDisputeStatusPresentation(statusApi);

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
        throw new BadRequestException('Missing required fields');
      }
      if (body.description.length < 20) {
        throw new BadRequestException(
          'Description must be at least 20 characters long',
        );
      }

      const order = await this.prisma.order.findUnique({
        where: { id: body.orderId },
        select: {
          id: true,
          orderId: true,
          userId: true,
          rentals: { select: { curatorId: true } },
          orderItems: {
            select: { product: { select: { curatorId: true } } },
          },
        },
      });
      if (!order) {
        throw new NotFoundException('Order not found');
      }

      // Lister-only ownership check – order must involve this curator
      const isAdmin = user.role === Role.ADMIN;
      const isCuratorOnAnyRental = (order as any).rentals?.some(
        (r: any) => r.curatorId === user.id,
      );
      const isCuratorOnAnyOrderItem = (order as any).orderItems?.some(
        (item: any) => item.product?.curatorId === user.id,
      );

      if (
        !isAdmin &&
        !isCuratorOnAnyRental &&
        !isCuratorOnAnyOrderItem
      ) {
        throw new ForbiddenException(
          'You can only raise disputes for your own rentals',
        );
      }

      const existing = await this.prisma.dispute.findFirst({
        where: {
          orderId: order.id,
        },
      });
      if (existing) {
        // 422-style semantics
        throw new BadRequestException(
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
          preferredResolution: body.preferredResolution,
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

      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.IN_DISPUTE },
      });

      const admins = await this.prisma.user.findMany({
        where: { role: Role.ADMIN },
        select: { id: true, name: true, email: true },
      });

      const clientUrl = process.env.CLIENT_URL || '';
      const adminLink = `${clientUrl}/admin/k340eol21/disputes`;

      await Promise.all(
        admins.map((admin) =>
          this.notificationService.createNotification({
            userId: admin.id,
            title: 'New Dispute Created',
            message: `A new dispute ${created.disputeId} was created for order ${order.orderId}.`,
            type: 'DISPUTE_CREATED',
            metadata: {
              disputeId: created.disputeId,
              disputeDbId: created.id,
              orderId: order.id,
              orderNumber: order.orderId,
              raisedByUserId: user.id,
            },
            sendEmail: true,
            emailData: {
              email: admin.email,
              adminName: admin.name,
              disputeId: created.disputeId,
              orderId: order.orderId,
              raisedByName: user.name ?? 'User',
              raisedByRole: user.role ?? 'USER',
              category: created.issueCategory,
              description: created.description,
              adminLink,
            },
          }),
        ),
      );

      const renterUser = await this.prisma.user.findUnique({
        where: { id: order.userId },
        select: { id: true, name: true, email: true },
      });

      if (renterUser) {
        const disputeLink = `${clientUrl}/renters/dispute`;
        await this.notificationService.createNotification({
          userId: renterUser.id,
          title: 'New Dispute Created',
          message: `A dispute has been created for order ${order.orderId}.`,
          type: 'DISPUTE_STATUS',
          metadata: {
            disputeId: created.disputeId,
            disputeDbId: created.id,
            orderId: order.id,
            orderNumber: order.orderId,
          },
          sendEmail: true,
          emailData: {
            email: renterUser.email,
            userName: renterUser.name,
            disputeId: created.disputeId,
            orderId: order.orderId,
            status: 'created',
            category: created.issueCategory,
            description: created.description,
            preferredResolution: created.preferredResolution ?? undefined,
            disputeLink,
          },
        });
      }

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
      if (e instanceof NotFoundException || e instanceof ForbiddenException) {
        throw e;
      }
      console.error('createDispute error:', e);
      throw new InternalServerErrorException('Failed to create dispute');
    }
  }

  private async findListerDisputeOrThrow(user: userEntity, disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { disputeId },
      include: {
        order: {
          include: {
            rentals: true,
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
        user: { include: { profile: true } },
        attachment: {
          include: {
            uploads: true,
          },
        },
        chatRooms: {
          include: {
            message: {
              include: {
                uploads: true,
              },
            },
          },
        },
      },
    });
    if (!dispute) {
      throw new NotFoundException('Dispute not found');
    }

    const curatorId = (dispute as any).order?.rentals?.[0]?.curatorId;
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
      const statusPresentation = this.mapDisputeStatusPresentation(statusApi);

      const order: any = (dispute as any).order;
      const orderNumber = order?.orderId;
      const itemName = order?.orderItems?.[0]?.product?.name ?? 'Unknown item';
      const curatorName =
        order?.orderItems?.[0]?.product?.curator?.name ?? 'Unknown';
      const createdAtIso = dispute.createdAt.toISOString();
      const lastUpdatedAtIso = dispute.updatedAt.toISOString();

      // Very simple estimated resolution date: +7 days
      const estimatedResolutionDate = new Date(dispute.createdAt);
      estimatedResolutionDate.setDate(estimatedResolutionDate.getDate() + 7);

      // Evidence summary
      const uploads = (dispute as any).attachment?.uploads ?? [];

      const evidence = {
        filesCount: uploads.length,
        files: uploads.map((u: any) => ({
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
            description: 'Our team is reviewing your case and evidence',
          },
        ],
      };

      const messages = (dispute as any).chatRooms?.message ?? [];

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
            estimatedResolutionDate: estimatedResolutionDate.toISOString(),
            overview: {
              itemName,
              curator: curatorName,
              category: dispute.issueCategory,
              dateSubmitted: dispute.createdAt.toISOString().split('T')[0],
              preferredResolution: dispute.preferredResolution ?? null,
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
      if (e instanceof NotFoundException || e instanceof ForbiddenException) {
        throw e;
      }
      console.error('getDisputeDetails error:', e);
      throw new InternalServerErrorException('Failed to fetch dispute details');
    }
  }

  /** 23. GET /api/listers/disputes/:disputeId/overview */
  async getDisputeOverview(user: userEntity, disputeId: string) {
    const dispute = await this.findListerDisputeOrThrow(user, disputeId);
    const order: any = (dispute as any).order;
    const itemName = order?.orderItems?.[0]?.product?.name ?? 'Unknown item';
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
            dateSubmitted: dispute.createdAt.toISOString().split('T')[0],
            preferredResolution: dispute.preferredResolution ?? null,
            description: dispute.description,
          },
        },
      },
    };
  }

  /** 24. GET /api/listers/disputes/:disputeId/evidence */
  async getDisputeEvidence(user: userEntity, disputeId: string) {
    const dispute = await this.findListerDisputeOrThrow(user, disputeId);
    const uploads = (dispute as any).attachment?.uploads ?? [];
    const files = uploads.map((u: any) => ({
      fileId: u.id,
      fileName: u.name,
      fileType: u.type.startsWith('image') ? 'image' : 'document',
      fileUrl: u.url,
      fileSize: `${(u.size / (1024 * 1024)).toFixed(1)}MB`,
      uploadedAt: u.createdAt.toISOString(),
      uploadedBy: u.userId,
    }));
    const totalSizeMb =
      uploads.reduce((sum: number, u: any) => sum + u.size, 0) /
      (1024 * 1024);

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
        description: 'Our team is reviewing your case and evidence',
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
            resolutionDetails: 'Full refund issued due to confirmed issue.',
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
      (dispute as any).chatRooms ??
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
        include: {
          uploads: true,
          sender: { include: { profile: true } },
        },
      }),
      this.prisma.message.count({ where: { chatRoomId: room.id } }),
    ]);

    const mapped = messages.map((m) => ({
      id: m.id,
      createdBy: m.senderRole === 'admin' ? 'admin' : m.senderRole,
      senderId: m.senderId,
      sender: {
        id: m.senderId,
        name: m.sender?.name || 'User',
        avatarUrl: m.sender?.profile?.avatar || null,
        role: m.senderRole,
      },
      type: m.senderRole === 'admin' ? 'admin' : 'user',
      content: m.content,
      timestamp: m.createdAt.toISOString(),
      attachments:
        m.uploads?.map((u) => ({
          id: u.id,
          url: u.url,
          thumbnailUrl: u.url,
          name: u.name,
          type: u.type,
          size: u.size,
        })) || [],
    }));

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
    body: { content?: string; mediaIds?: string[]; uploadIds?: string[] },
  ) {
    if (
      !body.content?.trim() &&
      (!body.uploadIds || body.uploadIds.length === 0)
    ) {
      throw new ForbiddenException('Message content cannot be empty');
    }

    const dispute = await this.findListerDisputeOrThrow(user, disputeId);

    let room =
      (dispute as any).chatRooms ??
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
        content: body.content || '',
        type: 'user',
        chatRoomId: room.id,
        uploads: body.uploadIds?.length
          ? { connect: body.uploadIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { uploads: true, sender: { include: { profile: true } } },
    });

    const renter = (dispute as any).user;
    if (renter?.id && renter.id !== user.id) {
      const senderName =
        message.sender?.profile?.fullName ||
        message.sender?.profile?.businessName ||
        message.sender?.name ||
        'Someone';
      const recipientName =
        renter.profile?.fullName ||
        renter.profile?.businessName ||
        renter.name ||
        'Renter';
      const clientUrl = process.env.CLIENT_URL || '';
      const threadLink = clientUrl
        ? `${clientUrl}/renters/dispute#${disputeId}`
        : undefined;
      const preview =
        (body.content || '').trim() ||
        (body.uploadIds?.length ? 'Sent an attachment' : '');
      await this.notificationService.createNotification({
        userId: renter.id,
        title: 'New message',
        message: `${senderName} sent you a new message.`,
        type: 'DISPUTE_MESSAGE',
        metadata: {
          disputeId,
          orderId: (dispute as any).order?.orderId,
          chatRoomId: room.id,
          messageId: message.id,
          senderId: user.id,
        },
        sendEmail: true,
        emailData: {
          email: renter.email,
          recipientName,
          senderName,
          disputeId,
          orderId: (dispute as any).order?.orderId,
          messagePreview:
            preview.length > 200 ? `${preview.slice(0, 200)}…` : preview,
          threadLink,
        },
      });
    }

    const createdAt = message.createdAt.toISOString();
    return {
      success: true,
      message: 'Message sent successfully',
      data: {
        messageId: message.id,
        createdBy: 'lister',
        senderId: message.senderId,
        sender: {
          id: message.senderId,
          name:
            message.sender?.profile?.fullName ||
            message.sender?.profile?.businessName ||
            null,
          avatarUrl: message.sender?.profile?.avatar || null,
          role: 'lister',
        },
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
        attachments:
          message.uploads?.map((u) => ({
            id: u.id,
            url: u.url,
            thumbnailUrl: u.url,
            name: u.name,
            type: u.type,
            size: u.size,
          })) || [],
      },
    };
  }

  /** 29. POST /api/listers/disputes/:disputeId/withdraw */
  async withdrawDispute(
    user: userEntity,
    disputeId: string,
    body: { reason?: string; notes?: string },
  ) {
    void body;
    const dispute = await this.findListerDisputeOrThrow(user, disputeId);

    if (
      dispute.status !== DisputeStatus.PENDING &&
      dispute.status !== DisputeStatus.IN_REVIEW
    ) {
      throw new ForbiddenException(
        `Dispute cannot be withdrawn from its current status (${dispute.status})`,
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
        user: {
          include: {
            virtualAccounts: true,
            bankAccounts: true,
          },
        },
        address: true,
        avatarUpload: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const addresses =
      includeAddresses && profile.address
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
          vaNumber:
            (profile.user as any).virtualAccounts?.[0]?.vaNumber ?? null,
          bankAccounts: (profile.user as any).bankAccounts ?? [],
          nin: profile.nin,
          bvn: profile.bvn,
        },
      },
    };
  }

  /** 32. PUT /api/listers/profile */
  async updateListerProfile(
    user: userEntity,
    body: {
      fullName?: string;
      phone?: string;
      phoneNumber?: string;
      bvn?: string;
      nin?: string;
      businessInfo?: any;
      address?: any;
      emergencyContact?: any;
      emergencyContacts?: any;
      bankAccounts?: any;
      bankAccountInfo?: any;
      avatarUploadId?: string;
    },
  ) {
    const userId = user.id;
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: {
          include: {
            emergencyContact: true,
            address: true,
            avatarUpload: true,
            businessInfo: true,
          },
        },
        virtualAccounts: true,
      },
    });

    if (!currentUser) {
      throw new NotFoundException('User not found');
    }

    const phoneToSet = body.phone !== undefined ? body.phone : body.phoneNumber;
    const emergencyContactData =
      body.emergencyContact || body.emergencyContacts;

    const profileUpdate: any = {};
    if (phoneToSet !== undefined) profileUpdate.phoneNumber = phoneToSet;
    if (body.bvn !== undefined) profileUpdate.bvn = body.bvn;
    if (body.nin !== undefined) profileUpdate.nin = body.nin;

    if (emergencyContactData) {
      profileUpdate.emergencyContact = {
        upsert: {
          create: emergencyContactData,
          update: emergencyContactData,
        },
      };
    }
    if (body.businessInfo) {
      profileUpdate.businessInfo = {
        upsert: {
          create: body.businessInfo,
          update: body.businessInfo,
        },
      };
    }
    if (body.address) {
      profileUpdate.address = {
        upsert: {
          create: body.address,
          update: body.address,
        },
      };
    }
    if (body.avatarUploadId) {
      profileUpdate.avatarUpload = { connect: { id: body.avatarUploadId } };
    }

    const profileCreate: any = {
      phoneNumber: phoneToSet || '',
      ...(body.bvn && { bvn: body.bvn }),
      ...(body.nin && { nin: body.nin }),
      ...(emergencyContactData && {
        emergencyContact: {
          create: emergencyContactData,
        },
      }),
      ...(body.businessInfo && {
        businessInfo: {
          create: body.businessInfo,
        },
      }),
      ...(body.address && {
        address: {
          create: body.address,
        },
      }),
      ...(body.avatarUploadId && {
        avatarUpload: {
          connect: { id: body.avatarUploadId },
        },
      }),
    };

    const userDataUpdate: any = {};
    if (body.fullName) {
      userDataUpdate.name = body.fullName;
    }

    if (
      Object.keys(profileUpdate).length > 0 ||
      Object.keys(profileCreate).length > 0
    ) {
      userDataUpdate.profile = {
        upsert: {
          create: profileCreate,
          update: profileUpdate,
        },
      };
    }

    const bankInfoRaw = body.bankAccountInfo || body.bankAccounts;
    const bankInfo = Array.isArray(bankInfoRaw) ? bankInfoRaw[0] : bankInfoRaw;
    if (bankInfo) {
      const accountNumber = bankInfo.accountNumber ?? bankInfo.account_number;
      const bankName = bankInfo.bankName ?? bankInfo.bank_name;
      const bankCode = bankInfo.bankCode ?? bankInfo.bank_code;
      const accountName =
        bankInfo.accountName ??
        bankInfo.account_name ??
        bankInfo.nameOfAccount ??
        bankInfo.name_of_account;

      if (accountNumber && bankName && accountName) {
        const existingBank = await (this.prisma as any).bankAccount.findFirst({
          where: {
            userId: userId,
            accountNumber,
          },
        });

        if (existingBank) {
          await (this.prisma as any).bankAccount.update({
            where: { id: existingBank.id },
            data: {
              bankName,
              bankCode,
              accountName,
              isDefault: true,
            },
          });
        } else {
          await (this.prisma as any).bankAccount.create({
            data: {
              userId: userId,
              bankName,
              bankCode,
              accountNumber,
              accountName,
              isDefault: true,
            },
          });
        }
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: userDataUpdate,
      include: {
        profile: {
          include: {
            user: {
              include: {
                virtualAccounts: true,
                bankAccounts: true,
              },
            },
            address: true,
            avatarUpload: true,
          },
        },
        virtualAccounts: true,
      },
    });

    if ((body.bvn || body.nin) && updatedUser.virtualAccounts?.length === 0) {
      try {
        await this.wemaService.createAccount(updatedUser as any, 0);
      } catch (err: any) {
        console.warn(
          `Failed to generate Virtual Account for ${userId}:`,
          err.message,
        );
      }
    }

    // Refetch in case it was created
    const finalProfile = await this.prisma.profile.findUnique({
      where: { userId: userId },
      include: {
        user: {
          include: {
            virtualAccounts: true,
            bankAccounts: true,
          },
        },
        address: true,
        avatarUpload: true,
      },
    });

    if (!finalProfile) {
      throw new NotFoundException('Profile not found after update');
    }

    return {
      success: true,
      message: 'Profile updated successfully',
      data: {
        profile: {
          userId: finalProfile.userId,
          fullName: finalProfile.user.name,
          email: finalProfile.user.email,
          phone: finalProfile.phoneNumber,
          role: finalProfile.user.role,
          profileImage: finalProfile.avatarUpload?.url ?? null,
          dateJoined: finalProfile.user.createdAt.toISOString(),
          updatedAt: finalProfile.updatedAt.toISOString(),
          vaNumber:
            (finalProfile.user as any).virtualAccounts?.[0]?.vaNumber ?? null,
          bankAccounts: (finalProfile.user as any).bankAccounts ?? [],
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
   *  Directly uploads a file as the lister's profile avatar.
   */
  async uploadAvatar(user: userEntity, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');

    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    const uploadId = randomUUID();
    // Using a simplified user object for the upload service
    const mockUser = { id: user.id, email: user.email, sub: user.id } as any;

    const uploadedFile = await this.uploadService.uploadFile(
      uploadId,
      file,
      mockUser,
    );

    await this.prisma.profile.update({
      where: { id: profile.id },
      data: { avatarUploadId: uploadedFile.id },
    });

    return {
      success: true,
      message: 'Profile avatar updated successfully',
      data: {
        profileImage: uploadedFile.url,
        uploadedAt: uploadedFile.createdAt,
      },
    };
  }

  /** 35.1 POST /api/listers/profile/avatar-link
   *  This endpoint expects an existing upload ID to be linked as avatar.
   *  File upload is handled by the /upload module.
   */
  async updateProfileAvatar(user: userEntity, body: { uploadId: string }) {
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
      include: { businessInfo: true, address: true },
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
            b.businessDescription ?? 'fashion rental service',
          businessEmail: b.businessEmail,
          businessPhone: b.businessPhone ?? null,
          businessAddress: b.businessAddress,
          businessCity: b.businessCity,
          businessState: b.businessState,
          website: b.website ?? null,
          taxId: null,
          address: profile.address
            ? {
                addressId: profile.address.id,
                street: profile.address.street,
                city: profile.address.city,
                state: profile.address.state,
                postalCode: profile.address.zipCode,
                country: profile.address.country,
                isDefault: profile.address.isDefault,
              }
            : null,
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
      include: {
        idDocumentUpload: true,
        ninUpload: true,
        businessInfo: true,
      },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    // ID may be linked via current flow (idDocumentUpload) or legacy (ninUpload)
    const idUpload = profile.idDocumentUpload ?? profile.ninUpload;
    const idStatus = idUpload ? 'verified' : 'not_verified';
    const idDocumentLabel =
      profile.idDocumentType ||
      (profile.ninUpload && !profile.idDocumentUpload ? 'NIN' : 'ID Document');
    const idVerifiedDate = idUpload ? idUpload.createdAt.toISOString() : null;

    const bvnStatus = profile.bvn ? 'verified' : 'not_verified';
    const businessStatus = profile.businessInfo
      ? profile.isApproved
        ? 'verified'
        : 'pending'
      : 'not_verified';

    const maskBvn = (val?: string | null) =>
      val && val.length >= 4 ? `XXXXX${val.slice(-4)}` : null;

    const idVerificationBlock = {
      status: idStatus,
      document: idDocumentLabel,
      verifiedDate: idVerifiedDate,
      expiresAt: null,
    };

    return {
      success: true,
      data: {
        verifications: {
          validId: idVerificationBlock,
          // Alias for older clients that still read `verifications.nin`
          nin: idVerificationBlock,
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
              profile.businessInfo?.businessRegistrationNumber ?? null,
          },
        },
      },
    };
  }

  /** 39. GET /api/listers/verifications/documents */
  async getVerificationDocuments(user: userEntity) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: { idDocumentUpload: true },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const documents: any[] = [];
    if (profile.idDocumentUpload) {
      documents.push({
        documentId: profile.idDocumentUpload.id,
        type: profile.idDocumentType || 'ID',
        documentUrl: profile.idDocumentUpload.url,
        status:
          profile.idDocumentStatus === 'APPROVED' ? 'verified' : 'pending',
        uploadedDate: profile.idDocumentUpload.createdAt.toISOString(),
        verifiedDate:
          profile.idDocumentStatus === 'APPROVED'
            ? profile.idDocumentUpload.createdAt.toISOString()
            : null,
        notes:
          profile.idDocumentStatus === 'APPROVED'
            ? 'Document verified successfully'
            : 'Pending verification',
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
  async uploadIdDocument(
    user: userEntity,
    body: { uploadId: string; idType: string },
  ) {
    if (!body.uploadId) {
      throw new ForbiddenException('uploadId is required');
    }
    if (!body.idType) {
      throw new ForbiddenException(
        'idType is required (NIN, PASSPORT, DRIVERS_LICENSE)',
      );
    }

    const validIdTypes = ['NIN', 'PASSPORT', 'DRIVERS_LICENSE'];
    const idType = body.idType.toUpperCase();
    if (!validIdTypes.includes(idType)) {
      throw new ForbiddenException(
        'idType must be NIN, PASSPORT, or DRIVERS_LICENSE',
      );
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
        idDocumentUpload: {
          connect: { id: body.uploadId },
        },
        idDocumentType: idType,
      },
      include: { idDocumentUpload: true },
    });

    return {
      success: true,
      message: 'ID document uploaded successfully',
      data: {
        document: {
          documentId: updated.idDocumentUpload?.id ?? body.uploadId,
          type: idType,
          documentUrl: updated.idDocumentUpload?.url ?? null,
          status: 'pending_verification',
          uploadedDate:
            updated.idDocumentUpload?.createdAt.toISOString() ??
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

  /** 41b. POST /api/listers/verifications/bvn */
  async submitBvn(user: userEntity, body: { bvn: string }) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
    });

    if (!profile) {
      throw new NotFoundException(
        'Profile not found. Please complete your profile first.',
      );
    }

    const updated = await this.prisma.profile.update({
      where: { userId: user.id },
      data: { bvn: body.bvn },
    });

    return {
      success: true,
      message: 'BVN submitted successfully',
      data: {
        status: updated.bvn ? 'verified' : 'not_verified',
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
      city?: string;
      state?: string;
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
      email: body.email?.trim() || null,
      phoneNumber: body.phone,
      relationship: body.relationship,
      city: (body.city ?? '').trim(),
      state: (body.state ?? '').trim(),
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

    const contactRow = contact as typeof contact & { email?: string | null };

    return {
      success: true,
      message: 'Emergency contact updated successfully',
      data: {
        emergencyContact: {
          contactId: contact.id,
          fullName: contact.name,
          email: contactRow.email ?? null,
          phone: contact.phoneNumber,
          relationship: contact.relationship,
          city: contact.city,
          state: contact.state,
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
    if (!hasItem)
      throw new ForbiddenException('Order not found or access denied');
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
        {
          profile: {
            businessInfo: {
              businessName: { contains: query.search, mode: 'insensitive' },
            },
          },
        },
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
          shopDescription:
            lister.profile?.businessInfo?.businessDescription || '',
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
          shopDescription:
            lister.profile?.businessInfo?.businessDescription || '',
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
            cancellationPolicy:
              'Free cancellation up to 48 hours before rental',
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
      status: ProductStatus.APPROVED,
      isActive: true,
    };

    if (query.category) {
      where.category = {
        name: { equals: query.category, mode: 'insensitive' },
      };
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
          originalValue: p.originalValue,
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

  /** GET /api/listers/stats */
  async getListerStats(user: userEntity, timeframe: string = 'month') {
    try {
      const now = new Date();
      let currentStart: Date, currentEnd: Date, prevStart: Date, prevEnd: Date;

      if (timeframe === 'year') {
        currentStart = startOfYear(now);
        currentEnd = endOfYear(now);
        prevStart = startOfYear(subYears(now, 1));
        prevEnd = endOfYear(subYears(now, 1));
      } else {
        // Default to month
        currentStart = startOfMonth(now);
        currentEnd = endOfMonth(now);
        prevStart = startOfMonth(subMonths(now, 1));
        prevEnd = endOfMonth(subMonths(now, 1));
      }

      const getStatsForPeriod = async (start: Date, end: Date) => {
        const [earnings, ordersCount, activeRentals, pendingPayouts] =
          await Promise.all([
            // Total Earnings from rentals in period
            this.prisma.rental.aggregate({
              where: {
                curatorId: user.id,
                startDate: { gte: start, lte: end },
              },
              _sum: { totalAmount: true },
            }),
            // Total Orders count
            this.prisma.order.count({
              where: {
                orderItems: { some: { product: { curatorId: user.id } } },
                createdAt: { gte: start, lte: end },
              },
            }),
            // Active Rentals
            this.prisma.rental.count({
              where: {
                curatorId: user.id,
                isReturned: false,
                createdAt: { lte: end },
              },
            }),
            // Pending Payouts (Escrow LOCKED)
            this.prisma.escrow.aggregate({
              where: {
                listerId: user.id,
                status: 'LOCKED',
                createdAt: { lte: end },
              },
              _sum: { rentalAmount: true },
            }),
          ]);

        return {
          earnings: earnings._sum.totalAmount || 0,
          orders: ordersCount || 0,
          activeRentals: activeRentals || 0,
          pendingPayouts: pendingPayouts._sum?.rentalAmount || 0,
        };
      };

      const currentStats = await getStatsForPeriod(currentStart, currentEnd);
      const prevStats = await getStatsForPeriod(prevStart, prevEnd);

      const calculateChange = (current: number, previous: number) => {
        if (previous === 0)
          return { percent: current > 0 ? 100 : 0, direction: 'up' };
        const percent =
          Math.round(((current - previous) / previous) * 10000) / 100;
        return {
          percent: Math.abs(percent),
          direction: percent >= 0 ? 'up' : 'down',
        };
      };

      const earningsChange = calculateChange(
        currentStats.earnings,
        prevStats.earnings,
      );
      const ordersChange = calculateChange(
        currentStats.orders,
        prevStats.orders,
      );
      const activeChange = calculateChange(
        currentStats.activeRentals,
        prevStats.activeRentals,
      );
      const payoutsChange = calculateChange(
        currentStats.pendingPayouts,
        prevStats.pendingPayouts,
      );

      return {
        success: true,
        data: {
          totalEarnings: {
            amount: currentStats.earnings,
            currency: CURRENCY,
            changePercent: earningsChange.percent,
            changeDirection: earningsChange.direction,
          },
          totalOrders: {
            count: currentStats.orders,
            changePercent: ordersChange.percent,
            changeDirection: ordersChange.direction,
          },
          activeRentals: {
            count: currentStats.activeRentals,
            changePercent: activeChange.percent,
            changeDirection: activeChange.direction,
          },
          pendingPayouts: {
            amount: currentStats.pendingPayouts,
            currency: CURRENCY,
            changePercent: payoutsChange.percent,
            changeDirection: payoutsChange.direction,
          },
          timeframe,
          generatedAt: now.toISOString(),
        },
      };
    } catch (e) {
      console.error('getListerStats error:', e);
      throw new InternalServerErrorException('Failed to fetch lister stats');
    }
  }

  /** GET /api/listers/rentals/overtime */
  async getRentalsOvertime(
    user: userEntity,
    timeframe: string = 'year',
    yearStr?: string,
  ) {
    try {
      const year = yearStr ? parseInt(yearStr, 10) : new Date().getFullYear();
      const startOfYear = new Date(year, 0, 1);
      const endOfYear = new Date(year, 11, 31, 23, 59, 59);

      const rentals = await this.prisma.rental.findMany({
        where: {
          curatorId: user.id,
          startDate: {
            gte: startOfYear,
            lte: endOfYear,
          },
        },
        select: {
          totalAmount: true,
          startDate: true,
        },
      });

      const months = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ];

      const monthlyData = months.map((month, index) => {
        const monthRentals = rentals.filter(
          (r) => r.startDate.getMonth() === index,
        );
        const revenue = monthRentals.reduce((sum, r) => sum + r.totalAmount, 0);
        const orders = monthRentals.length;

        // Use the last day of the month for the timestamp as a placeholder
        const timestamp = new Date(
          year,
          index + 1,
          0,
          23,
          59,
          59,
        ).toISOString();

        return {
          month,
          revenue,
          orders,
          timestamp,
        };
      });

      const totalRevenue = monthlyData.reduce((sum, m) => sum + m.revenue, 0);
      const totalOrders = monthlyData.reduce((sum, m) => sum + m.orders, 0);

      return {
        success: true,
        data: {
          rentalsOvertime: monthlyData,
          timeframe,
          year,
          summary: {
            totalRevenue,
            totalOrders,
            avgMonthlyRevenue: Math.round(totalRevenue / 12),
            avgMonthlyOrders: Math.round((totalOrders / 12) * 10) / 10,
          },
        },
      };
    } catch (e) {
      console.error('getRentalsOvertime error:', e);
      throw new InternalServerErrorException(
        'Failed to fetch rentals overtime data',
      );
    }
  }

  async getWallet(userId: string) {
    let wallet: any = await this.prisma.wallet.findUnique({
      where: { userId },
      include: { transactions: { take: 1, orderBy: { createdAt: 'desc' } } },
    });

    if (!wallet) {
      wallet = await this.prisma.wallet.create({ data: { userId } });
      wallet.transactions = [];
    }

    const safeWallet = wallet;

    const activeRentals = await this.prisma.rental.findMany({
      where: { curatorId: userId, isReturned: false },
      include: { order: true },
    });

    return {
      success: true,
      data: {
        wallet: {
          walletId: safeWallet.id,
          userId: safeWallet.userId,
          balance: {
            availableBalance: safeWallet.availableBalance,
            lockedBalance: safeWallet.collateralBalance,
            totalBalance: safeWallet.mainBalance,
            currency: CURRENCY,
            lastUpdated: safeWallet.updatedAt,
          },
          lockedBreakdown: {
            activeRentals: [],
            disputeHolds: [],
            totalLockedAmount: 0,
          },
          statistics: {
            totalDeposits: 0,
            totalSpent: 0,
            totalRefunds: 0,
            lifetimeTransactions: 0,
            activeRentalOrders: activeRentals.length,
            activeDisputes: 0,
          },
          lastTransaction: safeWallet.transactions?.[0]
            ? {
                type:
                  safeWallet.transactions[0].amount < 0 ? 'debit' : 'credit',
                amount: Math.abs(safeWallet.transactions[0].amount),
                description: safeWallet.transactions[0].note,
                date: safeWallet.transactions[0].createdAt,
              }
            : null,
          linkedBankAccounts: await (this.prisma as any).bankAccount.count({
            where: { userId },
          }),
          canWithdraw: true,
          minimumFundsForTransaction: 1000,
        },
      },
    };
  }

  async getWalletTransactions(userId: string, query: any) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const [total, transactions] = await this.prisma.$transaction([
      this.prisma.walletTransaction.count({ where: { wallet: { userId } } }),
      this.prisma.walletTransaction.findMany({
        where: { wallet: { userId } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            include: { orderItems: { include: { product: true }, take: 1 } },
          },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        transactions: transactions.map((t) => ({
          transactionId: t.id,
          type: t.amount < 0 ? 'debit' : 'credit',
          amount: Math.abs(t.amount),
          currency: CURRENCY,
          description: t.note,
          orderId: t.orderId,
          status: t.status,
          timestamp: t.createdAt,
          relatedOrder: t.order
            ? {
                orderId: t.order.orderId,
                itemName: t.order.orderItems[0]?.product.name || 'Unknown Item',
                listerName: 'Unknown',
              }
            : null,
        })),
        totalTransactions: total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getBankAccounts(userId: string) {
    const accounts = await (this.prisma as any).bankAccount.findMany({
      where: { userId },
    });
    return {
      success: true,
      data: {
        bankAccounts: accounts,
        totalAccounts: accounts.length,
      },
    };
  }

  async getLockedBalances(userId: string) {
    void userId;
    return {
      success: true,
      data: {
        lockedBalances: {
          totalLocked: 0,
          currency: CURRENCY,
          activeRentals: [],
          disputeHolds: [],
          lockReleaseSchedule: {
            nextReleaseDate: null,
            nextReleaseAmount: 0,
            upcomingReleases: [],
          },
        },
      },
    };
  }

  async getWithdrawal(userId: string, withdrawalId: string) {
    const withdrawal = await (this.prisma as any).withdrawalRequest.findFirst({
      where: { id: withdrawalId, userId },
      include: { bankAccount: true },
    });

    if (!withdrawal) throw new NotFoundException('Withdrawal not found');

    return {
      success: true,
      data: {
        withdrawal: {
          withdrawalId: withdrawal.id,
          amount: withdrawal.amount,
          currency: withdrawal.currency,
          bankAccount: {
            bankName: withdrawal.bankAccount.bankName,
            accountNumber: withdrawal.bankAccount.accountNumber,
            accountName: withdrawal.bankAccount.accountName,
          },
          fee: withdrawal.fee,
          netAmount: withdrawal.netAmount,
          status: withdrawal.status,
          estimatedDelivery: null,
          reference: withdrawal.reference,
          initiatedAt: withdrawal.createdAt,
          timeline: [],
        },
      },
    };
  }

  async requestWithdrawal(
    userId: string,
    data: { amount: number; bankAccountId: string },
  ) {
    if (!data.amount || data.amount <= 0) {
      throw new BadRequestException('Invalid withdrawal amount');
    }

    const bankAccount = await (this.prisma as any).bankAccount.findFirst({
      where: { id: data.bankAccountId, userId },
    });

    if (!bankAccount) {
      throw new BadRequestException('Invalid bank account linked to user');
    }

    const wallet = await (this.prisma as any).wallet.findUnique({
      where: { userId },
    });

    const amount = Math.round(Number(data.amount));
    if (!wallet) {
      throw new BadRequestException('Insufficient wallet balance');
    }

    const reference = `WD-${randomUUID().split('-')[0].toUpperCase()}`;

    const withdrawal = await this.prisma.$transaction(async (tx) => {
      const w = await (tx as any).wallet.findUnique({
        where: { id: wallet.id },
      });
      if (!w) throw new BadRequestException('Insufficient wallet balance');

      if (w.availableBalance < amount) {
        if (
          w.collateralBalance === 0 &&
          w.availableBalance < w.mainBalance &&
          w.mainBalance >= amount
        ) {
          throw new BadRequestException(
            'Wallet balances are inconsistent (availableBalance is below mainBalance with no collateral). Reconcile in the database before withdrawing.',
          );
        }
        throw new BadRequestException('Insufficient wallet balance');
      }

      await (tx as any).wallet.update({
        where: { id: w.id },
        data: {
          mainBalance: { decrement: amount },
          availableBalance: { decrement: amount },
        },
      });

      await (tx as any).walletTransaction.create({
        data: {
          walletId: w.id,
          type: 'MAIN',
          amount: -amount,
          status: 'SUCCESS',
          note: `Withdrawal request to ${bankAccount.bankName} (Ref: ${reference})`,
        },
      });

      return await (tx as any).withdrawalRequest.create({
        data: {
          userId,
          amount,
          netAmount: amount,
          currency: CURRENCY,
          bankAccountId: data.bankAccountId,
          status: 'PENDING',
          reference,
        },
      });
    });

    return {
      success: true,
      message: 'Withdrawal request submitted successfully',
      data: {
        withdrawal: {
          withdrawalId: withdrawal.id,
          amount: withdrawal.amount,
          status: withdrawal.status,
          reference: withdrawal.reference,
          initiatedAt: withdrawal.createdAt,
        },
      },
    };
  }
}
