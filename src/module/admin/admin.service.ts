import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../services/prisma/prisma.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { MailService } from '../../services/mail/mail.service';
import {
  AvailabilityStatus,
  DisputeStatus,
  OrderStatus,
  Prisma,
  ProductStatus,
  Role,
  ShipmentType,
  WalletTransactionStatus,
} from '@prisma/client';
import { addMinutes } from 'date-fns';
import { incrementClosetRevenueForListerPayout } from '../closet/closet-revenue.util';
import {
  markRentalProductsAvailableForOrder,
  markRentalsReturnedForOrder,
  orderHasCompletedReturnRequest,
} from '../order/mark-rentals-returned.util';
import { formatAdminReturnRequest } from '../order/admin-return-request.format';
import { LIVE_SHOP_STATUSES, ADMIN_ACTIVE_LISTING_STATUSES } from '../product/product-list-scope.util';
import {
  MESSAGE_CHAT_UPLOADS_ORDER_BY,
  PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
} from 'src/utils/product-attachment-upload-order';
import { ADMIN_ORDER_ANALYTICS_CUTOFF } from 'src/constants/admin-analytics';
import {
  buildProductionWalletTransactionWhere,
  buildWalletStatsOrderWhere,
  buildWalletStatsUserWhere,
  getStagingInternalCuratorId,
} from 'src/utils/admin-wallet-filters';
import {
  collectOrderIdsForUser,
  deleteOrderCascade,
  deleteProductCascade,
  deleteProfileCascade,
} from 'src/utils/cascade-delete';
import {
  availabilityRequestWindowFieldMap,
  extractRangeMapFromEntity,
} from 'src/utils/dispatch-windows';
import { formatRentalBoundaryDateLagos } from '../shipment/dispatch-window-format';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    private mailService: MailService,
  ) {}

  private getDisputeUniqueWhere(disputeId: string) {
    return disputeId.startsWith('DQ-') ? { disputeId } : { id: disputeId };
  }

  private buildListPagination(total: number, page: number, limit: number) {
    return {
      total,
      page,
      limit,
      pages: Math.ceil(total / limit) || 1,
    };
  }

  /** `Order.escrows` is a list; settlement uses a single row — same as first element. */
  private pickOrderEscrow(order: any): any | null {
    if (!order?.escrows) return null;
    if (Array.isArray(order.escrows)) return order.escrows[0] ?? null;
    return order.escrows;
  }

  /**
   * Max `refundAmount` allowed on dispute resolve — must match `resolveDisputeAndSettle`.
   * At checkout, `escrow.rentalAmount` is set to `listerRentalAndCleaning` (rent + cleaning),
   * so `cleaningFee` must not be added again while status is LOCKED.
   */
  private getEscrowPayoutRefundCap(escrow: any): number {
    const st = String(escrow?.status ?? '');
    const rental = Math.max(0, Number(escrow?.rentalAmount || 0));
    const cleaning = Math.max(0, Number(escrow?.cleaningFee || 0));
    const resale = Math.max(0, Number(escrow?.resaleAmount || 0));
    if (st === 'LOCKED') {
      return rental + resale;
    }
    if (st === 'PARTIALLY_RELEASED') {
      return cleaning + resale;
    }
    return 0;
  }

  /**
   * Caps for admin dispute resolution UI — must stay in sync with `resolveDisputeAndSettle`.
   */
  private buildDisputeResolutionContext(input: {
    escrow: any | null;
    renter: any | null;
    lister: any | null;
    raisedBy: any | null;
  }): {
    initiator: 'renter' | 'lister' | 'unknown';
    refundAmountMax: number;
    collateralWithheldToListerMax: number;
    escrowStatus: string | null;
  } | null {
    const { escrow, renter, lister, raisedBy } = input;
    if (!escrow) return null;

    const escrowStatus = String(escrow.status ?? '');
    const totalCollateralLocked = Math.max(
      0,
      Number(escrow.collateralAmount) || 0,
    );

    const payoutLocked = this.getEscrowPayoutRefundCap(escrow);

    let initiator: 'renter' | 'lister' | 'unknown' = 'unknown';
    if (raisedBy?.id && renter?.id && raisedBy.id === renter.id) {
      initiator = 'renter';
    } else if (raisedBy?.id && lister?.id && raisedBy.id === lister.id) {
      initiator = 'lister';
    }

    return {
      initiator,
      refundAmountMax: payoutLocked,
      collateralWithheldToListerMax: totalCollateralLocked,
      escrowStatus,
    };
  }

  private normalizeDisputeStatus(raw: string) {
    const key = String(raw || '')
      .trim()
      .toUpperCase();
    const map: Record<string, DisputeStatus> = {
      PENDING: DisputeStatus.PENDING,
      PENDING_REVIEW: DisputeStatus.PENDING,
      IN_REVIEW: DisputeStatus.IN_REVIEW,
      REVIEWING: DisputeStatus.IN_REVIEW,
      RESOLVED: DisputeStatus.RESOLVED,
      RESELOVED: DisputeStatus.RESOLVED,
      REJECTED: DisputeStatus.REJECTED,
      WITHDRAW: DisputeStatus.WITHDRAW,
      WITHDRAWN: DisputeStatus.WITHDRAW,
    };
    return map[key];
  }

  /** UI timeframe selection (all_time | year | month), before launch cutoff is applied. */
  private buildAnalyticsDateRange(
    timeframe: string,
    year?: string,
    month?: string,
  ): { gte?: Date; lte?: Date } {
    const tf = String(timeframe || 'all_time').toLowerCase();
    if (tf === 'all_time') return {};

    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    if (Number.isNaN(y)) return {};

    if (tf === 'year') {
      return {
        gte: new Date(Date.UTC(y, 0, 1)),
        lte: new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999)),
      };
    }

    if (tf === 'month') {
      const m = month ? parseInt(month, 10) - 1 : 0;
      if (Number.isNaN(m) || m < 0 || m > 11) return {};
      return {
        gte: new Date(Date.UTC(y, m, 1)),
        lte: new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)),
      };
    }

    return {};
  }

  /** Order-linked analytics (orders, rentals): max(selected range start, launch cutoff). */
  private resolveOrderAnalyticsDateRange(
    timeframe: string,
    year?: string,
    month?: string,
  ): { gte: Date; lte?: Date } {
    const selected = this.buildAnalyticsDateRange(timeframe, year, month);
    const gte =
      selected.gte && selected.gte > ADMIN_ORDER_ANALYTICS_CUTOFF
        ? selected.gte
        : new Date(ADMIN_ORDER_ANALYTICS_CUTOFF);
    return {
      gte,
      ...(selected.lte ? { lte: selected.lte } : {}),
    };
  }

  /**
   * Gross order revenue (sum of `totalAmountPaid`), same as admin overview
   * analytics and rentals-revenue trend charts.
   */
  private async sumTotalOrderRevenue(
    timeframe = 'all_time',
    year?: string,
    month?: string,
  ): Promise<number> {
    const orderDateRange = this.resolveOrderAnalyticsDateRange(
      timeframe,
      year,
      month,
    );
    const revenueAgg = await this.prisma.order.aggregate({
      where: {
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] },
        createdAt: orderDateRange,
      },
      _sum: { totalAmountPaid: true },
    });
    return revenueAgg._sum.totalAmountPaid ?? 0;
  }

  /**
   * Users with marketplace engagement in the analytics period:
   * orders (renter or lister) and/or availability requests (requester or lister).
   * Not subject to the order revenue launch cutoff.
   */
  private buildActiveUserWhere(
    dateRange: { gte?: Date; lte?: Date },
    hasDateRange: boolean,
  ): Prisma.UserWhereInput {
    const activityInPeriod = hasDateRange ? { createdAt: dateRange } : {};

    const orderWhere: Prisma.OrderWhereInput = {
      status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] },
      ...(hasDateRange ? { createdAt: dateRange } : {}),
    };

    const lastSeenInPeriod = hasDateRange
      ? { lastSeenAt: dateRange }
      : { lastSeenAt: { not: null } };

    return {
      role: { in: [Role.RENTER, Role.LISTER] },
      isSuspended: false,
      OR: [
        { orders: { some: orderWhere } },
        { orderListers: { some: { order: orderWhere } } },
        { requestedAvailability: { some: activityInPeriod } },
        { listerRequests: { some: activityInPeriod } },
        lastSeenInPeriod,
      ],
    };
  }

  /** Remaining funds held in escrow for admin display (matches wallet stats card). */
  private getEscrowLockedAmount(escrow: {
    status: string;
    rentalAmount: number;
    resaleAmount?: number | null;
    collateralAmount: number;
    cleaningFee: number;
  }): number {
    const rental = escrow.rentalAmount || 0;
    const resale = escrow.resaleAmount || 0;
    const collateral = escrow.collateralAmount || 0;
    const cleaning = escrow.cleaningFee || 0;

    if (escrow.status === 'LOCKED') {
      return rental + resale + collateral + cleaning;
    }
    if (escrow.status === 'PARTIALLY_RELEASED') {
      return resale + collateral + cleaning;
    }
    return 0;
  }

  private escrowReasonLabel(
    escrow: {
      status: string;
      rentalAmount: number;
      resaleAmount?: number | null;
    },
    listingType?: string | null,
  ): string {
    const hasRental = (escrow.rentalAmount || 0) > 0;
    const hasResale = (escrow.resaleAmount || 0) > 0;
    if (escrow.status === 'REFUNDED') return 'Refunded to renter';
    if (escrow.status === 'RELEASED') return 'Funds released to lister';
    if (escrow.status === 'PARTIALLY_RELEASED') {
      return hasResale
        ? 'Rental released; resale pending confirmation'
        : 'Partial release';
    }
    if (listingType === 'RESALE' || (!hasRental && hasResale)) {
      return 'Resale purchase held in escrow';
    }
    if (hasRental && hasResale) return 'Mixed rental and resale order';
    return 'Rental and collateral held until completion';
  }

  async getAnalyticsStats(timeframe: string, year?: string, month?: string) {
    const selectedRange = this.buildAnalyticsDateRange(timeframe, year, month);
    const hasDateRange = Boolean(selectedRange.gte || selectedRange.lte);
    const orderDateRange = this.resolveOrderAnalyticsDateRange(
      timeframe,
      year,
      month,
    );

    const orderWhere: Prisma.OrderWhereInput = {
      status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] },
      createdAt: orderDateRange,
    };

    const [
      totalOrders,
      totalRevenue,
      activeListings,
      activeDisputes,
      activeUsers,
      deliveryOrders,
    ] = await Promise.all([
      this.prisma.order.count({ where: orderWhere }),
      this.sumTotalOrderRevenue(timeframe, year, month),
      this.prisma.product.count({
        where: {
          isActive: true,
          productVerified: true,
          status: { in: LIVE_SHOP_STATUSES },
        },
      }),
      this.prisma.dispute.count({
        where: {
          status: { in: [DisputeStatus.PENDING, DisputeStatus.IN_REVIEW] },
        },
      }),
      this.prisma.user.count({
        where: this.buildActiveUserWhere(selectedRange, hasDateRange),
      }),
      this.prisma.order.findMany({
        where: {
          ...orderWhere,
          dispatchedAt: { not: null },
          deliveredAt: { not: null },
        },
        select: { dispatchedAt: true, deliveredAt: true },
      }),
    ]);

    let avgDeliveryTime = 0;
    let avgDeliveryTimeMinutes = 0;
    if (deliveryOrders.length > 0) {
      const totalDays = deliveryOrders.reduce((sum, o) => {
        const days =
          (o.deliveredAt!.getTime() - o.dispatchedAt!.getTime()) /
          (1000 * 60 * 60 * 24);
        return sum + Math.max(0, days);
      }, 0);
      const avgDaysRaw = totalDays / deliveryOrders.length;
      avgDeliveryTime = Math.round(avgDaysRaw * 10) / 10;
      avgDeliveryTimeMinutes = Math.round(avgDaysRaw * 24 * 60);
    }

    const period =
      timeframe === 'month' && year && month
        ? `${year}-${String(month).padStart(2, '0')}`
        : timeframe === 'year' && year
          ? String(year)
          : 'all_time';

    return {
      success: true,
      data: {
        totalOrders,
        totalRevenue,
        activeListings,
        activeDisputes,
        activeUsers,
        avgDeliveryTime,
        avgDeliveryTimeMinutes,
        deliveryTimeSampleSize: deliveryOrders.length,
        timeframe,
        period,
        orderAnalyticsCutoff: ADMIN_ORDER_ANALYTICS_CUTOFF.toISOString(),
      },
    };
  }

  async getRentalsRevenueTrend(
    timeframe: string,
    year?: string,
    month?: string,
  ) {
    const orderRange = this.resolveOrderAnalyticsDateRange(
      timeframe,
      year,
      month,
    );
    const now = new Date();
    const rangeEnd =
      orderRange.lte ??
      new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999),
      );
    const rangeStart = orderRange.gte;

    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: rangeStart, lte: rangeEnd },
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] },
      },
      select: { createdAt: true, totalAmountPaid: true },
    });

    const monthKeys: string[] = [];
    const cursor = new Date(
      Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), 1),
    );
    const endCursor = new Date(
      Date.UTC(rangeEnd.getUTCFullYear(), rangeEnd.getUTCMonth(), 1),
    );
    while (cursor <= endCursor) {
      const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
      monthKeys.push(key);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    const buckets = new Map<string, { orders: number; revenue: number }>();
    for (const key of monthKeys) {
      buckets.set(key, { orders: 0, revenue: 0 });
    }

    for (const order of orders) {
      const key = `${order.createdAt.getUTCFullYear()}-${String(order.createdAt.getUTCMonth() + 1).padStart(2, '0')}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.orders += 1;
        bucket.revenue += order.totalAmountPaid || 0;
      }
    }

    const monthLabels = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];

    const trend = monthKeys.map((key) => {
      const [, m] = key.split('-');
      const monthIndex = parseInt(m, 10) - 1;
      const bucket = buckets.get(key) ?? { orders: 0, revenue: 0 };
      return {
        month: monthLabels[monthIndex] ?? key,
        orders: bucket.orders,
        revenue: bucket.revenue,
      };
    });

    return {
      success: true,
      data: {
        trend,
        timeframe,
        orderAnalyticsCutoff: ADMIN_ORDER_ANALYTICS_CUTOFF.toISOString(),
      },
    };
  }

  async getCategoryBreakdown(timeframe: string, year?: string, month?: string) {
    const categories = await this.prisma.productCategory.findMany({
      include: { _count: { select: { products: true } } },
    });

    const total =
      categories.reduce((sum, cat) => sum + cat._count.products, 0) || 1;

    return {
      success: true,
      data: categories.map((cat) => ({
        category: cat.name,
        value: cat._count.products,
        percentage: Math.round((cat._count.products / total) * 100),
      })),
    };
  }

  async getRevenueByCategory(timeframe: string, year?: string, month?: string) {
    // Mocked for chart
    return {
      success: true,
      data: [
        { category: 'Dresses', revenue: 15000 },
        { category: 'Bags', revenue: 8000 },
        { category: 'Shoes', revenue: 5000 },
      ],
    };
  }

  async getTopCurators(limit: number) {
    const topCurators = await this.prisma.user.findMany({
      where: { role: 'LISTER' },
      take: limit,
      include: {
        profile: true,
        _count: { select: { products: true, rentalsCurated: true } },
      },
      orderBy: { rentalsCurated: { _count: 'desc' } },
    });

    return {
      success: true,
      data: topCurators.map((user) => ({
        id: user.id,
        name: user.name,
        avatar: user.profile?.avatarUploadId || null,
        totalRentals: user._count.rentalsCurated,
        totalProducts: user._count.products,
      })),
    };
  }

  async getTopItems(limit: number) {
    const topProducts = await this.prisma.product.findMany({
      take: limit,
      include: {
        _count: { select: { rentals: true } },
        brand: true,
      },
      orderBy: { rentals: { _count: 'desc' } },
    });

    return {
      success: true,
      data: topProducts.map((prod) => ({
        id: prod.id,
        name: prod.name,
        brand: prod.brand?.name,
        rentalsCount: prod._count.rentals,
        dailyPrice: prod.dailyPrice,
      })),
    };
  }

  /* SETTINGS & AUTH */

  async getAdminProfile(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId, role: 'ADMIN' },
      include: { profile: true },
    });
    if (!admin) throw new NotFoundException('Admin profile not found');
    return { success: true, data: admin };
  }

  async getAdminNavState(adminId: string) {
    const admin = await this.prisma.user.findUnique({
      where: { id: adminId, role: 'ADMIN' },
      select: { adminSeenNavIds: true },
    });
    if (!admin) throw new NotFoundException('Admin profile not found');
    return { success: true, data: { seenNavIds: admin.adminSeenNavIds } };
  }

  async dismissAdminNav(adminId: string, navId: string) {
    const id = navId?.trim();
    if (!id) throw new BadRequestException('navId is required');

    const admin = await this.prisma.user.findUnique({
      where: { id: adminId, role: 'ADMIN' },
      select: { adminSeenNavIds: true },
    });
    if (!admin) throw new NotFoundException('Admin profile not found');
    if (admin.adminSeenNavIds.includes(id)) {
      return { success: true, data: { seenNavIds: admin.adminSeenNavIds } };
    }

    const seenNavIds = [...admin.adminSeenNavIds, id];
    await this.prisma.user.update({
      where: { id: adminId },
      data: { adminSeenNavIds: seenNavIds },
    });
    return { success: true, data: { seenNavIds } };
  }

  async updateAdminProfile(adminId: string, data: any) {
    const admin = await this.prisma.user.update({
      where: { id: adminId },
      data: { name: data.name },
    });
    return { success: true, message: 'Profile updated', data: admin };
  }

  async addAdmin(data: any) {
    // In real app, create user and assign role
    return { success: true, message: 'Admin added successfully' };
  }

  async updateAdminProfilePhoto(adminId: string, data: any) {
    return { success: true, message: 'Profile photo updated' };
  }

  async updateAdminPassword(adminId: string, data: any) {
    return { success: true, message: 'Password updated' };
  }

  async toggleAdmin2FA(adminId: string, data: any) {
    return {
      success: true,
      message: `2FA ${data.enabled ? 'enabled' : 'disabled'}`,
    };
  }

  async getAdminDevices(adminId: string) {
    return {
      success: true,
      data: [
        { device: 'MacBook Pro', location: 'Lagos, Nigeria', current: true },
      ],
    };
  }

  async logoutAllOtherDevices(adminId: string) {
    return { success: true, message: 'Logged out of all other devices' };
  }

  async getPlatformControls() {
    const settings = await this.prisma.platformSetting.findMany();
    return { success: true, data: settings };
  }

  async updatePlatformControls(data: any) {
    return { success: true, message: 'Platform controls updated' };
  }

  async getAdminRoles() {
    const roles = await this.prisma.adminRole.findMany();
    return { success: true, data: roles };
  }

  async createAdminRole(data: any) {
    const role = await this.prisma.adminRole.create({
      data: {
        name: data.name,
        description: data.description,
        permissions: data.permissions || [],
      },
    });
    return { success: true, message: 'Role created', data: role };
  }

  async updateRolePermissions(roleId: string, data: any) {
    const role = await this.prisma.adminRole.update({
      where: { id: roleId },
      data: { permissions: data.permissions },
    });
    return { success: true, message: 'Permissions updated', data: role };
  }

  async getAdmins() {
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      include: { adminRole: true },
    });
    return { success: true, data: admins };
  }

  async suspendUser(userId: string, suspended: boolean) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isSuspended: suspended },
    });

    return {
      success: true,
      message: `User ${suspended ? 'suspended' : 'unsuspended'} successfully`,
      data: updated,
    };
  }

  async suspendAdmin(adminId: string, suspended: boolean) {
    // Check if it's an admin first
    const admin = await this.prisma.user.findFirst({
      where: { id: adminId, role: Role.ADMIN },
    });

    if (!admin) {
      throw new NotFoundException('Admin user not found');
    }

    return this.suspendUser(adminId, suspended);
  }

  async deleteUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.authOtpToken.deleteMany({ where: { userId } });

        const profile = await tx.profile.findUnique({ where: { userId } });
        if (profile) {
          await deleteProfileCascade(tx, profile.id);
        }

        const cart = await tx.cart.findUnique({ where: { userId } });
        if (cart) {
          await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
          await tx.cart.delete({ where: { id: cart.id } });
        }

        await tx.favourite.deleteMany({ where: { userId } });
        await tx.productAvailabilityNotification.deleteMany({
          where: { userId },
        });
        await tx.vaultClosetSaleInterest.deleteMany({ where: { userId } });
        await tx.virtualAccount.deleteMany({ where: { userId } });
        await tx.bankAccount.deleteMany({ where: { userId } });
        await tx.withdrawalRequest.deleteMany({ where: { userId } });
        await tx.availabilityRequest.deleteMany({
          where: { listerId: userId },
        });
        await tx.availabilityRequest.deleteMany({
          where: { requesterId: userId },
        });
        await tx.transaction.deleteMany({ where: { userId } });

        await tx.brand.updateMany({
          where: { userId },
          data: { userId: null },
        });
        await tx.productCategory.updateMany({
          where: { userId },
          data: { userId: null },
        });
        await tx.tag.updateMany({ where: { userId }, data: { userId: null } });

        const orderIds = await collectOrderIdsForUser(tx, userId);
        for (const orderId of orderIds) {
          await deleteOrderCascade(tx, orderId);
        }

        const products = await tx.product.findMany({
          where: { curatorId: userId },
          select: { id: true },
        });
        for (const product of products) {
          await deleteProductCascade(tx, product.id);
        }

        await tx.closet.deleteMany({ where: { ownerId: userId } });
        await tx.rental.deleteMany({
          where: { OR: [{ userId }, { curatorId: userId }] },
        });
        await tx.review.deleteMany({
          where: { OR: [{ userId }, { curatorId: userId }] },
        });
        await tx.upload.deleteMany({ where: { userId } });

        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (wallet) {
          await tx.walletTransaction.deleteMany({
            where: { walletId: wallet.id },
          });
          await tx.wallet.delete({ where: { id: wallet.id } });
        }

        await tx.dispute.deleteMany({ where: { userId } });
        await tx.notification.deleteMany({ where: { userId } });
        await tx.notificationSettings.deleteMany({ where: { userId } });

        await tx.user.delete({ where: { id: userId } });
      },
      { timeout: 120_000 },
    );

    return {
      success: true,
      message: 'User and all related data deleted successfully',
    };
  }

  async verifyUser(userId: string, verified: boolean) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { isVerified: verified },
      include: {
        profile: {
          include: {
            avatarUpload: {
              select: { url: true },
            },
          },
        },
      },
    });

    return {
      success: true,
      message: `User ${verified ? 'verified' : 'unverified'} successfully`,
      data: updated,
    };
  }

  async updateAdminSettings(adminId: string, data: any) {
    return { success: true, message: 'Admin settings updated' };
  }

  async getAuditLogs(
    page: number,
    limit: number,
    action?: string,
    admin?: string,
    dateRange?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (action) where.actionType = action;
    if (admin) where.performedBy = admin;

    const [total, logs] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { admin: { select: { name: true, email: true } } },
      }),
    ]);

    return {
      success: true,
      data: {
        logs,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async exportAuditLogs() {
    return { success: true, data: { message: 'Audit logs exported' } };
  }

  /* DISPUTES */

  async getDisputeStats() {
    const [total, pending, reviewing, resolved, escalated] = await Promise.all([
      this.prisma.dispute.count(),
      this.prisma.dispute.count({ where: { status: 'PENDING' } }),
      this.prisma.dispute.count({ where: { status: 'IN_REVIEW' } }),
      this.prisma.dispute.count({ where: { status: 'RESOLVED' } }),
      this.prisma.dispute.count({ where: { status: 'REJECTED' } }),
    ]);

    return {
      success: true,
      data: {
        totalDisputes: total,
        pendingReview: pending,
        inReview: reviewing,
        resolved: resolved,
        rejected: escalated,
      },
    };
  }

  async getAllDisputes(page: number, limit: number, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (status) {
      const raw = String(status).trim();
      if (raw && raw.toUpperCase() !== 'ALL') {
        const key = raw.toUpperCase();
        const map: Record<string, string> = {
          PENDING: 'PENDING',
          PENDING_REVIEW: 'PENDING',
          IN_REVIEW: 'IN_REVIEW',
          REVIEWING: 'IN_REVIEW',
          // Admin UI sends kebab-case ?status=under-review
          'UNDER-REVIEW': 'IN_REVIEW',
          UNDER_REVIEW: 'IN_REVIEW',
          RESOLVED: 'RESOLVED',
          RESELOVED: 'RESOLVED',
          REJECTED: 'REJECTED',
          WITHDRAW: 'WITHDRAW',
          WITHDRAWN: 'WITHDRAW',
        };
        const normalized = map[key];
        if (normalized) where.status = normalized as any;
      }
    }

    const [total, disputes] = await this.prisma.$transaction([
      this.prisma.dispute.count({ where }),
      this.prisma.dispute.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              profile: {
                select: {
                  phoneNumber: true,
                  avatarUpload: { select: { url: true } },
                },
              },
            },
          },
          order: {
            select: {
              id: true,
              orderId: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  role: true,
                  profile: {
                    select: {
                      phoneNumber: true,
                      avatarUpload: { select: { url: true } },
                    },
                  },
                },
              },
              rentals: {
                take: 1,
                select: {
                  curatorId: true,
                  curator: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                      role: true,
                      profile: {
                        select: {
                          phoneNumber: true,
                          avatarUpload: { select: { url: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const mapped = disputes.map((d: any) => {
      const renter = d.order?.user ?? null;
      const lister = d.order?.rentals?.[0]?.curator ?? null;
      const raisedBy = d.user ?? null;

      return {
        id: d.disputeId,
        dbId: d.id,
        status: d.status,
        category: d.issueCategory,
        description: d.description,
        preferredResolution: d.preferredResolution ?? null,
        createdAt: d.createdAt?.toISOString?.() ?? d.createdAt,
        updatedAt: d.updatedAt?.toISOString?.() ?? d.updatedAt,
        raisedBy: raisedBy
          ? {
              id: raisedBy.id,
              name: raisedBy.name,
              role: raisedBy.role,
              avatar: raisedBy.profile?.avatarUpload?.url ?? null,
            }
          : null,
        renter: renter
          ? {
              id: renter.id,
              name: renter.name,
              role: renter.role,
              avatar: renter.profile?.avatarUpload?.url ?? null,
              email: renter.email,
              phone: renter.profile?.phoneNumber ?? null,
            }
          : null,
        lister: lister
          ? {
              id: lister.id,
              name: lister.name,
              role: lister.role,
              avatar: lister.profile?.avatarUpload?.url ?? null,
              email: lister.email,
              phone: lister.profile?.phoneNumber ?? null,
            }
          : null,
        orderId: d.order?.orderId ?? null,
        orderDbId: d.order?.id ?? null,
      };
    });

    return {
      success: true,
      data: {
        disputes: mapped,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getDisputeDetails(disputeId: string) {
    const isPublicDisputeId = disputeId.startsWith('DQ-');
    const dispute = await this.prisma.dispute.findUnique({
      where: isPublicDisputeId ? { disputeId } : { id: disputeId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            profile: {
              select: {
                phoneNumber: true,
                avatarUpload: { select: { url: true } },
              },
            },
          },
        },
        attachment: {
          include: {
            uploads: { orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY },
          },
        },
        chatRooms: {
          include: {
            message: {
              include: {
                uploads: { orderBy: MESSAGE_CHAT_UPLOADS_ORDER_BY },
                sender: {
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
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        order: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                profile: {
                  select: {
                    phoneNumber: true,
                    avatarUpload: { select: { url: true } },
                  },
                },
              },
            },
            escrows: true,
            rentals: {
              take: 1,
              include: {
                curator: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    profile: {
                      select: {
                        phoneNumber: true,
                        avatarUpload: { select: { url: true } },
                      },
                    },
                  },
                },
              },
            },
            orderItems: { include: { product: true } },
          },
        },
      },
    });

    if (!dispute) throw new NotFoundException('Dispute not found');

    const renter: any = (dispute as any).order?.user ?? null;
    const lister: any = (dispute as any).order?.rentals?.[0]?.curator ?? null;
    const raisedBy: any = (dispute as any).user ?? null;
    const otherParty =
      raisedBy?.id && renter?.id && lister?.id
        ? raisedBy.id === renter.id
          ? lister
          : renter
        : null;

    const order: any = (dispute as any).order;
    const item = order?.orderItems?.[0]?.product ?? null;
    const escrow: any = this.pickOrderEscrow(order);

    const resolutionContext = this.buildDisputeResolutionContext({
      escrow,
      renter,
      lister,
      raisedBy,
    });

    return {
      success: true,
      data: {
        id: (dispute as any).disputeId,
        dbId: (dispute as any).id,
        status: (dispute as any).status,
        category: (dispute as any).issueCategory,
        description: (dispute as any).description,
        preferredResolution: (dispute as any).preferredResolution ?? null,
        createdAt: (dispute as any).createdAt?.toISOString?.() ?? null,
        updatedAt: (dispute as any).updatedAt?.toISOString?.() ?? null,
        raisedBy: raisedBy
          ? {
              id: raisedBy.id,
              name: raisedBy.name,
              role: raisedBy.role,
              avatar: raisedBy.profile?.avatarUpload?.url ?? null,
              email: raisedBy.email,
              phone: raisedBy.profile?.phoneNumber ?? null,
            }
          : null,
        otherParty: otherParty
          ? {
              id: otherParty.id,
              name: otherParty.name,
              role: otherParty.role,
              avatar: otherParty.profile?.avatarUpload?.url ?? null,
              email: otherParty.email,
              phone: otherParty.profile?.phoneNumber ?? null,
            }
          : null,
        resolutionContext,
        orderDetails: order
          ? {
              id: order.orderId,
              dbId: order.id,
              totalAmountPaid: order.totalAmountPaid ?? null,
              escrow: escrow
                ? {
                    id: escrow.id,
                    status: escrow.status,
                    collateralAmount: escrow.collateralAmount ?? 0,
                    rentalAmount: escrow.rentalAmount ?? 0,
                    cleaningFee: escrow.cleaningFee ?? 0,
                    resaleAmount: escrow.resaleAmount ?? 0,
                    releasedAt: escrow.releasedAt?.toISOString?.() ?? null,
                  }
                : null,
              item: item
                ? {
                    id: item.id,
                    name: item.name,
                    imageUrl: item.imageUrl ?? null,
                  }
                : null,
              renter: renter
                ? {
                    id: renter.id,
                    name: renter.name,
                    avatar: renter.profile?.avatarUpload?.url ?? null,
                  }
                : null,
              lister: lister
                ? {
                    id: lister.id,
                    name: lister.name,
                    avatar: lister.profile?.avatarUpload?.url ?? null,
                  }
                : null,
            }
          : null,
        evidence: {
          uploads: (dispute as any).attachment?.uploads ?? [],
        },
        messages:
          (dispute as any).chatRooms?.message?.map((m: any) => ({
            id: m.id,
            senderId: m.senderId,
            sender: {
              id: m.sender?.id ?? m.senderId,
              name: m.sender?.name || 'User',
              avatarUrl: m.sender?.profile?.avatarUpload?.url ?? null,
              role: m.senderRole,
            },
            content: m.content,
            type: m.type,
            createdAt: m.createdAt?.toISOString?.() ?? m.createdAt,
            uploads: m.uploads ?? [],
          })) ?? [],
      },
    };
  }

  async updateDisputeStatus(
    disputeId: string,
    data: { status: string; note: string },
  ) {
    const dispute = await this.prisma.dispute.findUnique({
      where: this.getDisputeUniqueWhere(disputeId),
    });
    if (!dispute) throw new NotFoundException('Dispute not found');

    const normalized = this.normalizeDisputeStatus(data.status);
    if (!normalized) {
      throw new BadRequestException('Invalid dispute status');
    }

    const updated = await this.prisma.dispute.update({
      where: { id: dispute.id },
      data: {
        status: normalized,
      },
    });

    return {
      success: true,
      message: 'Dispute status updated successfully',
      data: updated,
    };
  }

  async resolveDispute(
    disputeId: string,
    data: { resolutionDetails: string; refundAmount?: number },
  ) {
    const dispute = await this.prisma.dispute.findUnique({
      where: this.getDisputeUniqueWhere(disputeId),
    });
    if (!dispute) throw new NotFoundException('Dispute not found');

    const updated = await this.prisma.dispute.update({
      where: { id: dispute.id },
      data: {
        status: DisputeStatus.RESOLVED,
      },
    });

    return {
      success: true,
      message: 'Dispute resolved successfully',
      data: updated,
    };
  }

  async resolveDisputeAndSettle(
    disputeId: string,
    data: {
      resolutionDetails: string;
      refundAmount?: number;
      collateralWithheldToLister?: number;
    },
  ) {
    const dispute = await this.prisma.dispute.findUnique({
      where: this.getDisputeUniqueWhere(disputeId),
      include: {
        order: {
          include: {
            user: true,
            escrows: true,
            returnRequests: true,
          },
        },
      },
    });

    if (!dispute) throw new NotFoundException('Dispute not found');
    const order: any = (dispute as any).order;
    if (!order) throw new NotFoundException('Order not found');
    const escrow = this.pickOrderEscrow(order);
    if (!escrow) throw new BadRequestException('Escrow not found');
    const escrowStatus = escrow.status as string;
    const totalCollateralLocked = Math.max(
      0,
      Number(escrow.collateralAmount) || 0,
    );
    const rawWithheld = Math.max(
      0,
      Math.round(Number(data.collateralWithheldToLister || 0)),
    );
    const collateralWithheldToLister = Math.min(
      rawWithheld,
      totalCollateralLocked,
    );
    const collateralReturnedToRenter =
      totalCollateralLocked - collateralWithheldToLister;

    const rawRefundAmount = Math.max(
      0,
      Math.round(Number(data.refundAmount || 0)),
    );

    const payoutLocked = this.getEscrowPayoutRefundCap(escrow);

    if (rawRefundAmount > payoutLocked) {
      throw new BadRequestException(
        `Refund amount cannot exceed locked escrow payout (max ${payoutLocked})`,
      );
    }

    const listerPayoutToRelease = Math.max(0, payoutLocked - rawRefundAmount);

    const lister = await this.prisma.user.findUnique({
      where: { id: escrow.listerId },
      select: { id: true, name: true, email: true },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedDispute = await tx.dispute.update({
        where: { id: dispute.id },
        data: {
          status: DisputeStatus.RESOLVED,
          resolutionDetails: data.resolutionDetails?.trim() || null,
        },
      });

      if (rawRefundAmount > 0) {
        const renterWallet = await tx.wallet.upsert({
          where: { userId: order.userId },
          create: {
            userId: order.userId,
            mainBalance: 0,
            availableBalance: rawRefundAmount,
            collateralBalance: 0,
          },
          update: {
            availableBalance: { increment: rawRefundAmount },
          },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: renterWallet.id,
            amount: rawRefundAmount,
            type: 'MAIN',
            status: 'SUCCESS',
            note: `Refund issued after dispute resolution for order ${order.orderId}`,
            orderId: order.id,
          },
        });
      }

      if (listerPayoutToRelease > 0) {
        const listerWallet = await tx.wallet.upsert({
          where: { userId: escrow.listerId },
          create: {
            userId: escrow.listerId,
            mainBalance: listerPayoutToRelease,
            availableBalance: listerPayoutToRelease,
            collateralBalance: 0,
          },
          update: {
            mainBalance: { increment: listerPayoutToRelease },
            availableBalance: { increment: listerPayoutToRelease },
          },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: listerWallet.id,
            amount: listerPayoutToRelease,
            type: 'MAIN',
            status: 'SUCCESS',
            note: `Escrow payout released after dispute resolution for order ${order.orderId}`,
            orderId: order.id,
          },
        });

        await incrementClosetRevenueForListerPayout(tx, {
          orderId: order.id,
          listerId: escrow.listerId,
          amount: listerPayoutToRelease,
          split: 'COMBINED',
        });
      }

      if (totalCollateralLocked > 0) {
        const renterWallet = await tx.wallet.upsert({
          where: { userId: order.userId },
          create: {
            userId: order.userId,
            mainBalance: 0,
            availableBalance: 0,
            collateralBalance: 0,
          },
          update: {},
        });

        if (renterWallet.collateralBalance < totalCollateralLocked) {
          throw new BadRequestException(
            'Renter wallet collateral balance is below escrow collateral amount',
          );
        }

        await tx.wallet.update({
          where: { id: renterWallet.id },
          data: {
            collateralBalance: { decrement: totalCollateralLocked },
            availableBalance: { increment: collateralReturnedToRenter },
            ...(collateralWithheldToLister > 0
              ? { mainBalance: { decrement: collateralWithheldToLister } }
              : {}),
          },
        });

        if (collateralReturnedToRenter > 0) {
          await tx.walletTransaction.create({
            data: {
              walletId: renterWallet.id,
              amount: collateralReturnedToRenter,
              type: 'MAIN',
              status: 'SUCCESS',
              note: `Collateral released after dispute resolution for order ${order.orderId}`,
              orderId: order.id,
            },
          });
        }

        if (collateralWithheldToLister > 0) {
          await tx.walletTransaction.create({
            data: {
              walletId: renterWallet.id,
              amount: -collateralWithheldToLister,
              type: 'MAIN',
              status: 'SUCCESS',
              note: `Collateral withheld after dispute resolution for order ${order.orderId}`,
              orderId: order.id,
            },
          });

          const listerWallet = await tx.wallet.upsert({
            where: { userId: escrow.listerId },
            create: {
              userId: escrow.listerId,
              mainBalance: collateralWithheldToLister,
              availableBalance: collateralWithheldToLister,
              collateralBalance: 0,
            },
            update: {
              mainBalance: { increment: collateralWithheldToLister },
              availableBalance: { increment: collateralWithheldToLister },
            },
          });

          await tx.walletTransaction.create({
            data: {
              walletId: listerWallet.id,
              amount: collateralWithheldToLister,
              type: 'MAIN',
              status: 'SUCCESS',
              note: `Collateral received after dispute resolution for order ${order.orderId}`,
              orderId: order.id,
            },
          });
        }
      }

      await tx.escrow.update({
        where: { id: escrow.id },
        data: { status: 'RELEASED' as any, releasedAt: new Date() },
      });

      await markRentalsReturnedForOrder(tx, order.id);

      const returnCompleted = orderHasCompletedReturnRequest(order);
      const returnShipmentDone =
        returnCompleted ||
        !!(await tx.shipment.findFirst({
          where: {
            orderId: order.id,
            type: ShipmentType.RETURN,
            status: 'COMPLETED',
          },
          select: { id: true },
        }));
      if (returnShipmentDone) {
        await markRentalProductsAvailableForOrder(tx, order.id);
      }

      if (
        order.status === OrderStatus.IN_DISPUTE ||
        (returnShipmentDone && order.status !== OrderStatus.COMPLETED)
      ) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.COMPLETED },
        });
      }

      return { updatedDispute };
    });

    const clientUrl = process.env.CLIENT_URL || '';
    const resolutionDetailsText = (data.resolutionDetails ?? '').trim();

    const renterWalletCreditTotal = rawRefundAmount + collateralReturnedToRenter;
    const listerWalletCreditTotal =
      listerPayoutToRelease + collateralWithheldToLister;

    if (order.user?.id) {
      const disputeLink = `${clientUrl}/renters/dispute`;
      const walletWithdrawLink = `${clientUrl}/renters/wallet`;
      await this.notificationService.createNotification({
        userId: order.user.id,
        title: 'Dispute Resolved',
        message: `Your dispute for order ${order.orderId} has been resolved.`,
        type: 'DISPUTE_STATUS',
        metadata: {
          disputeId: dispute.disputeId,
          orderId: order.id,
          orderNumber: order.orderId,
          collateralWithheldToLister,
          collateralReturnedToRenter,
        },
        sendEmail: true,
        emailData: {
          email: order.user.email,
          userName: order.user.name,
          orderId: order.orderId,
          disputeId: dispute.disputeId,
          status: 'resolved',
          disputeRecipient: 'renter',
          disputeLink,
          resolutionDetails: resolutionDetailsText,
          refundAmount: rawRefundAmount,
          collateralReturnedToRenter,
          renterWalletCreditTotal,
          showRenterWithdrawSteps: renterWalletCreditTotal > 0,
          walletWithdrawLink,
          collateralWithheldToLister,
        },
      });
    }

    if (lister?.id) {
      const disputeLink = `${clientUrl}/listers/dispute`;
      const walletWithdrawLink = `${clientUrl}/listers/wallet`;
      await this.notificationService.createNotification({
        userId: lister.id,
        title: 'Dispute Resolved',
        message: `A dispute for order ${order.orderId} has been resolved.`,
        type: 'DISPUTE_STATUS',
        metadata: {
          disputeId: dispute.disputeId,
          orderId: order.id,
          orderNumber: order.orderId,
          collateralWithheldToLister,
        },
        sendEmail: true,
        emailData: {
          email: lister.email,
          userName: lister.name,
          orderId: order.orderId,
          disputeId: dispute.disputeId,
          status: 'resolved',
          disputeRecipient: 'lister',
          disputeLink,
          resolutionDetails: resolutionDetailsText,
          listerEscrowPayout: listerPayoutToRelease,
          listerCollateralCompensation: collateralWithheldToLister,
          listerWalletCreditTotal,
          showListerWithdrawSteps: listerWalletCreditTotal > 0,
          walletWithdrawLink,
          compensationToLister: collateralWithheldToLister,
          collateralWithheldToLister,
          collateralReturnedToRenter: 0,
        },
      });
    }

    return {
      success: true,
      message: 'Dispute resolved successfully',
      data: {
        disputeId: dispute.disputeId,
        status: 'RESOLVED',
        refundAmount: rawRefundAmount,
        listerPayoutReleased: listerPayoutToRelease,
        collateralWithheldToLister,
        collateralReturnedToRenter,
        db: result.updatedDispute,
      },
    };
  }

  async assignDispute(disputeId: string, data: { adminId: string }) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
    });
    if (!dispute) throw new NotFoundException('Dispute not found');

    // Currently schema.prisma does not have an assignedTo field for Disputes
    // So we just mock the assignment
    return {
      success: true,
      message: `Dispute assigned to admin ${data.adminId} successfully`,
      data: dispute,
    };
  }

  /* WALLETS & ESCROW */

  async getWalletStats() {
    const orderFeeWhere = buildWalletStatsOrderWhere();
    const walletUserWhere = buildWalletStatsUserWhere();
    const stagingCuratorId = getStagingInternalCuratorId();
    const cutoff = ADMIN_ORDER_ANALYTICS_CUTOFF;

    const listerEscrowReleaseWhere: Prisma.WalletTransactionWhereInput = {
      amount: { gt: 0 },
      status: WalletTransactionStatus.SUCCESS,
      createdAt: { gte: cutoff },
      wallet: { user: { ...walletUserWhere, role: Role.LISTER } },
      OR: [
        {
          note: {
            contains: 'Payment released for completed',
            mode: 'insensitive',
          },
        },
        {
          note: {
            contains: 'Rental payment released for order',
            mode: 'insensitive',
          },
        },
        {
          note: { contains: 'Escrow release for order', mode: 'insensitive' },
        },
        {
          note: {
            contains: 'Final payout released for completed order',
            mode: 'insensitive',
          },
        },
        {
          note: {
            contains: 'Escrow payout released after dispute resolution',
            mode: 'insensitive',
          },
        },
        {
          note: {
            contains: 'Resale payment auto-released for order',
            mode: 'insensitive',
          },
        },
        {
          note: {
            contains: 'Resale payment released for order',
            mode: 'insensitive',
          },
        },
        {
          note: {
            contains: 'Payment auto-released after',
            mode: 'insensitive',
          },
        },
        {
          note: {
            contains: 'Payment released for resale order',
            mode: 'insensitive',
          },
        },
      ],
    };

    const [
      walletSums,
      escrowLockedRows,
      releasedToListers,
      serviceFeeSum,
      vatSum,
    ] = await Promise.all([
      this.prisma.wallet.aggregate({
        where: { user: walletUserWhere },
        _sum: { mainBalance: true, collateralBalance: true },
      }),
      this.prisma.$queryRaw<Array<{ total: bigint }>>(
        Prisma.sql`
          SELECT COALESCE(SUM(
            CASE
              WHEN e.status = 'LOCKED' THEN
                e."rentalAmount" + COALESCE(e."resaleAmount", 0) + e."collateralAmount" + e."cleaningFee"
              WHEN e.status = 'PARTIALLY_RELEASED' THEN
                COALESCE(e."resaleAmount", 0) + e."collateralAmount" + e."cleaningFee"
              ELSE 0
            END
          ), 0)::bigint AS total
          FROM "Escrow" e
          INNER JOIN "Order" o ON o.id = e."orderId"
          WHERE o."createdAt" >= ${cutoff}
            AND o.status NOT IN ('CANCELLED', 'REJECTED')
            AND e."listerId" <> ${stagingCuratorId}
            AND o."userId" <> ${stagingCuratorId}
            AND e."listerId" NOT IN (
              SELECT u.id FROM "User" u
              WHERE u.role = 'ADMIN'
                OR u.email ILIKE '%mailtrap%'
                OR u.email ILIKE '%@example.com'
                OR u.email ILIKE 'test@%'
                OR u.email ILIKE '%@test.%'
            )
            AND o."userId" NOT IN (
              SELECT u.id FROM "User" u
              WHERE u.role = 'ADMIN'
                OR u.email ILIKE '%mailtrap%'
                OR u.email ILIKE '%@example.com'
                OR u.email ILIKE 'test@%'
                OR u.email ILIKE '%@test.%'
            )
        `,
      ),
      this.prisma.walletTransaction.aggregate({
        where: listerEscrowReleaseWhere,
        _sum: { amount: true },
      }),
      this.prisma.order.aggregate({
        where: orderFeeWhere,
        _sum: { serviceFee: true },
      }),
      this.prisma.order.aggregate({
        where: orderFeeWhere,
        _sum: { vatAmount: true },
      }),
    ]);

    const totalEscrowLocked = Number(escrowLockedRows[0]?.total ?? 0);
    const totalCollateralLocked = walletSums._sum.collateralBalance || 0;
    const platformServiceFees = serviceFeeSum._sum.serviceFee || 0;
    const totalVatCollected = vatSum._sum.vatAmount || 0;

    return {
      success: true,
      data: {
        totalWalletBalance:
          (walletSums._sum.mainBalance || 0) +
          (walletSums._sum.collateralBalance || 0),
        totalEscrowBalance: totalEscrowLocked,
        /** Renter collateral held in wallets (wallet.collateralBalance), not order escrow */
        totalCollateralLocked,
        totalReleasedToListers: releasedToListers._sum.amount || 0,
        /** @deprecated Use totalReleasedToListers; kept for older admin clients */
        totalReleasedToCurators: releasedToListers._sum.amount || 0,
        platformEarnings: platformServiceFees,
        platformServiceFees,
        totalVatCollected,
        orderAnalyticsCutoff: cutoff.toISOString(),
        excludesTestAccounts: true,
      },
    };
  }

  async getAllWallets(page: number, limit: number, search?: string) {
    const skip = (page - 1) * limit;
    const where: Prisma.WalletWhereInput = {};

    const trimmedSearch = search?.trim();
    if (trimmedSearch) {
      where.user = {
        OR: [
          { name: { contains: trimmedSearch, mode: 'insensitive' } },
          { email: { contains: trimmedSearch, mode: 'insensitive' } },
        ],
      };
    }

    const [total, wallets] = await this.prisma.$transaction([
      this.prisma.wallet.count({ where }),
      this.prisma.wallet.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: { user: { select: { name: true, email: true } } },
      }),
    ]);

    return {
      success: true,
      data: {
        wallets,
        pagination: this.buildListPagination(total, page, limit),
      },
    };
  }

  async getWalletDetails(walletId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      include: {
        user: true,
        transactions: {
          take: 50,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!wallet) throw new NotFoundException('Wallet not found');

    return { success: true, data: wallet };
  }

  async getAllEscrows(
    page: number,
    limit: number,
    status?: string,
    search?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.EscrowWhereInput = {};

    if (status && status !== 'ALL') {
      where.status = status.toUpperCase() as
        | 'LOCKED'
        | 'RELEASED'
        | 'PARTIALLY_RELEASED'
        | 'REFUNDED';
    }

    const trimmedSearch = search?.trim();
    if (trimmedSearch) {
      const matchingUsers = await this.prisma.user.findMany({
        where: {
          name: { contains: trimmedSearch, mode: 'insensitive' },
        },
        select: { id: true },
        take: 50,
      });
      const userIds = matchingUsers.map((u) => u.id);
      where.OR = [
        { order: { orderId: { contains: trimmedSearch, mode: 'insensitive' } } },
        ...(userIds.length > 0
          ? [{ listerId: { in: userIds } }, { renterId: { in: userIds } }]
          : []),
      ];
    }

    const [total, escrows] = await this.prisma.$transaction([
      this.prisma.escrow.count({ where }),
      this.prisma.escrow.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { orderId: true, listingType: true } },
        },
      }),
    ]);

    const userIds = new Set<string>();
    for (const e of escrows) {
      userIds.add(e.listerId);
      userIds.add(e.renterId);
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true },
    });
    const userById = new Map(users.map((u) => [u.id, u.name]));

    const mappedEscrows = escrows.map((e) => {
      const lockedAmount = this.getEscrowLockedAmount(e);
      const statusLower = e.status.toLowerCase();
      return {
        id: e.id,
        orderId: e.order.orderId,
        userId: e.renterId,
        userName: userById.get(e.renterId) ?? 'Unknown',
        renterName: userById.get(e.renterId) ?? 'Unknown',
        listerName: userById.get(e.listerId) ?? 'Unknown',
        renter: {
          id: e.renterId,
          name: userById.get(e.renterId) ?? 'Unknown',
        },
        lister: {
          id: e.listerId,
          name: userById.get(e.listerId) ?? 'Unknown',
        },
        amount: lockedAmount,
        lockedAmount,
        rentalAmount: e.rentalAmount,
        resaleAmount: e.resaleAmount,
        collateralAmount: e.collateralAmount,
        cleaningFee: e.cleaningFee,
        reason: this.escrowReasonLabel(e, e.order.listingType),
        lockedDate: e.createdAt.toISOString(),
        releaseDate: e.releasedAt?.toISOString() ?? null,
        status: statusLower,
        rawStatus: e.status,
      };
    });

    return {
      success: true,
      data: {
        escrows: mappedEscrows,
        pagination: this.buildListPagination(total, page, limit),
      },
    };
  }

  async releaseEscrow(
    escrowId: string,
    data: { amount?: number; note: string },
  ) {
    const escrow = await this.prisma.escrow.findUnique({
      where: { id: escrowId },
    });
    if (!escrow) throw new NotFoundException('Escrow not found');

    const updated = await this.prisma.escrow.update({
      where: { id: escrowId },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
        // Real implementation would transfer funds here
      },
    });

    return {
      success: true,
      message: 'Escrow funds released successfully',
      data: updated,
    };
  }

  async getAllWalletTransactions(page: number, limit: number, search?: string) {
    const skip = (page - 1) * limit;
    const baseWhere = buildProductionWalletTransactionWhere();
    const trimmedSearch = search?.trim();

    const where: Prisma.WalletTransactionWhereInput = trimmedSearch
      ? {
          AND: [
            baseWhere,
            {
              OR: [
                { id: { contains: trimmedSearch, mode: 'insensitive' } },
                { note: { contains: trimmedSearch, mode: 'insensitive' } },
                {
                  wallet: {
                    user: {
                      OR: [
                        {
                          name: {
                            contains: trimmedSearch,
                            mode: 'insensitive',
                          },
                        },
                        {
                          email: {
                            contains: trimmedSearch,
                            mode: 'insensitive',
                          },
                        },
                      ],
                    },
                  },
                },
                {
                  order: {
                    orderId: { contains: trimmedSearch, mode: 'insensitive' },
                  },
                },
              ],
            },
          ],
        }
      : baseWhere;

    const [total, transactions] = await this.prisma.$transaction([
      this.prisma.walletTransaction.count({ where }),
      this.prisma.walletTransaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          wallet: { select: { user: { select: { name: true, email: true } } } },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        transactions,
        pagination: this.buildListPagination(total, page, limit),
      },
    };
  }

  async exportWallets() {
    return {
      success: true,
      data: { message: 'Wallets exported successfully' },
    };
  }

  async getAllWithdrawals(
    page: number,
    limit: number,
    status?: string,
    search?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (status && status !== 'ALL') {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { reference: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [total, withdrawals] = await this.prisma.$transaction([
      this.prisma.withdrawalRequest.count({ where }),
      this.prisma.withdrawalRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              profile: {
                select: {
                  avatarUpload: { select: { url: true } },
                },
              },
            },
          },
          bankAccount: {
            select: {
              accountNumber: true,
              bankName: true,
              accountName: true,
            },
          },
        },
      }),
    ]);

    // Format to match user requested structure
    const formatted = withdrawals.map((w) => ({
      id: w.id,
      userId: w.userId,
      user: {
        id: w.user.id,
        name: w.user.name,
        email: w.user.email,
        avatar: (w.user as any).profile?.avatarUpload?.url || null,
      },
      bankAccount: w.bankAccount,
      amount: w.amount,
      status: w.status.toLowerCase(),
      requestedDate: w.createdAt,
      paidDate: (w as any).paidDate,
      trackingId: (w as any).trackingId,
      reference: w.reference,
    }));

    return {
      success: true,
      data: {
        withdrawals: formatted,
        pagination: this.buildListPagination(total, page, limit),
      },
    };
  }

  async getPayouts(page: number, limit: number, search?: string) {
    const { data } = await this.getAllWithdrawals(page, limit, 'paid', search);

    return {
      success: true,
      data: {
        payouts: data.withdrawals.map((w) => ({
          id: w.id,
          userId: w.userId,
          user: w.user,
          bankAccount: w.bankAccount,
          amount: w.amount,
          status: 'completed' as const,
          completedDate: w.paidDate ?? w.requestedDate,
        })),
        pagination: data.pagination,
      },
    };
  }

  async markWithdrawalAsPaid(withdrawalId: string, trackingId: string) {
    const withdrawal = await this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal request not found');
    }

    const tid = trackingId != null ? String(trackingId).trim() : '';
    if (!tid) {
      throw new BadRequestException('trackingId is required');
    }

    const statusNorm = withdrawal.status.trim().toLowerCase();
    if (statusNorm === 'paid') {
      throw new BadRequestException('Withdrawal is already marked as paid');
    }
    if (statusNorm === 'rejected') {
      throw new BadRequestException(
        'Cannot mark a rejected withdrawal as paid; the wallet was refunded.',
      );
    }
    if (statusNorm !== 'pending' && statusNorm !== 'approved') {
      throw new BadRequestException(
        `Withdrawal cannot be marked paid from status "${withdrawal.status}". Only PENDING or APPROVED are allowed.`,
      );
    }

    const paidAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      if (statusNorm === 'pending') {
        await tx.withdrawalRequest.update({
          where: { id: withdrawalId },
          data: {
            status: 'APPROVED',
            processedAt: paidAt,
          },
        });
      }
      return tx.withdrawalRequest.update({
        where: { id: withdrawalId },
        data: {
          status: 'paid',
          paidDate: paidAt,
          trackingId: tid,
          processedAt: paidAt,
        } as any,
        include: {
          user: { select: { name: true, email: true } },
        },
      });
    });

    return {
      success: true,
      data: {
        id: updated.id,
        status: updated.status.toLowerCase(),
        paidDate: (updated as any).paidDate,
        trackingId: (updated as any).trackingId,
      },
    };
  }

  async updateWithdrawalStatus(
    withdrawalId: string,
    status: 'APPROVED' | 'REJECTED',
    note?: string,
  ) {
    const withdrawal = await this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
    });
    if (!withdrawal)
      throw new NotFoundException('Withdrawal request not found');
    if (withdrawal.status !== 'PENDING')
      throw new BadRequestException(
        `Withdrawal is already ${withdrawal.status}`,
      );

    if (status === 'REJECTED') {
      // Refund wallet in a transaction
      await this.prisma.$transaction(async (tx) => {
        const wallet = await (tx as any).wallet.findUnique({
          where: { userId: withdrawal.userId },
        });
        if (wallet) {
          await (tx as any).wallet.update({
            where: { id: wallet.id },
            data: {
              mainBalance: { increment: withdrawal.amount },
              availableBalance: { increment: withdrawal.amount },
            },
          });

          await (tx as any).walletTransaction.create({
            data: {
              walletId: wallet.id,
              type: 'MAIN',
              amount: withdrawal.amount,
              status: 'SUCCESS',
              note: `Refund for rejected withdrawal request (Ref: ${withdrawal.reference})`,
            },
          });
        }

        await (tx as any).withdrawalRequest.update({
          where: { id: withdrawalId },
          data: {
            status: (status as string) === 'APPROVED' ? 'approved' : 'rejected',
            processedAt: new Date(),
          },
        });
      });
    } else {
      await this.prisma.withdrawalRequest.update({
        where: { id: withdrawalId },
        data: { status },
      });
    }

    // Trigger Notification
    await this.notificationService.createNotification({
      userId: withdrawal.userId,
      title: `Withdrawal ${status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
      message: `Your withdrawal request of NGN ${withdrawal.amount} (Ref: ${withdrawal.reference}) has been ${status.toLowerCase()}.`,
      type: 'WITHDRAWAL_STATUS',
      metadata: { withdrawalId: withdrawal.id, status },
      sendEmail: true,
      emailData: {
        email: (
          await this.prisma.user.findUnique({
            where: { id: withdrawal.userId },
          })
        )?.email,
        userName: (
          await this.prisma.user.findUnique({
            where: { id: withdrawal.userId },
          })
        )?.name,
        amount: withdrawal.amount,
        reference: withdrawal.reference,
        status: status,
      },
    });

    return {
      success: true,
      message: `Withdrawal ${status.toLowerCase()} successfully`,
      data: { status },
    };
  }

  /* PRODUCTS */

  async getProductStats() {
    const activeWhere: Prisma.ProductWhereInput = {
      isActive: true,
      productVerified: true,
      status: { in: ADMIN_ACTIVE_LISTING_STATUSES },
    };
    const rentedWhere: Prisma.ProductWhereInput = {
      isActive: true,
      productVerified: true,
      status: ProductStatus.RENTED,
    };
    const [total, pending, active, rented, rejected] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.product.count({ where: { status: 'PENDING' } }),
      this.prisma.product.count({ where: activeWhere }),
      this.prisma.product.count({ where: rentedWhere }),
      this.prisma.product.count({ where: { status: 'REJECTED' } }),
    ]);
    return {
      success: true,
      data: {
        getTotalProducts: { count: total },
        getPendingProducts: { count: pending },
        getApprovedProducts: { count: active },
        getRejectedProducts: { count: rejected },
        getActiveProducts: { count: active },
        getRentedProducts: { count: rented },
      },
    };
  }

  async getProductAvailability(productId: string, month: number, year: number) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, status: true },
    });

    if (!product) throw new NotFoundException('Product not found');

    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0, 23, 59, 59);

    // Find all orders that overlap with this month
    const orders = await this.prisma.order.findMany({
      where: {
        orderItems: { some: { productId } } as any,
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] },
        rentals: {
          some: {
            OR: [
              {
                // Starts or ends within the month
                startDate: { gte: firstDay, lte: lastDay },
              },
              {
                endDate: { gte: firstDay, lte: lastDay },
              },
              {
                // Spans across the entire month
                startDate: { lte: firstDay },
                endDate: { gte: lastDay },
              },
            ],
          },
        },
      },
      include: {
        rentals: true,
        user: { select: { id: true, name: true } },
      } as any,
    });

    const calendar: any[] = [];
    let daysRentedThisMonth = 0;
    let totalRentalRevenue = 0;

    // Generate daily calendar
    const numDays = lastDay.getDate();
    for (let i = 1; i <= numDays; i++) {
      const date = new Date(year, month - 1, i);
      const isoDate = date.toISOString().split('T')[0];

      // Find booking for this day
      const booking: any = orders.find((o: any) => {
        const rental = o.rentals?.[0];
        if (!rental) return false;
        const start = new Date(rental.startDate);
        const end = new Date(rental.endDate);
        // Normalize to date parts for comparison
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        const s = new Date(start);
        s.setHours(0, 0, 0, 0);
        const e = new Date(end);
        e.setHours(23, 59, 59, 999);
        return d >= s && d <= e;
      });

      if (booking && booking.rentals?.[0]) {
        const rental = booking.rentals[0];
        daysRentedThisMonth++;
        calendar.push({
          date: isoDate,
          status: 'rented',
          booking: {
            id: booking.id,
            dresserId: booking.userId,
            dresserName: booking.user.name,
            startDate: rental.startDate.toISOString().split('T')[0],
            endDate: rental.endDate.toISOString().split('T')[0],
            orderTotal: rental.totalAmount || 0,
          },
        });
      } else {
        calendar.push({
          date: isoDate,
          status: 'available',
          booking: null,
        });
      }
    }

    // Revenue for this months rentals (prorated or just simple sum if it starts this month?)
    // User requested "totalRentalRevenue" - typically means revenue from orders placed/active this month.
    totalRentalRevenue = orders.reduce(
      (sum, o: any) => sum + (o.rentals?.[0]?.totalAmount || 0),
      0,
    );

    // Current status
    const now = new Date();
    const currentRental: any = orders.find((o: any) => {
      const rental = o.rentals?.[0];
      return rental && now >= rental.startDate && now <= rental.endDate;
    });

    const nextAvailable = await this.prisma.rental.findFirst({
      where: {
        productId,
        startDate: { gt: now },
      },
      orderBy: { startDate: 'asc' },
    });

    return {
      success: true,
      data: {
        productId,
        month,
        year,
        nextAvailableDate:
          nextAvailable?.startDate.toISOString().split('T')[0] || null,
        currentlyRented: !!currentRental,
        currentRentalEndDate:
          currentRental?.rentals?.[0]?.endDate?.toISOString().split('T')[0] ||
          null,
        stats: {
          daysRentedThisMonth,
          totalRentalsThisMonth: orders.length,
          totalRentalRevenue,
        },
        calendar,
      },
    };
  }

  async getProductActivity(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        curator: { select: { id: true, name: true, email: true } },
      },
    });

    if (!product) throw new NotFoundException('Product not found');

    // Activities from AuditLog
    const auditLogs = await this.prisma.auditLog.findMany({
      where: {
        OR: [
          { targetType: 'PRODUCT', targetId: productId },
          {
            targetType: 'ORDER',
            details: { path: ['productId'], equals: productId } as any,
          },
        ],
      },
      include: { admin: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // Activities from Orders (Rented, Returned)
    const orders = await this.prisma.order.findMany({
      where: {
        orderItems: { some: { productId } },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const activities: any[] = [];

    // Add "Listed" activity
    activities.push({
      id: `initial_${product.id}`,
      type: 'listed',
      title: `Listed by ${product.curator.name}`,
      description: 'Product added to platform',
      timestamp: product.createdAt.toISOString(),
      actor: {
        id: product.curator.id,
        name: product.curator.name,
        email: product.curator.email,
      },
    });

    // Add Audit Log activities
    for (const log of auditLogs) {
      activities.push({
        id: log.id,
        type: log.action.toLowerCase(),
        title: log.action,
        description: log.targetName,
        timestamp: log.createdAt.toISOString(),
        actor: {
          id: log.admin.id,
          name: log.admin.name,
          email: log.admin.email,
        },
        metadata: log.details,
      });
    }

    // Add Order activities
    for (const order of orders) {
      activities.push({
        id: `rented_${order.id}`,
        type: 'rented',
        title: `Rented by ${order.user.name}`,
        description: `Rental order ${order.orderId} created`,
        timestamp: order.createdAt.toISOString(),
        actor: {
          id: order.user.id,
          name: order.user.name,
          email: order.user.email,
        },
        metadata: { orderId: order.id },
      });

      if (
        order.status === OrderStatus.COMPLETED ||
        order.status === OrderStatus.RETURNED
      ) {
        activities.push({
          id: `returned_${order.id}`,
          type: 'returned',
          title: 'Returned',
          description: `Item returned by renter for order ${order.orderId}`,
          timestamp: order.updatedAt.toISOString(),
          actor: null,
          metadata: { orderId: order.id },
        });
      }
    }

    // Sort all by timestamp descending
    activities.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    return {
      success: true,
      data: {
        productId,
        activities,
      },
    };
  }

  async getProductsByStatus(
    status: 'PENDING' | 'REJECTED' | 'APPROVED' | 'ACTIVE' | 'RENTED',
    page: number,
    limit: number,
    search?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.ProductWhereInput =
      status === 'ACTIVE'
        ? {
            isActive: true,
            productVerified: true,
            status: { in: ADMIN_ACTIVE_LISTING_STATUSES },
          }
        : status === 'RENTED'
          ? {
              isActive: true,
              productVerified: true,
              status: ProductStatus.RENTED,
            }
          : { status: status as any };
    const q = search?.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { curator: { name: { contains: q, mode: 'insensitive' } } },
        { curator: { email: { contains: q, mode: 'insensitive' } } },
        { brand: { name: { contains: q, mode: 'insensitive' } } },
        { category: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }
    const [total, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          brand: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          // Tags and full upload galleries are loaded via getProductDetails when the modal opens.
          curator: {
            select: {
              id: true,
              name: true,
              email: true,
              profile: {
                select: {
                  avatar: true,
                  avatarUpload: { select: { url: true } },
                },
              },
            },
          },
          attachments: {
            include: {
              uploads: {
                take: 1,
                orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
                select: { url: true },
              },
            },
          },
        },
      }),
    ]);
    return {
      success: true,
      data: {
        products,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getProductCategories() {
    return {
      success: true,
      data: await this.prisma.productCategory.findMany(),
    };
  }

  async getProductBrands() {
    return {
      success: true,
      data: await this.prisma.brand.findMany(),
    };
  }

  async getProductDetails(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        brand: true,
        category: true,
        tags: true,
        curator: true,
        attachments: {
          include: {
            uploads: { orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY },
          },
        },
      },
    });

    if (!product) throw new NotFoundException('Product not found');
    return { success: true, data: product };
  }

  async revertProductToPending(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const revertableStatuses: ProductStatus[] = [
      ProductStatus.APPROVED,
      ProductStatus.AVAILABLE,
      ProductStatus.UNAVAILABLE,
    ];

    if (product.status === ProductStatus.PENDING) {
      throw new BadRequestException('Product is already pending');
    }

    if (!revertableStatuses.includes(product.status)) {
      throw new BadRequestException(
        `Cannot revert to pending from status "${product.status}"`,
      );
    }

    const activeRental = await this.prisma.rental.findFirst({
      where: {
        productId,
        isReturned: false,
        endDate: { gt: new Date() },
      },
      select: { id: true },
    });
    if (activeRental) {
      throw new BadRequestException(
        'Cannot revert to pending while the product is out on rental',
      );
    }

    const activeOrder = await this.prisma.orderItem.findFirst({
      where: {
        productId,
        order: {
          status: {
            in: [
              OrderStatus.CONFIRMED,
              OrderStatus.IN_TRANSIT,
              OrderStatus.DELIVERED,
              OrderStatus.ACTIVE,
            ],
          },
        },
      },
      select: { id: true },
    });
    if (activeOrder) {
      throw new BadRequestException(
        'Cannot revert to pending while the product has an active order',
      );
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        status: ProductStatus.PENDING,
        productVerified: false,
        isActive: false,
        rejectionComment: null,
      },
    });

    return {
      success: true,
      message: 'Product reverted to pending',
      data: updated,
    };
  }

  async updateProductStatus(
    productId: string,
    status: 'APPROVED' | 'REJECTED',
    reason?: string,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        curator: { select: { name: true, email: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        status:
          status === 'APPROVED'
            ? ProductStatus.AVAILABLE
            : (status as ProductStatus),
        ...(reason ? { rejectionComment: reason } : {}),
        ...(status === 'APPROVED'
          ? { productVerified: true, isActive: true, rejectionComment: null }
          : {}),
      },
    });

    if (product.curator?.email) {
      const origin = (
        process.env.CLIENT_URL ||
        process.env.FRONTEND_URL ||
        'http://localhost:3000'
      ).replace(/\/$/, '');

      try {
        if (status === 'REJECTED') {
          await this.mailService.sendListingRejectedEmail({
            email: product.curator.email,
            userName: product.curator.name,
            productName: product.name,
            rejectionReason: reason || 'No reason provided.',
            editUrl: `${origin}/listers/inventory/product-edit/${productId}`,
          });
        } else if (status === 'APPROVED') {
          await this.mailService.sendListingApprovedEmail({
            email: product.curator.email,
            userName: product.curator.name,
            productName: product.name,
            listingUrl: `${origin}/shop/product-details/${productId}`,
          });
        }
      } catch {
        // Status update should succeed even if email delivery fails.
      }
    }

    return {
      success: true,
      message: `Product ${status.toLowerCase()} successfully`,
      data: updated,
    };
  }

  async deleteProduct(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    await this.prisma.$transaction(async (tx) => {
      await deleteProductCascade(tx, productId);
    });

    return {
      success: true,
      message: 'Product deleted successfully',
    };
  }

  /* USERS */
  async getAllUsers() {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isSuspended: true,
        profile: {
          select: {
            createdAt: true,
            avatar: true,
            avatarUpload: { select: { url: true } },
          },
        },
      },
    });
    return { success: true, data: { users, total: users.length } };
  }
  async getUserDetails(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: {
          include: {
            emergencyContact: true,
            businessInfo: true,
            address: true,
            avatarUpload: true,
            ninUpload: true,
            idDocumentUpload: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return { success: true, data: user };
  }
  async getUserRentals(userId: string) {
    const rentals = await this.prisma.rental.findMany({
      where: {
        OR: [
          { userId }, // Items the user rented
          { curatorId: userId }, // Items the user listed being rented
        ],
      },
      include: {
        product: true,
        user: true, // Rentee
        curator: true, // Lister
        order: true,
      },
    });
    return { success: true, data: rentals };
  }
  async getUserListings(userId: string) {
    const listings = await this.prisma.product.findMany({
      where: { curatorId: userId },
    });
    return { success: true, data: listings };
  }
  async getUserWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    return { success: true, data: wallet };
  }
  async getUserTransactions(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return { success: true, data: [] };
    const transactions = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
    });
    return { success: true, data: transactions };
  }
  async getUserDisputes(userId: string) {
    const disputes = await this.prisma.dispute.findMany({ where: { userId } });
    return { success: true, data: disputes };
  }
  async getUserFavorites(userId: string) {
    const favorites = await this.prisma.favourite.findMany({
      where: { userId },
      include: { product: true },
    });
    return { success: true, data: favorites };
  }

  /* ORDERS */
  private async fetchOrderListStats() {
    const [
      totalListings,
      completedOrders,
      activeOrders,
      disputedOrders,
      totalRevenue,
    ] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),
      this.prisma.order.count({
        where: {
          status: {
            in: [
              OrderStatus.CONFIRMED,
              OrderStatus.IN_TRANSIT,
              OrderStatus.DELIVERED,
              OrderStatus.ACTIVE,
            ],
          },
        },
      }),
      this.prisma.dispute.count(),
      this.sumTotalOrderRevenue('all_time'),
    ]);

    return {
      totalListings,
      completedOrders,
      activeOrders,
      disputedOrders,
      totalRevenue,
    };
  }

  async getOrderStats() {
    const data = await this.fetchOrderListStats();
    return { success: true, data: { ...data, timeframe: 'all_time' } };
  }
  async getAllOrders(
    page: number,
    limit: number,
    status?: string,
    tab?: string,
    search?: string,
    dateFrom?: string,
    dateTo?: string,
    type?: string,
    manualFulfillment?: boolean,
  ) {
    const pageSafe = Math.max(1, page);
    const limitSafe = Math.min(Math.max(1, limit), 100);
    const skip = (pageSafe - 1) * limitSafe;

    const where: Prisma.OrderWhereInput = {};

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(`${dateFrom}T00:00:00.000Z`);
      }
      if (dateTo) {
        where.createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
      }
    }

    const shipmentSome: Prisma.ShipmentWhereInput = {};
    const typeNorm = type?.trim().toUpperCase();
    if (
      typeNorm &&
      Object.values(ShipmentType).includes(typeNorm as ShipmentType)
    ) {
      shipmentSome.type = typeNorm as ShipmentType;
    }
    if (manualFulfillment === true) {
      shipmentSome.manualFulfillment = true;
    } else if (manualFulfillment === false) {
      shipmentSome.manualFulfillment = false;
    }
    if (Object.keys(shipmentSome).length > 0) {
      where.shipments = { some: shipmentSome };
    }

    if (status && status !== 'ALL') {
      where.status = status as OrderStatus;
    } else if (tab) {
      const tabNorm = tab.trim().toLowerCase();
      if (tabNorm === 'completed') {
        where.status = OrderStatus.COMPLETED;
      } else if (tabNorm === 'rejected') {
        where.status = { in: [OrderStatus.CANCELLED, OrderStatus.REJECTED] };
      } else if (tabNorm === 'active') {
        where.status = {
          notIn: [
            OrderStatus.COMPLETED,
            OrderStatus.CANCELLED,
            OrderStatus.REJECTED,
          ],
        };
      }
    }

    const q = search?.trim();
    if (q) {
      where.OR = [
        { orderId: { contains: q, mode: 'insensitive' } },
        { user: { name: { contains: q, mode: 'insensitive' } } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
        {
          orderItems: {
            some: {
              product: {
                curator: {
                  name: { contains: q, mode: 'insensitive' },
                },
              },
            },
          },
        },
      ];
    }

    const [total, orders, listStats] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        skip,
        take: limitSafe,
        orderBy: { createdAt: 'desc' },
        include: {
          orderItems: {
            include: {
              product: {
                include: {
                  curator: {
                    include: { profile: { include: { avatarUpload: true } } },
                  },
                },
              },
            },
          },
          rentals: {
            include: {
              curator: {
                include: { profile: { include: { avatarUpload: true } } },
              },
            },
          } as any,
          user: { include: { profile: { include: { avatarUpload: true } } } },
          payments: { take: 1, orderBy: { createdAt: 'desc' } },
        },
      }),
      this.fetchOrderListStats(),
    ]);

    const formattedOrders = orders.map((o: any) => {
      const rental = o.rentals?.[0];
      const paid =
        o.totalAmountPaid != null ? Number(o.totalAmountPaid) : Number.NaN;
      const rentalLineTotal = o.orderItems.reduce(
        (sum: number, item: any) => sum + item.pricePerDay * item.days,
        0,
      );
      const resaleLineTotal = o.orderItems.reduce(
        (sum: number, item: any) => sum + (item.resaleListerAmount ?? 0),
        0,
      );
      const totalAmount =
        Number.isFinite(paid) && paid > 0
          ? paid
          : rental?.totalAmount ||
            rentalLineTotal + resaleLineTotal ||
            0;

      // Determine curator (from rental or first order item)
      const curatorUser = rental?.curator || o.orderItems[0]?.product?.curator;

      // Determine if payment reference exists
      const paymentRef = o.payments?.[0]?.referenceId || null;

      // Map status enum to human readable if needed
      let displayStatus = o.status;
      if (displayStatus === 'IN_TRANSIT') displayStatus = 'In Transit';
      else if (displayStatus === 'COMPLETED') displayStatus = 'Completed';
      else if (displayStatus === 'RETURN_DUE') displayStatus = 'Return Due';
      else if (displayStatus === 'PROCESSING') displayStatus = 'Processing';

      return {
        id: o.orderId,
        date: o.createdAt.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        lister: curatorUser
          ? {
              id: curatorUser.id,
              name: curatorUser.name,
              avatar: curatorUser.profile?.avatarUpload?.url || null,
            }
          : null,
        renter: o.user
          ? {
              id: o.user.id,
              name: o.user.name,
              avatar: o.user.profile?.avatarUpload?.url || null,
            }
          : null,
        items: o.orderItems.length,
        total: totalAmount,
        status: displayStatus,
        returnDue: o.returnDueAt
          ? o.returnDueAt.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })
          : null,
        paymentReference: paymentRef,
      };
    });

    return {
      success: true,
      data: {
        orders: formattedOrders,
        pagination: {
          total,
          page: pageSafe,
          limit: limitSafe,
          pages: Math.max(1, Math.ceil(total / limitSafe)),
        },
        stats: listStats,
      },
    };
  }
  async exportOrders() {
    return { success: true, data: { message: 'Export initiated' } };
  }
  private formatAdminOrderDetail(order: any) {
    const formatDate = (d: Date | string | null | undefined) => {
      if (!d) return null;
      const dt = d instanceof Date ? d : new Date(d);
      return dt.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    };

    const rentalByProduct = new Map<string, any>(
      (order.rentals ?? []).map((r: any) => [r.productId, r]),
    );

    const lineSubtotal = order.orderItems.reduce((sum: number, oi: any) => {
      const isResaleLine =
        oi.days === 0 &&
        (oi.product?.listingType === 'RESALE' ||
          oi.product?.listingType === 'RENT_OR_RESALE');
      if (isResaleLine) {
        return sum + (oi.resaleListerAmount ?? oi.product?.resalePrice ?? 0);
      }
      return (
        sum +
        (oi.rentalFee ?? (oi.pricePerDay ?? 0) * (oi.days ?? 0)) +
        (oi.cleaningFee ?? 0)
      );
    }, 0);

    const serviceFee = order.serviceFee ?? 0;
    const deliveryFee = order.deliveryFee ?? 0;
    const vatAmount = order.vatAmount ?? 0;
    const total =
      order.totalAmountPaid != null && order.totalAmountPaid > 0
        ? order.totalAmountPaid
        : lineSubtotal + serviceFee + deliveryFee + vatAmount;

    const listerUsers: any[] = [];
    const listerIdsSeen = new Set<string>();
    for (const ol of order.orderListers ?? []) {
      if (ol.lister && !listerIdsSeen.has(ol.lister.id)) {
        listerIdsSeen.add(ol.lister.id);
        listerUsers.push(ol.lister);
      }
    }
    if (listerUsers.length === 0) {
      for (const oi of order.orderItems ?? []) {
        const c = oi.product?.curator;
        if (c && !listerIdsSeen.has(c.id)) {
          listerIdsSeen.add(c.id);
          listerUsers.push(c);
        }
      }
    }
    if (listerUsers.length === 0) {
      for (const r of order.rentals ?? []) {
        if (r.curator && !listerIdsSeen.has(r.curator.id)) {
          listerIdsSeen.add(r.curator.id);
          listerUsers.push(r.curator);
        }
      }
    }

    const mapUser = (u: any) =>
      u
        ? {
            id: u.id,
            name: u.name,
            email: u.email,
            phone: u.profile?.phoneNumber ?? null,
            avatar: u.profile?.avatarUpload?.url ?? null,
          }
        : null;

    const primaryLister = listerUsers[0] ?? null;
    const renter = order.user;

    const paymentRef =
      order.payments?.[0]?.referenceId ??
      order.payments?.[0]?.paymentReference ??
      null;

    const primaryRental = order.rentals?.[0];
    const rentalPeriod =
      primaryRental?.startDate && primaryRental?.endDate
        ? `${formatDate(primaryRental.startDate)} – ${formatDate(primaryRental.endDate)}`
        : null;

    const escrowRows = (order.escrows ?? []).map((e: any) => ({
      id: e.id,
      status: e.status,
      lockedAmount: this.getEscrowLockedAmount(e),
      rentalAmount: e.rentalAmount,
      resaleAmount: e.resaleAmount,
      collateralAmount: e.collateralAmount,
      cleaningFee: e.cleaningFee,
      listerId: e.listerId,
    }));

    return {
      id: order.orderId,
      internalId: order.id,
      date: formatDate(order.createdAt),
      createdAt: order.createdAt.toISOString(),
      listingType: order.listingType,
      status: order.status,
      items: order.orderItems.length,
      total,
      returnDue: formatDate(order.returnDueAt),
      paymentReference: paymentRef,
      trackingNumber: order.trackingNumber ?? order.trackingId ?? null,
      externalTrackingUrl: order.externalTrackingUrl ?? null,
      lister: mapUser(primaryLister),
      listers: listerUsers.map(mapUser).filter(Boolean),
      renter: mapUser(renter),
      items_details: order.orderItems.map((oi: any) => {
        const rental = rentalByProduct.get(oi.productId);
        const isResaleLine =
          oi.days === 0 &&
          (oi.product?.listingType === 'RESALE' ||
            oi.product?.listingType === 'RENT_OR_RESALE');
        const subtotal = isResaleLine
          ? (oi.resaleListerAmount ?? oi.product?.resalePrice ?? 0)
          : (oi.rentalFee ??
              (oi.pricePerDay ?? oi.product?.dailyPrice ?? 0) * (oi.days ?? 0)) +
            (oi.cleaningFee ?? 0);
        return {
          id: oi.id,
          productId: oi.productId,
          name: oi.product?.name ?? 'Item',
          image: oi.product?.attachments?.uploads?.[0]?.url ?? null,
          brand: oi.product?.brand?.name ?? null,
          dailyPrice: oi.pricePerDay ?? oi.product?.dailyPrice ?? 0,
          rentalDays: oi.days,
          cleaningFee: oi.cleaningFee ?? 0,
          collateralFee: oi.collateralFee ?? 0,
          listingType: oi.product?.listingType ?? null,
          subtotal,
          rentalStart: rental?.startDate
            ? formatDate(rental.startDate)
            : null,
          rentalEnd: rental?.endDate ? formatDate(rental.endDate) : null,
        };
      }),
      shipping: {
        rentalPeriod: rentalPeriod ?? 'N/A',
        trackingId: order.trackingId ?? order.trackingNumber ?? 'N/A',
        courier: order.shipments?.[0]?.pickupPartner ?? 'N/A',
        pickupDate: order.dispatchedAt
          ? formatDate(order.dispatchedAt)
          : order.shipments?.[0]?.scheduledDate
            ? formatDate(order.shipments[0].scheduledDate)
            : 'N/A',
        expectedDelivery: order.estimatedDeliveryDate
          ? formatDate(order.estimatedDeliveryDate)
          : order.deliveredAt
            ? formatDate(order.deliveredAt)
            : 'N/A',
      },
      payment: {
        subtotal: lineSubtotal,
        serviceFee,
        deliveryFee,
        vat: vatAmount,
        total,
        paymentStatus:
          order.payments?.[0]?.status === 'SUCCESS'
            ? 'Paid'
            : order.totalAmountPaid
              ? 'Paid via wallet'
              : 'Pending',
      },
      escrows: escrowRows,
      returnRequest: formatAdminReturnRequest(order.returnRequests?.[0]),
    };
  }

  async getOrderDetails(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderId },
      include: {
        orderItems: {
          include: {
            product: {
              include: {
                brand: true,
                curator: {
                  include: {
                    profile: { include: { avatarUpload: true } },
                  },
                },
                attachments: {
                  include: {
                    uploads: {
                      orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
        user: {
          include: { profile: { include: { avatarUpload: true } } },
        },
        orderListers: {
          include: {
            lister: {
              include: { profile: { include: { avatarUpload: true } } },
            },
          },
        },
        rentals: {
          include: {
            curator: {
              include: { profile: { include: { avatarUpload: true } } },
            },
          },
        },
        payments: { take: 1, orderBy: { createdAt: 'desc' } },
        escrows: true,
        shipments: { orderBy: { scheduledDate: 'asc' } },
        returnRequests: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return {
      success: true,
      data: this.formatAdminOrderDetail(order),
    };
  }
  async updateOrderStatus(
    orderId: string,
    data: { status: string; note: string },
  ) {
    const order = await this.prisma.order.update({
      where: { orderId },
      data: { status: data.status as any },
    });
    return { success: true, data: order };
  }
  async cancelOrder(orderId: string, data: { reason: string }) {
    const order = await this.prisma.order.update({
      where: { orderId },
      data: { status: 'CANCELLED' as any },
    });
    return { success: true, data: order };
  }
  async getOrderActivity(orderId: string) {
    return { success: true, data: [] };
  }

  async getReturnRequests(
    page: number = 1,
    limit: number = 20,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: Prisma.ReturnRequestWhereInput = {};

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(`${dateFrom}T00:00:00.000Z`);
      }
      if (dateTo) {
        where.createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
      }
    }

    const [total, returns] = await this.prisma.$transaction([
      this.prisma.returnRequest.count({ where }),
      this.prisma.returnRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: {
            include: {
              user: { include: { profile: true } },
              orderItems: {
                include: {
                  product: {
                    include: { curator: { include: { profile: true } } },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const formattedReturns = returns.map((r) => {
      const order = r.order as any;
      const lister = order.orderItems[0]?.product?.curator;
      return {
        id: r.id,
        orderId: order.orderId,
        status: r.status,
        itemCondition: r.itemCondition,
        damageNotes: r.damageNotes,
        imageUrls: r.imageUrls,
        createdAt: r.createdAt,
        renter: {
          id: order.user?.id,
          name: order.user?.name,
          avatar: order.user?.profile?.avatarUpload?.url || null,
        },
        lister: lister
          ? {
              id: lister.id,
              name: lister.name,
              avatar: lister.profile?.avatarUpload?.url || null,
            }
          : null,
        itemName: order.orderItems[0]?.product?.name || 'Multiple items',
      };
    });

    return {
      success: true,
      data: {
        returns: formattedReturns,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
      },
    };
  }

  async listClosetsForAdmin(page: number, limit: number, search?: string) {
    const limitSafe = Math.min(Math.max(1, limit), 100);
    const pageSafe = Math.max(1, page);
    const skip = (pageSafe - 1) * limitSafe;
    const q = search?.trim();
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { slug: { contains: q, mode: 'insensitive' as const } },
            { owner: { email: { contains: q, mode: 'insensitive' as const } } },
            { owner: { name: { contains: q, mode: 'insensitive' as const } } },
          ],
        }
      : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.closet.count({ where }),
      this.prisma.closet.findMany({
        where,
        skip,
        take: limitSafe,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        include: {
          owner: { select: { id: true, name: true, email: true } },
          _count: { select: { products: true } },
        },
      }),
    ]);

    const closets = rows.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      imageUrl: c.imageUrl,
      isActive: c.isActive,
      sortOrder: c.sortOrder,
      closetWalletBalance: c.closetWalletBalance,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      owner: c.owner,
      productCount: c._count.products,
    }));

    return {
      success: true,
      data: {
        closets,
        total,
        page: pageSafe,
        totalPages: Math.ceil(total / limitSafe) || 1,
      },
    };
  }

  async getClosetDetailForAdmin(closetId: string) {
    const closet = await this.prisma.closet.findUnique({
      where: { id: closetId },
      include: {
        owner: {
          select: { id: true, name: true, email: true, role: true },
        },
        products: {
          orderBy: { updatedAt: 'desc' },
          take: 500,
          select: {
            id: true,
            name: true,
            status: true,
            listingType: true,
            isActive: true,
            dailyPrice: true,
            resalePrice: true,
            productVerified: true,
            attachments: {
              select: {
                uploads: {
                  orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
                  take: 1,
                  select: { url: true },
                },
              },
            },
          },
        },
      },
    });

    if (!closet) {
      throw new NotFoundException('Closet not found');
    }

    const products = closet.products.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      listingType: p.listingType,
      isActive: p.isActive,
      dailyPrice: p.dailyPrice,
      resalePrice: p.resalePrice,
      productVerified: p.productVerified,
      imageUrl: p.attachments?.uploads?.[0]?.url ?? null,
    }));

    return {
      success: true,
      data: {
        id: closet.id,
        name: closet.name,
        slug: closet.slug,
        description: closet.description,
        imageUrl: closet.imageUrl,
        isActive: closet.isActive,
        sortOrder: closet.sortOrder,
        closetWalletBalance: closet.closetWalletBalance,
        createdAt: closet.createdAt,
        updatedAt: closet.updatedAt,
        owner: closet.owner,
        products,
      },
    };
  }

  /** Same query string as the public shop link for Vault Closet Drops (closets). */
  private buildVaultClosetDropsShopPath(): string {
    const title = 'Vault Closet Drops';
    const description =
      'Celebrity wardrobes. Limited drops. Shop it before it disappears.';
    return (
      `/shop?title=${encodeURIComponent(title)}` +
      `&description=${encodeURIComponent(description)}` +
      '&onlyWithCloset=true'
    );
  }

  async listVaultClosetSaleWaitlistForAdmin(page = 1, limit = 20) {
    const pageSafe = Math.max(1, page);
    const limitSafe = Math.min(100, Math.max(1, limit));
    const skip = (pageSafe - 1) * limitSafe;

    const [total, entries] = await this.prisma.$transaction([
      this.prisma.vaultClosetSaleInterest.count(),
      this.prisma.vaultClosetSaleInterest.findMany({
        skip,
        take: limitSafe,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          userId: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      success: true as const,
      data: {
        total,
        entries,
        pagination: {
          total,
          page: pageSafe,
          limit: limitSafe,
          pages: Math.max(1, Math.ceil(total / limitSafe)),
        },
      },
    };
  }

  async notifyVaultClosetSaleWaitlistForAdmin() {
    const rows = await this.prisma.vaultClosetSaleInterest.findMany({
      select: { email: true },
    });

    if (rows.length === 0) {
      return {
        success: true as const,
        data: {
          totalRecipients: 0,
          sent: 0,
          failed: [] as { email: string; error: string }[],
          message: 'No one is on the waitlist yet.',
        },
      };
    }

    const base = (
      process.env.CLIENT_URL ||
      process.env.FRONTEND_URL ||
      ''
    ).replace(/\/$/, '');

    if (!base) {
      throw new BadRequestException(
        'Set CLIENT_URL or FRONTEND_URL so notification emails can include a link to the shop.',
      );
    }

    const shopUrl = `${base}${this.buildVaultClosetDropsShopPath()}`;
    const { sent, failed } =
      await this.mailService.SendVaultClosetSaleLiveMailBatch(
        rows.map((r) => r.email),
        shopUrl,
      );

    return {
      success: true as const,
      data: {
        totalRecipients: rows.length,
        sent,
        failed,
        shopUrl,
        devEmailBypass: process.env.DEV_EMAIL_BYPASS === 'true',
      },
    };
  }

  private availabilityRequestPersonSelect() {
    return {
      id: true,
      name: true,
      email: true,
      profile: {
        select: {
          avatar: true,
          phoneNumber: true,
          avatarUpload: { select: { url: true } },
        },
      },
    };
  }

  private availabilityRequestProductInclude() {
    return {
      brand: { select: { id: true, name: true } },
      attachments: {
        include: {
          uploads: {
            take: 1,
            orderBy: PRODUCT_ATTACHMENT_UPLOADS_ORDER_BY,
            select: { url: true, displayOrder: true },
          },
        },
      },
    };
  }

  private mapAvailabilityRequestPerson(user: {
    id: string;
    name: string | null;
    email: string | null;
    profile?: {
      avatar?: string | null;
      phoneNumber?: string | null;
      avatarUpload?: { url?: string | null } | null;
    } | null;
  } | null) {
    if (!user) return null;
    return {
      id: user.id,
      name: user.name || 'Unknown',
      email: user.email,
      phone: user.profile?.phoneNumber ?? null,
      avatar:
        user.profile?.avatarUpload?.url ?? user.profile?.avatar ?? null,
    };
  }

  private mapAvailabilityRequestRow(request: any) {
    const rentalDays = request.rentalDays ?? 0;
    const isPurchase = rentalDays === 0;
    const windowMap = extractRangeMapFromEntity(
      request,
      availabilityRequestWindowFieldMap,
    );

    return {
      id: request.id,
      status: request.status,
      requestType: isPurchase ? 'purchase' : 'rental',
      rentalDays,
      totalPrice: request.totalPrice ?? 0,
      startDate: request.startDate,
      endDate: request.endDate,
      expiresAt: request.expiresAt,
      createdAt: request.createdAt,
      autoPay: request.autoPay ?? false,
      rejectionReason: request.rejectionReason ?? null,
      cartItemId: request.cartItemId,
      productId: request.productId,
      product: request.product
        ? {
            id: request.product.id,
            name: request.product.name,
            listingType: request.product.listingType,
            brand: request.product.brand?.name ?? null,
            image: request.product.attachments?.uploads?.[0]?.url ?? null,
            dailyPrice: request.product.dailyPrice ?? null,
            resalePrice: request.product.resalePrice ?? null,
          }
        : null,
      requester: this.mapAvailabilityRequestPerson(request.requester),
      lister: this.mapAvailabilityRequestPerson(request.lister),
      windows: {
        outbound: windowMap.OUTBOUND
          ? {
              start: windowMap.OUTBOUND.start.toISOString(),
              end: windowMap.OUTBOUND.end.toISOString(),
            }
          : null,
        return: windowMap.RETURN
          ? {
              start: windowMap.RETURN.start.toISOString(),
              end: windowMap.RETURN.end.toISOString(),
            }
          : null,
        resale: windowMap.RESALE
          ? {
              start: windowMap.RESALE.start.toISOString(),
              end: windowMap.RESALE.end.toISOString(),
            }
          : null,
      },
      canNudgeRenter: request.status === AvailabilityStatus.EXPIRED,
      canResendToLister: (
        [
          AvailabilityStatus.PENDING,
          AvailabilityStatus.EXPIRED,
          AvailabilityStatus.REJECTED,
          AvailabilityStatus.CANCELLED_BY_RENTER,
        ] as AvailabilityStatus[]
      ).includes(request.status),
    };
  }

  async getAvailabilityRequestStats() {
    const [
      total,
      pending,
      accepted,
      expired,
      rejected,
      cancelled,
      purchase,
      rental,
    ] = await Promise.all([
      this.prisma.availabilityRequest.count(),
      this.prisma.availabilityRequest.count({
        where: { status: AvailabilityStatus.PENDING },
      }),
      this.prisma.availabilityRequest.count({
        where: { status: AvailabilityStatus.ACCEPTED },
      }),
      this.prisma.availabilityRequest.count({
        where: { status: AvailabilityStatus.EXPIRED },
      }),
      this.prisma.availabilityRequest.count({
        where: { status: AvailabilityStatus.REJECTED },
      }),
      this.prisma.availabilityRequest.count({
        where: { status: AvailabilityStatus.CANCELLED_BY_RENTER },
      }),
      this.prisma.availabilityRequest.count({
        where: { OR: [{ rentalDays: 0 }, { rentalDays: null }] },
      }),
      this.prisma.availabilityRequest.count({
        where: { rentalDays: { gt: 0 } },
      }),
    ]);

    return {
      success: true,
      data: {
        total,
        pending,
        accepted,
        expired,
        rejected,
        cancelled,
        purchase,
        rental,
        needingAttention: pending + expired,
      },
    };
  }

  async getAllAvailabilityRequests(
    page: number,
    limit: number,
    status?: string,
    type?: string,
    search?: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const pageSafe = Math.max(1, page);
    const limitSafe = Math.min(Math.max(1, limit), 100);
    const skip = (pageSafe - 1) * limitSafe;

    const where: Prisma.AvailabilityRequestWhereInput = {};

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(`${dateFrom}T00:00:00.000Z`);
      }
      if (dateTo) {
        where.createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
      }
    }

    const statusNorm = status?.trim().toUpperCase();
    if (
      statusNorm &&
      statusNorm !== 'ALL' &&
      Object.values(AvailabilityStatus).includes(
        statusNorm as AvailabilityStatus,
      )
    ) {
      where.status = statusNorm as AvailabilityStatus;
    }

    const typeNorm = type?.trim().toLowerCase();
    if (typeNorm === 'purchase') {
      where.OR = [{ rentalDays: 0 }, { rentalDays: null }];
    } else if (typeNorm === 'rental') {
      where.rentalDays = { gt: 0 };
    }

    const q = search?.trim();
    if (q) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { id: { contains: q, mode: 'insensitive' } },
            { product: { name: { contains: q, mode: 'insensitive' } } },
            { requester: { name: { contains: q, mode: 'insensitive' } } },
            { requester: { email: { contains: q, mode: 'insensitive' } } },
            { lister: { name: { contains: q, mode: 'insensitive' } } },
            { lister: { email: { contains: q, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.availabilityRequest.count({ where }),
      this.prisma.availabilityRequest.findMany({
        where,
        skip,
        take: limitSafe,
        orderBy: { createdAt: 'desc' },
        include: {
          product: { include: this.availabilityRequestProductInclude() },
          requester: { select: this.availabilityRequestPersonSelect() },
          lister: { select: this.availabilityRequestPersonSelect() },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        requests: rows.map((r) => this.mapAvailabilityRequestRow(r)),
        pagination: this.buildListPagination(total, pageSafe, limitSafe),
      },
    };
  }

  async getAvailabilityRequestDetails(requestId: string) {
    const request = await this.prisma.availabilityRequest.findUnique({
      where: { id: requestId },
      include: {
        product: {
          include: {
            ...this.availabilityRequestProductInclude(),
            curator: { select: this.availabilityRequestPersonSelect() },
          },
        },
        requester: { select: this.availabilityRequestPersonSelect() },
        lister: { select: this.availabilityRequestPersonSelect() },
      },
    });

    if (!request) {
      throw new NotFoundException('Availability request not found');
    }

    return {
      success: true,
      data: this.mapAvailabilityRequestRow(request),
    };
  }

  async adminNudgeRenterForAvailabilityRequest(
    requestId: string,
    intent: 'rerequest' | 'now_available',
  ) {
    if (intent !== 'rerequest' && intent !== 'now_available') {
      throw new BadRequestException(
        'intent must be "rerequest" or "now_available"',
      );
    }

    const request = await this.prisma.availabilityRequest.findUnique({
      where: { id: requestId },
      include: {
        product: true,
        requester: true,
        lister: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }
    if (request.status !== AvailabilityStatus.EXPIRED) {
      throw new BadRequestException(
        'Reminders can only be sent for expired availability requests.',
      );
    }

    const productName = request.product?.name ?? 'this item';
    const isPurchaseRequest = (request.rentalDays ?? 0) === 0;
    const listerName = request.lister?.name || 'The curator';
    const renterEmail = request.requester?.email?.trim() || '';
    const cartBase = (
      process.env.CLIENT_URL ||
      process.env.FRONTEND_URL ||
      'http://localhost:3000'
    ).replace(/\/$/, '');

    const emailData = {
      email: renterEmail,
      userName: request.requester?.name || 'there',
      listerName,
      productName,
      intent,
      requestType: isPurchaseRequest ? 'purchase' : 'rental',
      cartLink: `${cartBase}/shop/cart`,
    };

    const title =
      intent === 'rerequest'
        ? isPurchaseRequest
          ? 'Send a new purchase request'
          : 'Send a new rental request'
        : isPurchaseRequest
          ? 'A lister is ready for your purchase request'
          : 'A lister is ready for your rental request';

    const message =
      intent === 'rerequest'
        ? `The curator could not respond in time earlier. If you still want ${productName}, open your cart and tap Request approval again.`
        : `${listerName} is ready when you are. If you still want ${productName}, open your cart and send a new availability request.`;

    await this.notificationService.createNotification({
      userId: request.requesterId,
      title,
      message,
      type: 'AVAILABILITY_REQUEST_REMINDER',
      metadata: {
        requestId: request.id,
        productId: request.productId,
        intent,
        triggeredBy: 'admin',
      },
      sendEmail: Boolean(renterEmail),
      emailData,
    });

    return {
      success: true,
      message:
        intent === 'now_available'
          ? 'Renter notified that the lister is available'
          : 'Renter asked to send a new request',
      data: { requestId: request.id, intent },
    };
  }

  async adminResendAvailabilityRequestToLister(requestId: string) {
    const request = await this.prisma.availabilityRequest.findUnique({
      where: { id: requestId },
      include: {
        product: {
          include: {
            curator: { select: { id: true, name: true, email: true } },
          },
        },
        requester: true,
        lister: true,
      },
    });

    if (!request) {
      throw new NotFoundException('Request not found');
    }

    const resendable: AvailabilityStatus[] = [
      AvailabilityStatus.PENDING,
      AvailabilityStatus.EXPIRED,
      AvailabilityStatus.REJECTED,
      AvailabilityStatus.CANCELLED_BY_RENTER,
    ];
    if (!resendable.includes(request.status)) {
      throw new BadRequestException(
        'Only pending, expired, rejected, or withdrawn requests can be resent to the lister.',
      );
    }

    let active = request;
    let reactivated = false;

    if (request.status !== AvailabilityStatus.PENDING) {
      const expiresAt = addMinutes(new Date(), 15);
      active = await this.prisma.availabilityRequest.update({
        where: { id: request.id },
        data: {
          status: AvailabilityStatus.PENDING,
          expiresAt,
          rejectionReason: null,
        },
        include: {
          product: {
            include: {
              curator: { select: { id: true, name: true, email: true } },
            },
          },
          requester: true,
          lister: true,
        },
      });
      reactivated = true;
    }

    const isPurchase =
      (active.rentalDays ?? 0) === 0 ||
      active.product?.listingType === 'RESALE' ||
      (active.product?.listingType === 'RENT_OR_RESALE' &&
        (active.rentalDays ?? 0) === 0);

    const windowMap = extractRangeMapFromEntity(
      active,
      availabilityRequestWindowFieldMap,
    );
    const renterName = active.requester?.name || 'A user';
    const productName = active.product?.name ?? 'an item';
    const listerEmail =
      active.product?.curator?.email?.trim() ||
      active.lister?.email?.trim() ||
      '';
    const listerName =
      active.product?.curator?.name || active.lister?.name || 'there';
    const clientBase = (
      process.env.CLIENT_URL ||
      process.env.FRONTEND_URL ||
      'http://localhost:3000'
    ).replace(/\/$/, '');

    await this.notificationService.createNotification({
      userId: active.listerId,
      title: reactivated
        ? isPurchase
          ? 'Purchase Request Reactivated'
          : 'Rental Request Reactivated'
        : isPurchase
          ? 'Purchase Request Reminder'
          : 'Rental Request Reminder',
      message: reactivated
        ? `A ${isPurchase ? 'purchase' : 'rental'} request for ${productName} was resent on behalf of ${renterName}.`
        : `Reminder: you still have a ${isPurchase ? 'purchase' : 'rental'} request for ${productName} from ${renterName}.`,
      type: isPurchase ? 'PURCHASE_REQUEST' : 'RENTAL_REQUEST',
      metadata: {
        requestId: active.id,
        productId: active.productId,
        triggeredBy: 'admin',
        reactivated,
      },
      sendEmail: Boolean(listerEmail),
      emailData: {
        email: listerEmail,
        listerName,
        renterName,
        productName,
        requestId: active.id,
        rentalDays: active.rentalDays || 0,
        totalPrice: active.totalPrice || 0,
        startDate: active.startDate
          ? formatRentalBoundaryDateLagos(active.startDate)
          : 'TBD',
        endDate: active.endDate
          ? formatRentalBoundaryDateLagos(active.endDate)
          : 'TBD',
        dispatchWindows: Object.entries(windowMap).map(([type, window]) => ({
          type,
          window: {
            start: window.start.toISOString(),
            end: window.end.toISOString(),
          },
        })),
        viewLink: `${clientBase}/listers/orders/${active.id}`,
        requestType: isPurchase ? 'purchase' : 'rental',
      },
    });

    return {
      success: true,
      message: reactivated
        ? 'Request reactivated and resent to the lister'
        : 'Request resent to the lister',
      data: {
        requestId: active.id,
        reactivated,
        status: active.status,
        expiresAt: active.expiresAt,
      },
    };
  }
}
