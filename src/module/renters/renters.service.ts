import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../services/prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { WemaServiceService } from '../../services/wema-service/wema-service.service';
import {
  TOPSHIP_DESCRIPTION_MAX_LEN,
  topshipCombinedOrderItemsDescription,
  topshipProductDetailLine,
} from '../../services/topship/topship-description';
import { TopshipService } from '../../services/topship/topship.service';
import { randomUUID } from 'crypto';
import { ListingType, OrderStatus, Role } from '@prisma/client';
import { addMinutes, addDays } from 'date-fns';
import { createAttachments } from 'prisma/prisma.utils';

import { NotificationService } from '../../services/notification/notification.service';
import { assertNoOpenAvailabilityRequestForProduct } from '../../utils/assert-no-open-availability-for-product';
import { DEFAULT_CLEANING_FEE_NGN } from '../../constants/rental-pricing';
import { bad } from '../../utils/error';
import {
  CreateReturnRequestDto,
  SelectedReturnRateDto,
} from './dto/return-request.dto';
import {
  DispatchWindowRange,
  DispatchWindowRangeMap,
  DispatchWindowType,
  DispatchWindowsInput,
  availabilityRequestWindowFieldMap,
  buildDefaultDispatchWindow,
  isWindowExpired,
  parseDispatchWindowFromInput,
  applyRangeMapToData,
} from '../../utils/dispatch-windows';
import {
  buildListerWithdrawRentalRequestEmailContext,
  type ListerWithdrawNotify,
} from '../cart-items/withdraw-availability-for-cart-item';
import { syncOrderStatusFromShipments } from '../order/order-shipment-status.sync';

/** Renter progress ordering (subset of shipment-driven flow; excludes terminal edge cases). */
const RENTER_PROGRESS_RANK: OrderStatus[] = [
  OrderStatus.PROCESSING,
  OrderStatus.ACCEPTED,
  OrderStatus.CONFIRMED,
  OrderStatus.IN_TRANSIT,
  OrderStatus.DELIVERED,
  OrderStatus.ACTIVE,
  OrderStatus.RETURN_DUE,
  OrderStatus.RETURNED,
  OrderStatus.COMPLETED,
];

function renterProgressRank(status: OrderStatus): number {
  if (status === OrderStatus.IN_DISPUTE) {
    return RENTER_PROGRESS_RANK.indexOf(OrderStatus.ACTIVE);
  }
  const i = RENTER_PROGRESS_RANK.indexOf(status);
  return i === -1 ? -1 : i;
}

/**
 * Checkout debits the wallet before creating the order, but rental rows were stored as PROCESSING.
 * Renter UX should treat paid orders as confirmed (lister already accepted pre-checkout).
 */
function renterDisplayOrderStatus(
  status: OrderStatus,
  totalAmountPaid: number | null | undefined,
): OrderStatus {
  if (
    status === OrderStatus.PROCESSING &&
    totalAmountPaid != null &&
    Number(totalAmountPaid) > 0
  ) {
    return OrderStatus.CONFIRMED;
  }
  return status;
}

/** Topship booking in flight or completed (outbound leg no longer waiting for provider id). */
const OUTBOUND_BOOKED_STATUSES = new Set([
  'DISPATCHING',
  'DISPATCHED',
  'IN_TRANSIT',
  'COMPLETED',
]);

function allOutboundLegsBooked(
  outboundLegs: ReadonlyArray<{ status: string }>,
): boolean {
  if (outboundLegs.length === 0) return false;
  return outboundLegs.every((l) => OUTBOUND_BOOKED_STATUSES.has(l.status));
}

/**
 * Integer threshold used with rental milestone `doneAtRank` (1..7).
 * Aligns "In transit" with Topship outbound booked, not only OrderStatus.CONFIRMED.
 */
function computeRentalTimelineRank(
  status: OrderStatus,
  totalAmountPaid: number | null | undefined,
  outboundLegs: ReadonlyArray<{ status: string }>,
): number {
  const display = renterDisplayOrderStatus(status, totalAmountPaid);
  if (display === OrderStatus.IN_DISPUTE) {
    return 4;
  }
  const booked = allOutboundLegsBooked(outboundLegs);
  switch (display) {
    case OrderStatus.PROCESSING:
      return 0;
    case OrderStatus.ACCEPTED:
      return 1;
    case OrderStatus.CONFIRMED:
      return booked ? 3 : 2;
    case OrderStatus.IN_TRANSIT:
      return 3;
    case OrderStatus.DELIVERED:
    case OrderStatus.ACTIVE:
      return 4;
    case OrderStatus.RETURN_DUE:
      return 5;
    case OrderStatus.RETURNED:
      return 6;
    case OrderStatus.COMPLETED:
      return 7;
    default:
      return Math.max(0, renterProgressRank(display));
  }
}

/** Calendar date in Lagos (aligned with lister dispatch window formatting). */
const formatLocalDate = (value: Date | string) =>
  new Date(value).toLocaleDateString('en-CA', {
    timeZone: 'Africa/Lagos',
  });

const formatPickupWindowLagos = (start: Date, end: Date): string => {
  const tz = 'Africa/Lagos';
  const dateOpts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  };
  const timeOpts: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  };
  return `${start.toLocaleDateString('en-NG', dateOpts)}, ${start.toLocaleTimeString('en-NG', timeOpts)} to ${end.toLocaleTimeString('en-NG', timeOpts)}`;
};

/**
 * Single window shown to renter + lister: checkout RETURN shipment first (matches availability/checkout),
 * else the ReturnRequest slot from the return flow.
 */
function resolveReturnWindowForDisplay(args: {
  returnShipment: {
    scheduledWindowStart: Date | null;
    scheduledWindowEnd: Date | null;
  } | null;
  returnRequest: {
    pickupWindowStart: Date | null;
    pickupWindowEnd: Date | null;
  } | null;
}): { start: Date; end: Date; summary: string } | null {
  const ship = args.returnShipment;
  if (ship?.scheduledWindowStart && ship?.scheduledWindowEnd) {
    const start = new Date(ship.scheduledWindowStart);
    const end = new Date(ship.scheduledWindowEnd);
    return { start, end, summary: formatPickupWindowLagos(start, end) };
  }
  const rr = args.returnRequest;
  if (rr?.pickupWindowStart && rr?.pickupWindowEnd) {
    const start = new Date(rr.pickupWindowStart);
    const end = new Date(rr.pickupWindowEnd);
    return { start, end, summary: formatPickupWindowLagos(start, end) };
  }
  return null;
}

/**
 * RETURN shipment rows are created at checkout with Topship charges in kobo.
 * `processReturnWithShipping` passes NGN into Topship helpers via `toKobo()` — same as when the renter picked a tier at checkout.
 */
function selectedRateFromCheckoutReturnShipment(s: {
  pricingTier: string | null;
  pickupPartner: string | null;
  shipmentCharge: number | null;
  pickupCharge: number | null;
  vatCharge: number | null;
}): SelectedReturnRateDto | null {
  const koboToNgn = (k: number | null | undefined) =>
    k != null && Number.isFinite(Number(k)) ? Number(k) / 100 : 0;
  const shipmentCharge = koboToNgn(s.shipmentCharge);
  const pickupCharge = koboToNgn(s.pickupCharge);
  const vatCharge = koboToNgn(s.vatCharge);
  const tier = s.pricingTier?.trim();
  const partner = s.pickupPartner?.trim();
  if (!tier && !partner && shipmentCharge <= 0 && pickupCharge <= 0 && vatCharge <= 0) {
    return null;
  }
  const totalCharge = shipmentCharge + pickupCharge + vatCharge;
  return {
    pickupPartner: partner || 'Standard',
    shipmentCharge,
    pickupCharge,
    vatCharge,
    pricingTier: tier || 'chowdeck',
    totalCharge,
  };
}

function returnLegStatusLabel(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'Pickup not scheduled yet';
    case 'DISPATCHING':
      return 'Booking with carrier';
    case 'DISPATCHED':
      return 'Pickup scheduled';
    case 'IN_TRANSIT':
      return 'On the way back to the lister';
    case 'COMPLETED':
      return 'Delivered to lister';
    case 'DISPATCH_FAILED':
      return 'Dispatch failed. Support will retry.';
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return status;
  }
}

@Injectable()
export class RentersService {
  constructor(
    private prisma: PrismaService,
    private uploadService: UploadService,
    private wemaService: WemaServiceService,
    private notificationService: NotificationService,
    private topshipService: TopshipService,
  ) {}

  /** Accepts ISO strings, timestamps, or Date; rejects invalid / missing values. */
  private parseRentalBoundaryDate(value: unknown, fieldLabel: string): Date {
    if (value === undefined || value === null || value === '') {
      bad(`${fieldLabel} is required`);
    }
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) {
        bad(`Invalid ${fieldLabel}`);
      }
      return value;
    }
    const d = new Date(value as string | number);
    if (Number.isNaN(d.getTime())) {
      bad(
        `${fieldLabel} is invalid. Send an ISO 8601 string (e.g. 2026-04-16 or 2026-04-16T12:00:00.000Z).`,
      );
    }
    return d;
  }

  /** PENDING/ACCEPTED requests whose timers or dispatch windows elapsed are marked as EXPIRED. */
  private async expireStalePendingAvailabilityRequestsForRequester(
    requesterId: string,
  ) {
    const now = new Date();
    const windowExpiryFilters = Object.values(
      availabilityRequestWindowFieldMap,
    ).map(({ end }) => ({
      [end]: { not: null, lte: now },
    }));

    const orClauses: any[] = [
      {
        status: 'PENDING',
        expiresAt: { lte: now },
      },
    ];

    if (windowExpiryFilters.length > 0) {
      orClauses.push({
        status: { in: ['PENDING', 'ACCEPTED'] },
        OR: windowExpiryFilters,
      });
    }

    await this.prisma.availabilityRequest.updateMany({
      where: {
        requesterId,
        OR: orClauses,
      },
      data: { status: 'EXPIRED' },
    });
  }

  private mapAvailabilityStatusForRenterList(dbStatus: string): string {
    switch (dbStatus) {
      case 'PENDING':
        return 'pending_lister_approval';
      case 'ACCEPTED':
        return 'approved';
      case 'REJECTED':
        return 'rejected';
      case 'EXPIRED':
        return 'expired';
      case 'CANCELLED_BY_RENTER':
        return 'cancelled';
      default:
        return dbStatus.toLowerCase();
    }
  }

  private resolveReturnPickupWindow(
    pickupWindow?: CreateReturnRequestDto['pickupWindow'],
  ): DispatchWindowRange {
    const reference = new Date();
    const resolved = pickupWindow
      ? parseDispatchWindowFromInput('RETURN', {
          start: pickupWindow.start,
          end: pickupWindow.end,
        })
      : buildDefaultDispatchWindow(reference);

    if (isWindowExpired(resolved, reference)) {
      bad('Return pickup window must be in the future.');
    }

    return resolved;
  }

  /**
   * Multiple RETURN legs per order use scheduled windows from checkout.
   * Prefer explicit `shipmentId`, then match pickup window to a leg, else earliest window.
   */
  private resolveReturnShipmentLeg<T extends { id: string; type: string }>(
    orderShipments: T[],
    opts: {
      shipmentId?: string | null;
      pickupWindow: DispatchWindowRange;
    },
  ): T | null {
    type Row = T & {
      scheduledWindowStart?: Date | string | null;
      scheduledWindowEnd?: Date | string | null;
    };
    const returns = (orderShipments as Row[])
      .filter((s) => s.type === 'RETURN')
      .sort((a, b) => {
        const ta = a.scheduledWindowStart
          ? new Date(a.scheduledWindowStart).getTime()
          : Number.POSITIVE_INFINITY;
        const tb = b.scheduledWindowStart
          ? new Date(b.scheduledWindowStart).getTime()
          : Number.POSITIVE_INFINITY;
        if (ta !== tb) return ta - tb;
        return a.id.localeCompare(b.id);
      });

    if (opts.shipmentId) {
      const hit = returns.find((s) => s.id === opts.shipmentId);
      if (hit) return hit as T;
      bad('Invalid return shipment for this order.');
    }

    const tolMs = 2 * 60 * 1000;
    const ps = opts.pickupWindow.start.getTime();
    const pe = opts.pickupWindow.end.getTime();
    for (const r of returns) {
      if (!r.scheduledWindowStart || !r.scheduledWindowEnd) continue;
      const rs = new Date(r.scheduledWindowStart).getTime();
      const re = new Date(r.scheduledWindowEnd).getTime();
      if (Math.abs(rs - ps) <= tolMs && Math.abs(re - pe) <= tolMs) {
        return r as T;
      }
    }

    return (returns[0] as T) ?? null;
  }

  async getDashboardSummary(userId: string, timeframe: string = 'month') {
    const activeRentals = await this.prisma.rental.findMany({
      where: { userId, isReturned: false, days: { gt: 0 } },
      include: {
        product: true,
        curator: { select: { name: true } },
        order: true,
      },
    });

    const pendingReturnsCount = await this.prisma.rental.count({
      where: {
        userId,
        isReturned: false,
        endDate: { lte: new Date() },
      },
    });

    // Cast to any to avoid strict type checks on partial returns if needed
    const wallet: any = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    const favoriteItemsCount = await this.prisma.favourite.count({
      where: { userId },
    });

    return {
      success: true,
      data: {
        dashboard: {
          activeRentals: {
            count: activeRentals.length,
            items: activeRentals.map((r) => ({
              orderId: r.order?.orderId || r.orderId,
              itemName: r.product.name,
              listerName: (r as any).curator?.name || 'Unknown',
              rentalStartDate: r.startDate,
              rentalEndDate: r.endDate,
              daysRemaining: Math.ceil(
                (new Date(r.endDate).getTime() - new Date().getTime()) /
                  (1000 * 60 * 60 * 24),
              ),
              status: 'active',
            })),
          },
          pendingReturns: {
            count: pendingReturnsCount,
            dueDate: new Date().toISOString(),
          },
          walletBalance: {
            amount: wallet?.availableBalance || 0,
            currency: 'NGN',
          },
          totalSpent: {
            amount: 0,
            currency: 'NGN',
          },
          favoriteItems: favoriteItemsCount,
          recentOrders: 5,
        },
      },
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: {
          include: {
            address: true,
            avatarUpload: true,
            emergencyContact: true,
          },
        },
        virtualAccounts: true,
        bankAccounts: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    return {
      success: true,
      data: {
        profile: {
          userId: user.id,
          fullName: user.name,
          email: user.email,
          role: user.role,
          phone: user.profile?.phoneNumber,
          bvn: user.profile?.bvn,
          nin: user.profile?.nin,
          virtualAccount: user.virtualAccounts?.[0]
            ? {
                vaNumber: user.virtualAccounts[0].vaNumber,
                bankName: 'Wema Bank',
                status: user.virtualAccounts[0].status,
              }
            : null,
          profileImage: user.profile?.avatarUpload?.url || null, // ensure it defaults to null
          dateJoined: user.createdAt,
          emergencyContact: user.profile?.emergencyContact || null,
          addresses: user.profile?.address ? [user.profile.address] : [],
          bankAccountInfo: user.bankAccounts || [],
        },
      },
    };
  }

  async updateProfile(userId: string, updateData: any) {
    const phoneToSet =
      updateData.phone !== undefined
        ? updateData.phone
        : updateData.phoneNumber;
    const emergencyContactData =
      updateData.emergencyContact || updateData.emergencyContacts;

    const profileUpdate: any = {};
    if (phoneToSet !== undefined) profileUpdate.phoneNumber = phoneToSet;
    if (updateData.bvn !== undefined) profileUpdate.bvn = updateData.bvn;
    if (updateData.nin !== undefined) profileUpdate.nin = updateData.nin;

    if (emergencyContactData) {
      profileUpdate.emergencyContact = {
        upsert: {
          create: emergencyContactData,
          update: emergencyContactData,
        },
      };
    }
    if (updateData.businessInfo) {
      profileUpdate.businessInfo = {
        upsert: {
          create: updateData.businessInfo,
          update: updateData.businessInfo,
        },
      };
    }
    if (updateData.address) {
      profileUpdate.address = {
        upsert: {
          create: updateData.address,
          update: updateData.address,
        },
      };
    }
    if (updateData.avatarUploadId) {
      profileUpdate.avatarUpload = {
        connect: { id: updateData.avatarUploadId },
      };
    }

    const profileCreate: any = {
      phoneNumber: phoneToSet || '',
      ...(updateData.bvn && { bvn: updateData.bvn }),
      ...(updateData.nin && { nin: updateData.nin }),
      ...(emergencyContactData && {
        emergencyContact: {
          create: emergencyContactData,
        },
      }),
      ...(updateData.businessInfo && {
        businessInfo: {
          create: updateData.businessInfo,
        },
      }),
      ...(updateData.address && {
        address: {
          create: updateData.address,
        },
      }),
      ...(updateData.avatarUploadId && {
        avatarUpload: { connect: { id: updateData.avatarUploadId } },
      }),
    };

    const userDataUpdate: any = {};
    if (updateData.fullName || updateData.name) {
      userDataUpdate.name = updateData.fullName || updateData.name;
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

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: userDataUpdate,
      include: {
        profile: {
          include: {
            emergencyContact: true,
            address: true,
            avatarUpload: true,
          },
        },
        virtualAccounts: true,
      },
    });

    if (
      (updateData.bvn || updateData.nin) &&
      user.virtualAccounts?.length === 0
    ) {
      try {
        await this.wemaService.createAccount(user as any, 0);
      } catch (err: any) {
        console.warn(
          `Failed to generate Virtual Account for ${userId}:`,
          err.message,
        );
      }
    }

    const bankInfo = updateData.bankAccountInfo || updateData.bankAccounts;
    if (bankInfo) {
      const existingBank = await this.prisma.bankAccount.findFirst({
        where: { userId, accountNumber: bankInfo.accountNumber },
      });

      if (existingBank) {
        await this.prisma.bankAccount.update({
          where: { id: existingBank.id },
          data: {
            bankName: bankInfo.bankName,
            bankCode: bankInfo.bankCode,
            accountName: bankInfo.accountName || bankInfo.nameOfAccount,
          },
        });
      } else {
        await this.prisma.bankAccount.create({
          data: {
            userId: userId,
            bankName: bankInfo.bankName,
            bankCode: bankInfo.bankCode,
            accountNumber: bankInfo.accountNumber,
            accountName: bankInfo.accountName || bankInfo.nameOfAccount,
            isDefault: true,
          },
        });
      }
    }

    // Refetch in case it was created
    const finalUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: {
          include: {
            emergencyContact: true,
            address: true,
            avatarUpload: true,
          },
        },
        virtualAccounts: true,
        bankAccounts: true,
      },
    });

    return {
      success: true,
      message: 'Profile updated successfully',
      data: {
        profile: {
          userId: finalUser?.id,
          fullName: finalUser?.name,
          email: finalUser?.email,
          phone: finalUser?.profile?.phoneNumber,
          bvn: finalUser?.profile?.bvn,
          nin: finalUser?.profile?.nin,
          virtualAccount: finalUser?.virtualAccounts?.[0]
            ? {
                vaNumber: finalUser?.virtualAccounts[0].vaNumber,
                bankName: 'Wema Bank',
                status: finalUser?.virtualAccounts[0].status,
              }
            : null,
          profileImage: finalUser?.profile?.avatarUpload?.url || null,
          emergencyContact: finalUser?.profile?.emergencyContact || null,
          addresses: finalUser?.profile?.address
            ? [finalUser?.profile.address]
            : [],
          bankAccountInfo: finalUser?.bankAccounts || [],
          updatedAt: new Date(),
        },
      },
    };
  }

  async getAddresses(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      include: { address: true },
    });

    return {
      success: true,
      data: {
        addresses: profile?.address ? [profile.address] : [],
        total: profile?.address ? 1 : 0,
      },
    };
  }

  async addAddress(userId: string, addressData: any) {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profile not found');

    const address = await this.prisma.address.upsert({
      where: { profileId: profile.id },
      create: {
        profileId: profile.id,
        street: addressData.street,
        city: addressData.city,
        state: addressData.state,
        country: addressData.country,
        zipCode: addressData.postalCode,
        isDefault: addressData.isDefault,
      },
      update: {
        street: addressData.street,
        city: addressData.city,
        state: addressData.state,
        country: addressData.country,
        zipCode: addressData.postalCode,
        isDefault: addressData.isDefault,
      },
    });

    return {
      success: true,
      message: 'Address added successfully',
      data: { address },
    };
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

    // Explicit casting to allow access to transactions if inferred type is incomplete due to include
    const safeWallet = wallet;

    const activeRentals = await this.prisma.rental.findMany({
      where: { userId, isReturned: false, days: { gt: 0 } },
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
            currency: 'NGN',
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
          currency: 'NGN',
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
    return {
      success: true,
      data: {
        lockedBalances: {
          totalLocked: 0,
          currency: 'NGN',
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
            'Wallet balances are inconsistent (availableBalance is below mainBalance with no collateral).',
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

      // Create transaction record
      await (tx as any).walletTransaction.create({
        data: {
          walletId: w.id,
          type: 'MAIN',
          amount: -amount,
          status: 'SUCCESS',
          note: `Withdrawal request to ${bankAccount.bankName} (Ref: ${reference})`,
        },
      });

      // Create withdrawal request
      return await (tx as any).withdrawalRequest.create({
        data: {
          userId,
          amount,
          netAmount: amount,
          currency: 'NGN',
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

  /* rental requests support */

  async createRentalRequest(userId: string, data: any) {
    let cartItemId =
      typeof data.cartItemId === 'string' && data.cartItemId.trim() !== ''
        ? data.cartItemId.trim()
        : '';

    if (cartItemId) {
      const line = await this.prisma.cartItem.findUnique({
        where: { id: cartItemId },
        include: { cart: true },
      });
      if (!line || line.cart.userId !== userId) {
        throw new BadRequestException('cartItemId does not match your cart');
      }
      if (line.productId !== data.productId) {
        throw new BadRequestException(
          'cartItemId does not match productId for this request',
        );
      }
    } else if (data.productId) {
      const cart = await this.prisma.cart.findUnique({
        where: { userId },
        include: {
          items: { where: { productId: data.productId }, take: 1 },
        },
      });
      if (cart?.items?.[0]) {
        cartItemId = cart.items[0].id;
      }
    }

    // Validate product exists
    const product = await this.prisma.product.findUnique({
      where: { id: data.productId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    await assertNoOpenAvailabilityRequestForProduct(
      this.prisma,
      userId,
      data.productId,
    );

    const startRaw =
      data.rentalStartDate ?? data.startDate ?? data.rental_start_date;
    const endRaw = data.rentalEndDate ?? data.endDate ?? data.rental_end_date;

    // For resale items (days = 0), startDate/endDate are not required
    let startDate: Date | null = null;
    let endDate: Date | null = null;
    if (data.rentalDays && data.rentalDays > 0) {
      startDate = this.parseRentalBoundaryDate(startRaw, 'Rental start date');
      endDate = this.parseRentalBoundaryDate(endRaw, 'Rental end date');
      if (endDate.getTime() < startDate.getTime()) {
        bad('Rental end date must be on or after the start date');
      }
    }

    const expiresAt = addMinutes(new Date(), 15);

    const dispatchWindowsInput = data.dispatchWindows as
      | DispatchWindowsInput
      | undefined;

    const requiredWindowTypes: DispatchWindowType[] = [];
    if (data.rentalDays && data.rentalDays > 0) {
      requiredWindowTypes.push('OUTBOUND', 'RETURN');
    }
    if (data.rentalDays === 0) {
      requiredWindowTypes.push('RESALE');
    }

    const now = new Date();
    const outboundBase =
      startDate && startDate.getTime() > now.getTime() ? startDate : now;
    const returnBase =
      endDate && endDate.getTime() > now.getTime() ? endDate : now;

    let windowMap: Partial<Record<DispatchWindowType, DispatchWindowRange>> =
      {};
    for (const type of requiredWindowTypes) {
      if (dispatchWindowsInput?.[type]) {
        windowMap[type] = parseDispatchWindowFromInput(
          type,
          dispatchWindowsInput[type]!,
        );
      }
    }
    for (const type of requiredWindowTypes) {
      const w = windowMap[type];
      if (!w || isWindowExpired(w, now)) {
        if (type === 'OUTBOUND') {
          windowMap[type] = buildDefaultDispatchWindow(outboundBase);
        } else if (type === 'RETURN') {
          windowMap[type] = buildDefaultDispatchWindow(returnBase);
        } else {
          windowMap[type] = buildDefaultDispatchWindow(now);
        }
      }
    }

    const windowData = applyRangeMapToData(
      windowMap as DispatchWindowRangeMap,
      availabilityRequestWindowFieldMap,
    );

    const request = await this.prisma.availabilityRequest.create({
      data: {
        productId: data.productId,
        cartItemId,
        requesterId: userId,
        listerId: data.listerId,
        status: 'PENDING',
        expiresAt,
        startDate,
        endDate,
        rentalDays: data.rentalDays,
        totalPrice: data.estimatedRentalPrice,
        deliveryAddressId: data.deliveryAddressId,
        autoPay: data.autoPay || false,
        ...windowData,
      },
      include: {
        product: { include: { curator: true } },
      },
    });

    const userObj = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    // Determine if this is a resale request (days = 0)
    const isResaleRequest = request.rentalDays === 0;
    const requestType = isResaleRequest ? 'Purchase Request' : 'Rental Request';
    const requestTypeLower = isResaleRequest
      ? 'purchase request'
      : 'rental request';

    // Notify Lister
    await this.notificationService.createNotification({
      userId: request.listerId,
      title: `New ${requestType}`,
      message: `You have a new ${requestTypeLower} for ${request.product?.name} from ${userObj?.name || 'a user'}.`,
      type: isResaleRequest ? 'PURCHASE_REQUEST' : 'RENTAL_REQUEST',
      metadata: { requestId: request.id, productId: request.productId },
      sendEmail: true,
      emailData: {
        email: request.product?.curator?.email,
        listerName: request.product?.curator?.name,
        renterName: userObj?.name || 'A user',
        productName: request.product?.name,
        requestId: request.id,
        rentalDays: request.rentalDays,
        totalPrice: request.totalPrice,
        startDate: request.startDate ? request.startDate.toDateString() : 'N/A',
        endDate: request.endDate ? request.endDate.toDateString() : 'N/A',
        viewLink: `${process.env.CLIENT_URL}/listers/orders/${request.id}`,
        requestType: isResaleRequest ? 'purchase' : 'rental',
        dispatchWindows: Object.entries(windowMap).map(([type, window]) => ({
          type,
          window: {
            start: window!.start.toISOString(),
            end: window!.end.toISOString(),
          },
        })),
      },
    });

    // Notify Renter
    await this.notificationService.createNotification({
      userId: userId,
      title: `${requestType} Sent`,
      message: `Your ${requestTypeLower} for ${request.product?.name} has been sent to the lister.`,
      type: isResaleRequest ? 'PURCHASE_REQUEST_SENT' : 'RENTAL_REQUEST_SENT',
      metadata: { requestId: request.id, productId: request.productId },
      sendEmail: true,
    });

    // build response similar to spec sample
    return {
      success: true,
      message: 'Availability request submitted successfully',
      data: {
        requestId: request.id,
        productId: request.productId,
        productName: request.product?.name || null,
        productValue: request.product?.originalValue || 0,
        listerId: request.listerId,
        listerName: (request.product as any)?.curator?.name || null,
        rentalStartDate: request.startDate,
        rentalEndDate: request.endDate,
        rentalDays: request.rentalDays,
        estimatedPrice: {
          rentalFee: request.totalPrice || 0,
          deliveryFee: 0,
          securityDeposit: 0,
          total: request.totalPrice || 0,
          currency: 'NGN',
        },
        deductionExplanation:
          'At order confirmation, rental fee will be deducted from your wallet.',
        autoPay: request.autoPay,
        status: 'pending_lister_approval',
        requestCreatedAt: request.createdAt,
        expiresAt: request.expiresAt,
        timerMinutes: 15,
        cartItemId: request.cartItemId,
      },
    };
  }

  async getRentalRequests(userId: string, query: any) {
    await this.expireStalePendingAvailabilityRequestsForRequester(userId);

    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;
    const status = query.status || 'pending';

    const where: any = { requesterId: userId };
    if (status && status !== 'all') {
      const map: Record<string, string> = {
        pending: 'PENDING',
        approved: 'ACCEPTED',
        rejected: 'REJECTED',
        expired: 'EXPIRED',
        cancelled: 'CANCELLED_BY_RENTER',
        withdrawn: 'CANCELLED_BY_RENTER',
      };
      where.status = map[status] || undefined;
    }

    const [total, requests] = await this.prisma.$transaction([
      this.prisma.availabilityRequest.count({ where }),
      this.prisma.availabilityRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { product: { include: { curator: true } } },
      }),
    ]);

    const items = requests.map((r: any) => {
      const diff = Math.max(
        0,
        Math.floor((new Date(r.expiresAt).getTime() - Date.now()) / 1000),
      );
      const selectedWindows =
        r.rentalDays === 0
          ? {
              resaleWindow: r.resaleWindowStart && r.resaleWindowEnd
                ? { start: r.resaleWindowStart, end: r.resaleWindowEnd }
                : null,
            }
          : {
              outboundDeliveryWindow:
                r.outboundWindowStart && r.outboundWindowEnd
                  ? { start: r.outboundWindowStart, end: r.outboundWindowEnd }
                  : null,
              returnPickupWindow:
                r.returnWindowStart && r.returnWindowEnd
                  ? { start: r.returnWindowStart, end: r.returnWindowEnd }
                  : null,
            };
      return {
        requestId: r.id,
        cartItemId: r.cartItemId,
        productId: r.productId,
        productName: r.product?.name || null,
        productImage: r.product?.images?.[0] || null,
        listerId: r.listerId,
        listerName: r.product?.curator?.name || null,
        rentalStartDate: r.startDate,
        rentalEndDate: r.endDate,
        rentalDays: r.rentalDays,
        rentalPrice: r.totalPrice || 0,
        deliveryFee: 0,
        cleaningFee: 0,
        totalPrice: r.totalPrice || 0,
        currency: 'NGN',
        autoPay: r.autoPay,
        status: this.mapAvailabilityStatusForRenterList(r.status),
        requestCreatedAt: r.createdAt,
        expiresAt: r.expiresAt,
        timeRemainingSeconds: diff,
        timeRemainingMinutes: Math.ceil(diff / 60),
        selectedWindows,
      };
    });

    // summary hack - simple totals
    const subtotal = items.reduce(
      (sum: number, i: any) => sum + i.rentalPrice,
      0,
    );
    const totalDeliveryFee = items.reduce(
      (sum: number, i: any) => sum + i.deliveryFee,
      0,
    );
    const totalCleaningFee = items.reduce(
      (sum: number, i: any) => sum + i.cleaningFee,
      0,
    );
    const cartTotal = subtotal + totalDeliveryFee + totalCleaningFee;

    return {
      success: true,
      data: {
        rentalRequests: items,
        cartSummary: {
          totalItems: items.length,
          subtotal,
          totalDeliveryFee,
          totalCleaningFee,
          cartTotal,
          currency: 'NGN',
        },
        page,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getRentalRequest(userId: string, requestId: string) {
    const r: any = await this.prisma.availabilityRequest.findUnique({
      where: { id: requestId },
      include: { product: { include: { curator: true } } },
    });
    if (!r || r.requesterId !== userId)
      throw new NotFoundException('Request not found');
    const diff = Math.max(
      0,
      Math.floor((new Date(r.expiresAt).getTime() - Date.now()) / 1000),
    );
    return {
      success: true,
      data: {
        request: {
          requestId: r.id,
          cartItemId: r.cartItemId,
          productId: r.productId,
          productName: r.product?.name || null,
          listerId: r.listerId,
          listerName: r.product?.curator?.name || null,
          rentalStartDate: r.startDate,
          rentalEndDate: r.endDate,
          rentalDays: r.rentalDays,
          totalPrice: r.totalPrice || 0,
          currency: 'NGN',
          autoPay: r.autoPay,
          status:
            r.status === 'PENDING'
              ? 'pending_lister_approval'
              : r.status.toLowerCase(),
          requestCreatedAt: r.createdAt,
          expiresAt: r.expiresAt,
          timeRemainingSeconds: diff,
          timeRemainingMinutes: Math.ceil(diff / 60),
          listerResponse: null,
          listerResponseAt: null,
          message: 'Waiting for lister approval...',
        },
      },
    };
  }

  async deleteRentalRequest(userId: string, requestId: string) {
    const r = await this.prisma.availabilityRequest.findUnique({
      where: { id: requestId },
      include: {
        product: {
          include: { curator: { select: { email: true, name: true } } },
        },
        requester: { select: { name: true } },
      },
    });
    if (!r || r.requesterId !== userId)
      throw new NotFoundException('Request not found');
    if (r.status === 'CANCELLED_BY_RENTER') {
      const remaining = await this.prisma.availabilityRequest.count({
        where: { requesterId: userId, status: 'PENDING' },
      });
      return {
        success: true,
        message: 'Request was already cancelled by the renter',
        data: {
          requestId,
          cartItemId: r.cartItemId,
          removedAt: new Date(),
          remainingCartItems: remaining,
        },
      };
    }

    const listerNotifies: ListerWithdrawNotify[] = [];

    await this.prisma.$transaction(async (tx) => {
      if (r.status === 'PENDING') {
        await tx.availabilityRequest.update({
          where: { id: requestId },
          data: { status: 'CANCELLED_BY_RENTER' },
        });
        const emailData = buildListerWithdrawRentalRequestEmailContext(
          r,
          false,
        );
        listerNotifies.push({
          listerId: r.listerId,
          productName: emailData.productName,
          requestId: r.id,
          afterApproval: false,
          emailData,
        });
      } else if (r.status === 'ACCEPTED') {
        await tx.availabilityRequest.update({
          where: { id: requestId },
          data: { status: 'CANCELLED_BY_RENTER' },
        });
        const emailData = buildListerWithdrawRentalRequestEmailContext(r, true);
        listerNotifies.push({
          listerId: r.listerId,
          productName: emailData.productName,
          requestId: r.id,
          afterApproval: true,
          emailData,
        });
      }

      if (r.cartItemId) {
        const activeLeft = await tx.availabilityRequest.count({
          where: {
            cartItemId: r.cartItemId,
            status: { in: ['PENDING', 'ACCEPTED'] },
          },
        });
        if (activeLeft === 0) {
          const cartItem = await tx.cartItem.findUnique({
            where: { id: r.cartItemId },
            include: { cart: true },
          });
          if (cartItem && cartItem.cart.userId === userId) {
            await tx.cartItem.delete({ where: { id: r.cartItemId } });
          }
        }
      }
    });

    for (const n of listerNotifies) {
      await this.notificationService.createNotification({
        userId: n.listerId,
        title: n.afterApproval
          ? 'Cancelled by renter (after approval)'
          : 'Rental request withdrawn',
        message: n.afterApproval
          ? `The renter cancelled after you approved: ${n.productName}.`
          : `${n.emailData.renterName} withdrew their rental request for ${n.productName}.`,
        type: 'RENTAL_REQUEST',
        metadata: {
          requestId: n.requestId,
          productName: n.productName,
          status: 'CANCELLED_BY_RENTER',
        },
        sendEmail: Boolean(n.emailData.email),
        emailData: n.emailData,
      });
    }

    const remaining = await this.prisma.availabilityRequest.count({
      where: { requesterId: userId, status: 'PENDING' },
    });
    return {
      success: true,
      message:
        'Rental request removed. Your cart line stays if other requests for that item are still active.',
      data: {
        requestId,
        cartItemId: r.cartItemId,
        removedAt: new Date(),
        remainingCartItems: remaining,
      },
    };
  }

  async confirmRentalRequest(
    userId: string,
    requestId: string,
    _body: unknown,
  ) {
    const r = await this.prisma.availabilityRequest.findUnique({
      where: { id: requestId },
      include: { product: { include: { curator: true } } },
    });
    if (!r || r.requesterId !== userId)
      throw new NotFoundException('Request not found');
    if (r.status === 'CANCELLED_BY_RENTER')
      throw new BadRequestException(
        'This rental request was cancelled by the renter. Start a new request if you still want the item.',
      );
    if (r.status !== 'ACCEPTED')
      throw new BadRequestException(
        'Lister has not approved or request expired',
      );

    return {
      success: true,
      message:
        'Request is approved. Complete payment from the cart using checkout (POST /order).',
      data: {
        requestId,
        productId: r.productId,
        productName: r.product?.name ?? null,
        listerName: (r.product as any)?.curator?.name ?? null,
        rentalStartDate: r.startDate,
        rentalEndDate: r.endDate,
        rentalDays: r.rentalDays,
        totalPrice: r.totalPrice ?? 0,
        currency: 'NGN',
        status: 'approved_awaiting_checkout',
      },
    };
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');

    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profile not found');

    const uploadId = randomUUID();
    const mockUser = { id: userId, email: '', sub: userId } as any;

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

  async getOrders(userId: string, query: any) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const skip = (page - 1) * limit;
    const status = query.status;

    const where: any = { userId };
    if (status === 'active')
      where.status = {
        in: [
          'CONFIRMED',
          'IN_TRANSIT',
          'DELIVERED',
          'ACTIVE',
          'PROCESSING',
          'ACCEPTED',
          'RETURN_DUE',
        ],
      };
    if (status === 'completed') {
      where.status = 'COMPLETED';
    }
    if (status === 'cancelled') where.status = 'CANCELLED';

    const [total, orders] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          orderItems: {
            include: {
              product: true,
            },
          },
          rentals: true,
        } as any,
      }),
    ]);

    const typedOrders = orders as any[];

    return {
      success: true,
      data: {
        orders: typedOrders.map((o) => {
          const totalAmount =
            o.totalAmountPaid ||
            o.rentals?.[0]?.totalAmount ||
            o.orderItems.reduce(
              (sum: number, item: any) => sum + item.pricePerDay * item.days,
              0,
            );
          const firstItem = o.orderItems[0];
          const image = firstItem?.imageUrl || null;

          return {
            id: o.id,
            orderId: o.orderId,
            items: o.orderItems.map((i: any) => ({
              id: i.product?.id || i.productId,
              name: i.product?.name || 'Item',
              listingType: i.product?.listingType,
              days: i.days,
              rentalDays: i.days,
              imageUrl:
                i.imageUrl || i.product?.attachments?.uploads?.[0]?.url || null,
            })),
            totalAmount: totalAmount,
            status: renterDisplayOrderStatus(o.status, o.totalAmountPaid),
            date: o.createdAt,
            image: image,
            listerName: o.listerBusinessName || 'Unknown',
          };
        }),
        totalOrders: total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderId },
      include: {
        orderListers: true,
        orderItems: {
          include: {
            product: {
              include: {
                attachments: { include: { uploads: true } },
                tags: true,
                curator: {
                  include: { profile: { include: { avatarUpload: true } } },
                },
              },
            },
          },
        },
        rentals: true,
        shipments: {
          orderBy: { createdAt: 'asc' },
        },
        returnRequests: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        user: { include: { profile: { include: { address: true } } } },
      } as any,
    });

    if (!order || order.userId !== userId)
      throw new NotFoundException('Order not found');

    const typedOrder = order as any;
    const latestRr = typedOrder.returnRequests?.[0] ?? null;
    const returnShipments = (typedOrder.shipments ?? []).filter(
      (s: { type: string }) => s.type === 'RETURN',
    );
    const latestReturnLeg =
      returnShipments.length > 0
        ? returnShipments[returnShipments.length - 1]
        : null;
    const unifiedReturnWindow = resolveReturnWindowForDisplay({
      returnShipment: latestReturnLeg,
      returnRequest: latestRr,
    });
    const returnPickup =
      latestRr &&
      (latestRr.pickupWindowStart ||
        latestRr.pickupWindowEnd ||
        latestRr.trackingNumber ||
        latestRr.shipmentId)
        ? {
            requestStatus: latestRr.status,
            trackingNumber: latestRr.trackingNumber ?? null,
            carrierShipmentId: latestRr.shipmentId ?? null,
            pickupWindowStart:
              unifiedReturnWindow?.start.toISOString() ??
              latestRr.pickupWindowStart?.toISOString?.() ??
              null,
            pickupWindowEnd:
              unifiedReturnWindow?.end.toISOString() ??
              latestRr.pickupWindowEnd?.toISOString?.() ??
              null,
            pickupScheduledAt: latestRr.pickupScheduledAt?.toISOString?.() ?? null,
            pickupWindowSummary:
              unifiedReturnWindow?.summary ??
              (latestRr.pickupWindowStart && latestRr.pickupWindowEnd
                ? formatPickupWindowLagos(
                    new Date(latestRr.pickupWindowStart),
                    new Date(latestRr.pickupWindowEnd),
                  )
                : null),
          }
        : null;
    const returnLeg = latestReturnLeg
      ? {
          status: latestReturnLeg.status,
          label: returnLegStatusLabel(String(latestReturnLeg.status)),
          trackingId: latestReturnLeg.trackingId ?? null,
          providerTrackingUrl: latestReturnLeg.providerTrackingUrl ?? null,
          windowSummary:
            unifiedReturnWindow?.summary ??
            (latestReturnLeg.scheduledWindowStart &&
            latestReturnLeg.scheduledWindowEnd
              ? formatPickupWindowLagos(
                  new Date(latestReturnLeg.scheduledWindowStart),
                  new Date(latestReturnLeg.scheduledWindowEnd),
                )
              : null),
        }
      : null;
    const totalAmount =
      typedOrder.totalAmountPaid ||
      typedOrder.rentals?.[0]?.totalAmount ||
      typedOrder.orderItems.reduce(
        (sum: number, item: any) => sum + item.pricePerDay * item.days,
        0,
      );

    const productIds = [
      ...new Set(
        (typedOrder.orderItems as any[])
          .map((i) => i.productId)
          .filter(Boolean),
      ),
    ] as string[];
    const availabilityRequests =
      productIds.length > 0
        ? await this.prisma.availabilityRequest.findMany({
            where: {
              requesterId: userId,
              productId: { in: productIds },
              status: 'ACCEPTED',
            },
            orderBy: { createdAt: 'desc' },
          })
        : [];
    const availByProduct = new Map<
      string,
      {
        startDate: Date | null;
        endDate: Date | null;
        returnWindowStart: Date | null;
      }
    >();
    for (const row of availabilityRequests) {
      if (!availByProduct.has(row.productId)) {
        availByProduct.set(row.productId, {
          startDate: row.startDate,
          endDate: row.endDate,
          returnWindowStart: row.returnWindowStart ?? null,
        });
      }
    }

    const rentals: any[] = typedOrder.rentals ?? [];
    const dispatchWindows = this.mergeRenterDispatchWindows(
      typedOrder,
      availabilityRequests,
    );

    const rentalSubtotal = typedOrder.orderItems.reduce(
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
    const cleaningFeesTotal = typedOrder.orderItems.reduce(
      (sum: number, oi: any) => sum + (oi.cleaningFee ?? 0),
      0,
    );
    const resaleSubtotal = typedOrder.orderItems.reduce(
      (sum: number, oi: any) => {
        const isResaleItem =
          oi.days === 0 &&
          (oi.product?.listingType === 'RESALE' ||
            oi.product?.listingType === 'RENT_OR_RESALE');
        return isResaleItem ? sum + (oi.product?.resalePrice || 0) : sum;
      },
      0,
    );
    const merchandiseBreakdown = {
      rentalSubtotal,
      cleaningFeesTotal,
      resaleSubtotal,
      total: rentalSubtotal + cleaningFeesTotal + resaleSubtotal,
    };

    return {
      success: true,
      data: {
        order: {
          orderId: typedOrder.orderId,
          status: renterDisplayOrderStatus(
            typedOrder.status,
            typedOrder.totalAmountPaid,
          ),
          listingType: typedOrder.listingType,
          createdAt: typedOrder.createdAt,
          totalAmount: totalAmount,
          rentalId: rentals.length === 1 ? (rentals[0]?.id ?? null) : null,
          rentals: rentals.map((r: any) => ({
            id: r.id,
            productId: r.productId,
            curatorId: r.curatorId,
            startDate: r.startDate,
            endDate: r.endDate,
            returnedAt: r.returnedAt,
            isReturned: r.isReturned,
            isOverdue: r.isOverdue,
          })),
          rentalStartDate: rentals[0]?.startDate || null,
          rentalEndDate: rentals[0]?.endDate || null,
          deliveryFee: typedOrder.deliveryFee || 0,
          serviceFee: typedOrder.serviceFee || 0,
          vatAmount: typedOrder.vatAmount ?? 0,
          dispatchWindows,
          merchandiseBreakdown,
          returnPickup,
          returnLeg,
          lister: {
            userId:
              (typedOrder.orderListers && typedOrder.orderListers[0]?.listerId) ||
              typedOrder.orderItems?.[0]?.product?.curator?.id,
            businessName:
              typedOrder.listerBusinessName ||
              typedOrder.orderItems?.[0]?.product?.curator?.name,
            rating: typedOrder.listerRating || 0,
            imageUrl:
              typedOrder.listerImage ||
              typedOrder.orderItems?.[0]?.product?.curator?.profile
                ?.avatarUpload?.url ||
              null,
          },
          items: typedOrder.orderItems.map((i: any) => {
            const rentalRow = rentals.find(
              (r: any) => r.productId === i.productId,
            );
            const avail = availByProduct.get(i.productId);
            const rentalStartDate =
              rentalRow?.startDate ?? avail?.startDate ?? null;
            const rentalEndDate = rentalRow?.endDate ?? avail?.endDate ?? null;
            let returnDueDate: string | null = null;
            if (avail?.returnWindowStart) {
              returnDueDate = new Date(avail.returnWindowStart).toISOString();
            } else if (rentalEndDate) {
              returnDueDate = addDays(new Date(rentalEndDate), 1).toISOString();
            }

            const cleaningFee = i.cleaningFee ?? DEFAULT_CLEANING_FEE_NGN;
            const collateralFee =
              i.collateralFee ??
              (Number(
                i.product?.collateralPrice ?? i.product?.originalValue ?? 0,
              ) ||
                0);

            return {
              id: i.product?.id || i.productId,
              name: i.product?.name || 'Unknown',
              price: i.pricePerDay,
              quantity: i.product?.quantity ?? 1,
              days: i.days,
              rentalDays: i.days,
              listingType: i.product?.listingType,
              imageUrl:
                i.imageUrl ||
                i.product?.attachments?.uploads?.[0]?.url ||
                i.product?.images?.[0] ||
                null,
              rentalFee: i.rentalFee || i.pricePerDay * i.days,
              cleaningFee,
              collateralFee,
              collateral: collateralFee,
              rentalStartDate,
              rentalEndDate,
              returnDueDate,
            };
          }),
          shippingAddress: typedOrder.user.profile?.address || null,
          tracking: {
            status: renterDisplayOrderStatus(
              typedOrder.status,
              typedOrder.totalAmountPaid,
            ),
            updates: [],
          },
        },
      },
    };
  }

  async updateOrderTracking(userId: string, orderId: string, data: any) {
    return {
      success: true,
      message: 'Order updated',
    };
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
        scheduledDate: formatLocalDate(
          shipment.scheduledDate ?? shipment.scheduledWindowStart,
        ),
        baseDate: formatLocalDate(baseDate),
      });
    }

    return dispatchWindows;
  }

  private formatDispatchWindowsFromAvailabilityRequest(req: any) {
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

  private consolidateRenterDispatchWindowsByTypeAndDay(
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
      out.push({
        ...head,
        window: {
          start: new Date(tStart).toISOString(),
          end: new Date(tEnd).toISOString(),
        },
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

  private mergeRenterDispatchWindows(order: any, availabilityRequests: any[]) {
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
      merged.push(...this.formatDispatchWindowsFromAvailabilityRequest(req));
    }
    const seen = new Set<string>();
    const deduped = merged.filter((w) => {
      const key = `${w.type}|${w.window.start}|${w.window.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return this.consolidateRenterDispatchWindowsByTypeAndDay(deduped);
  }

  async getFavorites(userId: string, query: any) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const [total, favorites] = await this.prisma.$transaction([
      this.prisma.favourite.count({ where: { userId } }),
      this.prisma.favourite.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { product: true },
      }),
    ]);

    const typedFavorites = favorites as any[];

    return {
      success: true,
      data: {
        favorites: typedFavorites.map((f) => ({
          favoriteId: f.id,
          productId: f.product.id,
          productName: f.product.name,
          productImage: f.product.images?.[0] || null,
          addedAt: f.createdAt,
        })),
        totalFavorites: total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async addFavorite(userId: string, productId: string) {
    return this.prisma.favourite.create({
      data: {
        userId,
        productId,
      },
    });
  }

  async removeFavorite(userId: string, productId: string) {
    return this.prisma.favourite.delete({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
    });
  }

  /* account & settings */

  async getVerificationStatus(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      include: { idDocumentUpload: true },
    });
    if (!profile) throw new NotFoundException('Profile not found');

    const maskBvn = (val?: string | null) =>
      val && val.length >= 4 ? `XXXXX${val.slice(-4)}` : null;

    return {
      success: true,
      data: {
        verifications: {
          validId: {
            status: profile.idDocumentUpload ? 'verified' : 'not_verified',
            document: 'Valid ID',
            verifiedDate: profile.idDocumentUpload
              ? profile.idDocumentUpload.createdAt.toISOString()
              : null,
            expiresAt: null,
          },
          bvn: {
            status: profile.bvn ? 'verified' : 'not_verified',
            document: 'Bank Verification Number',
            verifiedDate: null,
            maskedValue: maskBvn(profile.bvn),
          },
        },
      },
    };
  }

  async uploadIdDocument(
    userId: string,
    data: { idDocument: Express.Multer.File; idType: string },
  ) {
    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Profile not found');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const uploadId = `id_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const userForUpload = {
      sub: user.id,
      id: user.id,
      email: user.email,
      isVerified: user.isVerified,
      name: user.name,
      role: user.role,
    };
    const uploaded = await this.uploadService.uploadFile(
      uploadId,
      data.idDocument,
      userForUpload as any,
    );

    const validIdTypes = ['NIN', 'PASSPORT', 'DRIVERS_LICENSE'];
    const idType = data.idType?.toUpperCase() || 'NIN';
    if (!validIdTypes.includes(idType)) {
      throw new BadRequestException(
        'idType must be NIN, PASSPORT, or DRIVERS_LICENSE',
      );
    }

    const updated = await this.prisma.profile.update({
      where: { userId },
      data: {
        idDocumentUpload: { connect: { id: uploaded.id } },
        idDocumentType: idType,
      },
      include: { idDocumentUpload: true },
    });

    return {
      success: true,
      message: 'ID document uploaded successfully',
      data: {
        documentId: updated.idDocumentUpload?.id ?? uploaded.id,
        idType: idType,
        documentUrl: updated.idDocumentUpload?.url ?? null,
        status: 'pending_verification',
        uploadedDate:
          updated.idDocumentUpload?.createdAt.toISOString() ??
          new Date().toISOString(),
        estimatedVerificationTime: '24-48 hours',
      },
    };
  }

  async changePassword(
    userId: string,
    data: {
      currentPassword: string;
      newPassword: string;
      confirmPassword: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // In real implementation, verify current password with argon2
    // const isValid = await argon2.verify(user.password, data.currentPassword);
    // if (!isValid) throw new BadRequestException('Current password is incorrect');

    if (data.newPassword !== data.confirmPassword) {
      throw new BadRequestException('New passwords do not match');
    }

    // Hash new password
    // const hashedPassword = await argon2.hash(data.newPassword);
    // await this.prisma.user.update({
    //   where: { id: userId },
    //   data: { password: hashedPassword },
    // });

    return {
      success: true,
      message: 'Password changed successfully',
      data: {
        passwordChanged: true,
        changedAt: new Date().toISOString(),
      },
    };
  }

  async getNotificationPreferences(userId: string) {
    const notifSettings = await this.prisma.notificationSettings.findUnique({
      where: { userId },
    });

    if (!notifSettings) {
      // Create default settings if not exist
      await this.prisma.notificationSettings.create({
        data: { userId },
      });
    }

    return {
      success: true,
      data: {
        preferences: {
          emailAlerts: {
            enabled: notifSettings?.emailAlertsEnabled ?? true,
            categories: ['orders', 'returns', 'disputes'],
          },
          smsUpdates: {
            enabled: false,
            categories: ['urgent'],
          },
          marketingEmails: {
            enabled: notifSettings?.marketingEmailsEnabled ?? true,
          },
        },
      },
    };
  }

  async updateNotificationPreferences(
    userId: string,
    data: {
      emailAlerts?: boolean;
      smsUpdates?: boolean;
      marketingEmails?: boolean;
    },
  ) {
    let notifSettings = await this.prisma.notificationSettings.findUnique({
      where: { userId },
    });

    if (!notifSettings) {
      notifSettings = await this.prisma.notificationSettings.create({
        data: { userId },
      });
    }

    const updated = await this.prisma.notificationSettings.update({
      where: { userId },
      data: {
        emailAlertsEnabled:
          data.emailAlerts ?? notifSettings.emailAlertsEnabled,
        marketingEmailsEnabled:
          data.marketingEmails ?? notifSettings.marketingEmailsEnabled,
        smsUpdatesEnabled: data.smsUpdates ?? notifSettings.smsUpdatesEnabled,
      },
    });

    return {
      success: true,
      message: 'Notification preferences updated successfully',
      data: {
        preferences: {
          emailAlerts: updated.emailAlertsEnabled,
          smsUpdates: updated.smsUpdatesEnabled,
          marketingEmails: updated.marketingEmailsEnabled,
        },
        savedAt: new Date().toISOString(),
      },
    };
  }

  /* disputes */

  async getDisputeStats(userId: string) {
    const [total, pending, inReview, resolved] = await Promise.all([
      this.prisma.dispute.count({ where: { order: { is: { userId } } } }),
      this.prisma.dispute.count({
        where: { order: { is: { userId } }, status: 'PENDING' },
      }),
      this.prisma.dispute.count({
        where: { order: { is: { userId } }, status: 'IN_REVIEW' },
      }),
      this.prisma.dispute.count({
        where: { order: { is: { userId } }, status: 'RESELOVED' },
      }),
    ]);

    return {
      success: true,
      data: {
        disputeStats: {
          totalDisputes: total,
          pendingDisputes: pending,
          inReviewDisputes: inReview,
          resolvedDisputes: resolved,
          averageResolutionTime: '3 days',
          resolutionRate:
            total > 0 ? `${Math.round((resolved / total) * 100)}%` : '0%',
        },
      },
    };
  }

  async getDisputes(userId: string, query: any) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const skip = (page - 1) * limit;
    const status = query.status || 'all';

    const where: any = { order: { is: { userId } } };
    if (status && status !== 'all') {
      const map: Record<string, string> = {
        pending: 'PENDING',
        in_review: 'IN_REVIEW',
        resolved: 'RESELOVED',
      };
      const mappedStatus = map[status];
      if (mappedStatus) where.status = mappedStatus;
    }

    const [total, disputes] = await this.prisma.$transaction([
      this.prisma.dispute.count({ where }),
      this.prisma.dispute.findMany({
        where,
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

    const items = disputes.map((d: any) => ({
      disputeId: d.disputeId,
      orderId: d.order?.orderId || null,
      itemName: d.order?.orderItems?.[0]?.product?.name || 'Unknown',
      listerName: 'Unknown',
      issueCategory: d.issueCategory,
      status: d.status.toLowerCase(),
      raisedDate: d.createdAt.toISOString(),
      lastUpdated: d.updatedAt.toISOString(),
      priority: 'medium',
    }));

    return {
      success: true,
      data: {
        disputes: items,
        totalDisputes: total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async createDispute(
    userId: string,
    data: {
      orderId: string;
      itemId: string;
      issueCategory: string;
      description: string;
      amountDisputed: number;
      preferredResolution?: string;
      evidenceFiles?: string[];
    },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { orderId: data.orderId },
    });
    if (!order || order.userId !== userId)
      throw new NotFoundException('Order not found');

    const existing = await this.prisma.dispute.findFirst({
      where: { orderId: order.id },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('A dispute already exists for this order');
    }

    const raisedBy = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, role: true },
    });

    const dispute = await this.prisma.dispute.create({
      data: {
        disputeId: `DSP-${Date.now()}`,
        issueCategory: data.issueCategory,
        description: data.description,
        preferredResolution: data.preferredResolution,
        orderId: order.id,
        userId,
        status: 'PENDING',
        chatRooms: { create: {} },
        attachment: createAttachments(data.evidenceFiles),
      },
    });

    await this.prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.IN_DISPUTE },
    });

    const orderWithLister = await this.prisma.order.findUnique({
      where: { id: order.id },
      include: {
        orderListers: true,
        rentals: { select: { curatorId: true } },
        orderItems: {
          take: 1,
          include: { product: { include: { curator: true } } },
        },
      },
    });

    const listerUserId =
      (orderWithLister as any)?.rentals?.[0]?.curatorId ??
      (orderWithLister as any)?.orderItems?.[0]?.product?.curator?.id ??
      (orderWithLister?.orderListers && orderWithLister.orderListers[0]?.listerId) ??
      null;

    const listerUser = listerUserId
      ? await this.prisma.user.findUnique({
          where: { id: listerUserId },
          select: { id: true, name: true, email: true },
        })
      : null;

    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true, name: true, email: true },
    });

    const clientUrl = process.env.CLIENT_URL || '';
    const adminLink = `${clientUrl}/admin/k340eol21/disputes`;

    await Promise.all(
      admins.map((admin) =>
        this.notificationService.createNotification({
          userId: admin.id,
          title: 'New Dispute Created',
          message: `A new dispute ${dispute.disputeId} was created for order ${order.orderId}.`,
          type: 'DISPUTE_CREATED',
          metadata: {
            disputeId: dispute.disputeId,
            disputeDbId: dispute.id,
            orderId: order.id,
            orderNumber: order.orderId,
            raisedByUserId: userId,
          },
          sendEmail: true,
          emailData: {
            email: admin.email,
            adminName: admin.name,
            disputeId: dispute.disputeId,
            orderId: order.orderId,
            raisedByName: raisedBy?.name ?? 'User',
            raisedByRole: raisedBy?.role ?? 'USER',
            category: data.issueCategory,
            description: data.description,
            adminLink,
          },
        }),
      ),
    );

    if (listerUser) {
      const disputeLink = `${clientUrl}/listers/dispute`;
      await this.notificationService.createNotification({
        userId: listerUser.id,
        title: 'New Dispute Created',
        message: `A dispute has been raised for order ${order.orderId}.`,
        type: 'DISPUTE_STATUS',
        metadata: {
          disputeId: dispute.disputeId,
          disputeDbId: dispute.id,
          orderId: order.id,
          orderNumber: order.orderId,
        },
        sendEmail: true,
        emailData: {
          email: listerUser.email,
          userName: listerUser.name,
          disputeId: dispute.disputeId,
          orderId: order.orderId,
          status: 'created',
          category: data.issueCategory,
          description: data.description,
          preferredResolution: dispute.preferredResolution ?? undefined,
          disputeLink,
        },
      });
    }

    return {
      success: true,
      message: 'Dispute raised successfully',
      data: {
        dispute: {
          disputeId: dispute.disputeId,
          orderId: data.orderId,
          status: 'pending_lister_response',
          issueCategory: data.issueCategory,
          raisedDate: dispute.createdAt.toISOString(),
          resolution: null,
        },
      },
    };
  }

  async getDisputeById(userId: string, disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { disputeId },
      include: {
        order: {
          include: {
            orderItems: { include: { product: true } },
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

    if (!dispute || dispute.order?.userId !== userId)
      throw new NotFoundException('Dispute not found');

    return {
      success: true,
      data: {
        dispute: {
          disputeId: dispute.disputeId,
          orderId: dispute.order?.orderId || null,
          itemName: dispute.order?.orderItems?.[0]?.product?.name || null,
          listerName: 'Unknown',
          category: dispute.issueCategory,
          status: dispute.status.toLowerCase(),
          description: dispute.description,
          rentalPrice: 0,
          amountDisputed: 0,
          raisedDate: dispute.createdAt.toISOString(),
          timeline: [
            {
              event: 'dispute_raised',
              date: dispute.createdAt.toISOString(),
            },
          ],
        },
      },
    };
  }

  async getDisputeOverview(userId: string, disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { disputeId },
      include: {
        order: { include: { orderItems: { include: { product: true } } } },
      },
    });

    if (!dispute || dispute.order?.userId !== userId)
      throw new NotFoundException('Dispute not found');

    return {
      success: true,
      data: {
        overview: {
          itemName: dispute.order?.orderItems?.[0]?.product?.name || 'Unknown',
          curator: 'Unknown',
          orderID: dispute.order?.orderId || null,
          category: dispute.issueCategory,
          dateSubmitted: dispute.createdAt.toISOString(),
          preferredResolution: dispute.preferredResolution || 'Full Refund',
          description: dispute.description,
        },
      },
    };
  }

  async getDisputeEvidence(userId: string, disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { disputeId },
      include: { attachment: { include: { uploads: true } }, order: true },
    });

    if (!dispute || dispute.order?.userId !== userId)
      throw new NotFoundException('Dispute not found');

    const files = dispute.attachment?.uploads
      ? dispute.attachment.uploads.map((upload) => ({
          fileId: upload.id,
          fileName: upload.name,
          fileType: upload.type, // Could map to 'image' if needed
          fileUrl: upload.url,
          uploadedDate: upload.createdAt.toISOString(),
        }))
      : [];

    return {
      success: true,
      data: { evidence: { files } },
    };
  }

  async getDisputeTimeline(userId: string, disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { disputeId },
      include: { order: true },
    });

    if (!dispute || dispute.order?.userId !== userId)
      throw new NotFoundException('Dispute not found');

    return {
      success: true,
      data: {
        timeline: {
          events: [
            {
              status: 'Submitted',
              date: dispute.createdAt.toISOString(),
              description: 'Your dispute has been submitted for review',
            },
            {
              status: 'In Review',
              date: new Date().toISOString(),
              description: 'Our team is reviewing your dispute and evidence',
            },
          ],
        },
      },
    };
  }

  async getDisputeResolution(userId: string, disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { disputeId },
      include: { order: true },
    });

    if (!dispute || dispute.order?.userId !== userId)
      throw new NotFoundException('Dispute not found');

    return {
      success: true,
      data: {
        resolution: {
          status:
            dispute.status === 'RESELOVED'
              ? 'Resolved'
              : dispute.status === 'IN_REVIEW'
                ? 'Reviewing'
                : 'Reviewing',
          resolutionDetails:
            dispute.status === 'RESELOVED'
              ? 'Dispute resolved in favor of renter. Full refund approved.'
              : 'Your dispute is currently being reviewed by our team',
          refundAmount: dispute.status === 'RESELOVED' ? 8500 : null,
          refundDate:
            dispute.status === 'RESELOVED' ? new Date().toISOString() : null,
        },
      },
    };
  }

  async getDisputeMessages(userId: string, disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { disputeId },
      include: {
        order: { include: { user: { include: { profile: true } } } },
        chatRooms: {
          include: {
            message: {
              orderBy: { createdAt: 'asc' },
              include: {
                uploads: true,
                sender: { include: { profile: true } },
              },
            },
          },
        },
      },
    });

    if (!dispute || dispute.order?.userId !== userId)
      throw new NotFoundException('Dispute not found');

    const messages: any[] = dispute.chatRooms
      ? dispute.chatRooms.message.map((m: any) => ({
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
            m.uploads?.map((u: any) => ({
              id: u.id,
              url: u.url,
              thumbnailUrl: u.url,
              name: u.name,
              type: u.type,
              size: u.size,
            })) || [],
        }))
      : [];

    return {
      success: true,
      data: { messages },
    };
  }

  async sendDisputeMessage(
    userId: string,
    disputeId: string,
    data: {
      message?: string;
      content?: string;
      attachmentUrls?: string[];
      uploadIds?: string[];
      mediaIds?: string[];
    },
  ) {
    const messageContent = data.message || data.content;
    const fileIds =
      data.uploadIds || data.mediaIds || data.attachmentUrls || [];
    if (!messageContent?.trim() && fileIds.length === 0) {
      throw new BadRequestException('Message content cannot be empty');
    }
    const dispute = await this.prisma.dispute.findUnique({
      where: { disputeId },
      include: {
        chatRooms: true,
        order: {
          include: {
            user: { include: { profile: true } },
            rentals: { include: { curator: { include: { profile: true } } } },
          },
        },
      },
    });

    if (!dispute || dispute.order?.userId !== userId)
      throw new NotFoundException('Dispute not found');

    let room = dispute.chatRooms;
    if (!room) {
      room = await this.prisma.chatRoom.create({
        data: {
          disputeId: dispute.id,
        },
      });
    }

    const msg = await this.prisma.message.create({
      data: {
        senderId: userId,
        senderRole: 'renter',
        content: messageContent || '',
        chatRoomId: room.id,
        uploads: fileIds.length
          ? { connect: fileIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { uploads: true, sender: { include: { profile: true } } },
    });

    const lister = (dispute as any).order?.rentals?.[0]?.curator;
    if (lister?.id && lister.id !== userId) {
      const senderName =
        msg.sender?.profile?.fullName ||
        msg.sender?.profile?.businessName ||
        msg.sender?.name ||
        'Someone';
      const recipientName =
        lister.profile?.fullName ||
        lister.profile?.businessName ||
        lister.name ||
        'Lister';
      const clientUrl = process.env.CLIENT_URL || '';
      const threadLink = clientUrl
        ? `${clientUrl}/listers/dispute#${disputeId}`
        : undefined;
      const preview =
        (messageContent || '').trim() ||
        (fileIds.length ? 'Sent an attachment' : '');
      await this.notificationService.createNotification({
        userId: lister.id,
        title: 'New message',
        message: `${senderName} sent you a new message.`,
        type: 'DISPUTE_MESSAGE',
        metadata: {
          disputeId,
          orderId: (dispute as any).order?.orderId,
          chatRoomId: room.id,
          messageId: msg.id,
          senderId: userId,
        },
        sendEmail: true,
        emailData: {
          email: lister.email,
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

    return {
      success: true,
      message: 'Message sent successfully',
      data: {
        messageId: msg.id,
        createdBy: 'renter',
        senderId: msg.senderId,
        sender: {
          id: msg.senderId,
          name:
            msg.sender?.profile?.fullName ||
            msg.sender?.profile?.businessName ||
            null,
          avatarUrl: msg.sender?.profile?.avatar || null,
          role: 'renter',
        },
        type: 'user',
        content: msg.content,
        timestamp: msg.createdAt.toISOString(),
        attachments:
          msg.uploads?.map((u) => ({
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

  async getOrderProgress(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderId },
      select: {
        userId: true,
        status: true,
        totalAmountPaid: true,
        listingType: true,
        createdAt: true,
        approvedAt: true,
        dispatchedAt: true,
        deliveredAt: true,
        returnDueAt: true,
        updatedAt: true,
        rentals: { select: { returnedAt: true } },
        returnRequests: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            status: true,
            trackingNumber: true,
            shipmentId: true,
            pickupWindowStart: true,
            pickupWindowEnd: true,
            pickupScheduledAt: true,
          },
        },
        shipments: {
          orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
          select: {
            id: true,
            type: true,
            status: true,
            listerId: true,
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

    if (!order || order.userId !== userId)
      throw new NotFoundException('Order not found');

    const status = order.status;
    if (
      status === OrderStatus.CANCELLED ||
      status === OrderStatus.REJECTED
    ) {
      return {
        success: true,
        data: {
          timeline: [
            {
              milestone: 'order_placed',
              label: 'Order placed',
              timestamp: order.createdAt.toISOString(),
              status: 'completed' as const,
              description: 'Your order was created',
            },
            {
              milestone: 'cancelled',
              label: 'Cancelled',
              timestamp: order.updatedAt.toISOString(),
              status: 'current' as const,
              description:
                status === OrderStatus.REJECTED
                  ? 'This order was declined'
                  : 'This order was cancelled',
            },
          ],
          currentMilestone: 'cancelled',
          percentComplete: 100,
          returnScheduling: null,
          returnLeg: null,
        },
      };
    }

    const resale = order.listingType === ListingType.RESALE;

    const outboundShipments = (order.shipments ?? []).filter(
      (s) => s.type === 'OUTBOUND',
    );
    const returnShipmentsProg = (order.shipments ?? []).filter(
      (s) => s.type === 'RETURN',
    );

    const rank = resale
      ? renterProgressRank(
          renterDisplayOrderStatus(status, order.totalAmountPaid),
        )
      : computeRentalTimelineRank(
          status,
          order.totalAmountPaid,
          outboundShipments,
        );
    const returnedAt =
      order.rentals?.length > 0
        ? order.rentals.reduce(
            (latest: Date | null, r: { returnedAt: Date | null }) => {
              if (!r.returnedAt) return latest;
              if (!latest || r.returnedAt > latest) return r.returnedAt;
              return latest;
            },
            null as Date | null,
          )
        : null;

    type MilestoneRow = {
      milestone: string;
      label: string;
      description: string;
      doneAtRank: number;
      timestamp: Date | null;
    };

    const milestones: MilestoneRow[] = resale
      ? [
          {
            milestone: 'order_placed',
            label: 'Order placed',
            description: 'Your purchase is confirmed',
            doneAtRank: 0,
            timestamp: order.createdAt,
          },
          {
            milestone: 'shipped',
            label: 'Shipped',
            description: 'Seller has booked dispatch; item is on the way',
            doneAtRank: 2,
            timestamp: order.dispatchedAt,
          },
          {
            milestone: 'delivered',
            label: 'Delivered',
            description: 'Carrier shows delivery completed',
            doneAtRank: 4,
            timestamp: order.deliveredAt,
          },
          {
            milestone: 'completed',
            label: 'Completed',
            description: 'Order is fully closed',
            doneAtRank: 8,
            timestamp: null,
          },
        ]
      : [
          {
            milestone: 'lister_accepted',
            label: 'Lister accepted',
            description: 'The lister approved your rental dates.',
            doneAtRank: 1,
            timestamp: order.approvedAt,
          },
          {
            milestone: 'rental_confirmed',
            label: 'Rental confirmed',
            description:
              'Your payment went through and your booking is confirmed.',
            doneAtRank: 2,
            timestamp: order.createdAt,
          },
          {
            milestone: 'preparing_dispatch',
            label: 'Processing order',
            description:
              'We are confirming pickup slots with carriers for each seller. Nothing has shipped yet.',
            doneAtRank: 3,
            timestamp: null,
          },
          {
            milestone: 'in_transit',
            label: 'In transit',
            description:
              'Carrier pickup is booked with Topship and your item is on the way.',
            doneAtRank: 4,
            timestamp: order.dispatchedAt,
          },
          {
            milestone: 'with_you',
            label: 'With you',
            description: 'Rental period is active. Enjoy your rental.',
            doneAtRank: 5,
            timestamp: order.deliveredAt,
          },
          {
            milestone: 'return_due',
            label: 'Return',
            description:
              'Return the item by the due date. When you are ready, start a return in the app to schedule pickup if needed.',
            doneAtRank: 6,
            timestamp: order.returnDueAt,
          },
          {
            milestone: 'returned',
            label: 'Returned',
            description:
              'The carrier shows the item delivered back to the lister, or the lister has confirmed receipt.',
            doneAtRank: 7,
            timestamp: returnedAt,
          },
        ];

    const latestRrProg = order.returnRequests?.[0];
    const progReturnShipments = returnShipmentsProg;
    const latestProgReturnLeg =
      progReturnShipments.length > 0
        ? progReturnShipments[progReturnShipments.length - 1]
        : null;
    const unifiedProgWindow = resolveReturnWindowForDisplay({
      returnShipment: latestProgReturnLeg,
      returnRequest: latestRrProg,
    });
    const returnSchedulingProg =
      latestRrProg &&
      (latestRrProg.pickupWindowStart ||
        latestRrProg.pickupWindowEnd ||
        latestRrProg.trackingNumber ||
        latestRrProg.shipmentId)
        ? {
            requestStatus: latestRrProg.status,
            trackingNumber: latestRrProg.trackingNumber ?? null,
            pickupWindowStart:
              unifiedProgWindow?.start.toISOString() ??
              latestRrProg.pickupWindowStart?.toISOString() ??
              null,
            pickupWindowEnd:
              unifiedProgWindow?.end.toISOString() ??
              latestRrProg.pickupWindowEnd?.toISOString() ??
              null,
            pickupScheduledAt:
              latestRrProg.pickupScheduledAt?.toISOString() ?? null,
            summary:
              unifiedProgWindow?.summary ??
              (latestRrProg.pickupWindowStart && latestRrProg.pickupWindowEnd
                ? formatPickupWindowLagos(
                    new Date(latestRrProg.pickupWindowStart),
                    new Date(latestRrProg.pickupWindowEnd),
                  )
                : null),
          }
        : null;

    const returnLegProg = latestProgReturnLeg
      ? {
          status: latestProgReturnLeg.status,
          label: returnLegStatusLabel(String(latestProgReturnLeg.status)),
          trackingId: latestProgReturnLeg.trackingId ?? null,
          providerTrackingUrl: latestProgReturnLeg.providerTrackingUrl ?? null,
          windowSummary:
            unifiedProgWindow?.summary ??
            (latestProgReturnLeg.scheduledWindowStart &&
            latestProgReturnLeg.scheduledWindowEnd
              ? formatPickupWindowLagos(
                  new Date(latestProgReturnLeg.scheduledWindowStart),
                  new Date(latestProgReturnLeg.scheduledWindowEnd),
                )
              : null),
        }
      : null;

    const listerIdsForOutbound = [
      ...new Set(
        outboundShipments
          .map((s) => s.listerId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const listerNameById = new Map<string, string>();
    if (listerIdsForOutbound.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: listerIdsForOutbound } },
        select: {
          id: true,
          name: true,
          profile: { select: { fullName: true, businessName: true } },
        },
      });
      for (const u of users) {
        const label =
          u.profile?.businessName?.trim() ||
          u.profile?.fullName?.trim() ||
          u.name?.trim() ||
          'Seller';
        listerNameById.set(u.id, label);
      }
    }

    const outboundLegsPayload =
      resale || outboundShipments.length === 0
        ? []
        : outboundShipments.map((s) => ({
            shipmentId: s.id,
            listerId: s.listerId,
            listerName: s.listerId
              ? listerNameById.get(s.listerId) ?? null
              : null,
            status: s.status,
            scheduledDate: s.scheduledDate.toISOString(),
            windowSummary:
              s.scheduledWindowStart && s.scheduledWindowEnd
                ? formatPickupWindowLagos(
                    new Date(s.scheduledWindowStart),
                    new Date(s.scheduledWindowEnd),
                  )
                : null,
            trackingId: s.trackingId,
            providerTrackingUrl: s.providerTrackingUrl,
            isBooked: OUTBOUND_BOOKED_STATUSES.has(s.status),
          }));

    const outboundSummary =
      resale || outboundShipments.length === 0
        ? { total: 0, bookedCount: 0 }
        : {
            total: outboundShipments.length,
            bookedCount: outboundShipments.filter((s) =>
              OUTBOUND_BOOKED_STATUSES.has(s.status),
            ).length,
          };

    if (rank === -1) {
      return {
        success: true,
        data: {
          timeline: milestones.map((m) => ({
            milestone: m.milestone,
            label: m.label,
            timestamp: m.timestamp?.toISOString() ?? null,
            status: 'pending' as const,
            description: m.description,
          })),
          currentMilestone: milestones[0].milestone,
          percentComplete: 0,
          returnScheduling: returnSchedulingProg,
          returnLeg: returnLegProg,
          outboundLegs: outboundLegsPayload,
          outboundSummary,
        },
      };
    }

    let currentMilestone = milestones[milestones.length - 1].milestone;
    let completedSteps = 0;

    let timeline = milestones.map((m, i) => {
      const done = rank >= m.doneAtRank;
      const prevDone = i === 0 ? true : rank >= milestones[i - 1].doneAtRank;
      let rowStatus: 'completed' | 'current' | 'pending';
      if (done) {
        rowStatus = 'completed';
        completedSteps += 1;
      } else if (prevDone) {
        rowStatus = 'current';
        currentMilestone = m.milestone;
      } else {
        rowStatus = 'pending';
      }
      let ts: Date | null = m.timestamp;
      if (done && !ts && m.milestone === 'completed' && resale) {
        ts = order.updatedAt;
      }
      if (done && !ts && m.milestone === 'returned' && !resale) {
        ts = returnedAt ?? order.updatedAt;
      }
      const showTs = done || rowStatus === 'current';
      return {
        milestone: m.milestone,
        label: m.label,
        timestamp: showTs && ts ? ts.toISOString() : null,
        status: rowStatus,
        description: m.description,
      };
    });

    const allDone = completedSteps === milestones.length;
    const percentComplete = allDone
      ? 100
      : Math.round((completedSteps / (milestones.length - 1)) * 100);

    if (
      !resale &&
      returnSchedulingProg?.summary &&
      timeline.some((t) => t.milestone === 'return_due')
    ) {
      const idx = timeline.findIndex((t) => t.milestone === 'return_due');
      if (idx >= 0) {
        timeline[idx] = {
          ...timeline[idx],
          description: `${timeline[idx].description} Your return pickup window: ${returnSchedulingProg.summary}.`,
        };
      }
    }

    if (
      !resale &&
      outboundSummary.total > 1 &&
      timeline.some((t) => t.milestone === 'preparing_dispatch')
    ) {
      const idxPrep = timeline.findIndex(
        (t) => t.milestone === 'preparing_dispatch',
      );
      if (idxPrep >= 0 && timeline[idxPrep].status === 'current') {
        timeline[idxPrep] = {
          ...timeline[idxPrep],
          description: `${timeline[idxPrep].description} Carrier bookings: ${outboundSummary.bookedCount} of ${outboundSummary.total} seller shipments.`,
        };
      }
    }

    return {
      success: true,
      data: {
        timeline,
        currentMilestone: allDone
          ? milestones[milestones.length - 1].milestone
          : currentMilestone,
        percentComplete,
        returnScheduling: returnSchedulingProg,
        returnLeg: returnLegProg,
        outboundLegs: outboundLegsPayload,
        outboundSummary,
      },
    };
  }

  async initiateReturn(userId: string, orderId: string, data: any) {
    const order = await this.prisma.order.findUnique({
      where: { orderId },
    });

    if (!order || order.userId !== userId)
      throw new NotFoundException('Order not found');

    return {
      success: true,
      message: 'Return initiated successfully',
      data: {
        orderId,
        returnTrackingId: `RTN-${Date.now()}`,
        returnMethod: data.returnMethod || 'pickup',
        returnDate: data.returnDate,
        returnDeadline: addMinutes(new Date(data.returnDate), 72).toISOString(),
        pickupInfo: {
          address: '123 Fashion Lane, Lagos',
          phone: '+234 907 123 4567',
          instructions: 'Please have item ready for pickup',
        },
        returnShippingLabel: null,
        status: 'return_initiated',
        initiatedAt: new Date().toISOString(),
      },
    };
  }

  async readyToReturn(
    userId: string,
    orderId: string,
    files: Express.Multer.File[],
    data: any,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { orderId }, // Use orderId mapping
      include: {
        returnRequests: true,
        orderItems: { include: { product: true } },
        shipments: {
          where: { type: 'RETURN' },
          orderBy: [{ scheduledWindowStart: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.userId !== userId) {
      throw new BadRequestException('Unauthorized to return this order');
    }

    if (order.returnRequests && order.returnRequests.length > 0) {
      throw new BadRequestException(
        'Return request already exists for this order',
      );
    }

    // Block return requests for purchase orders (rentalDays=0)
    const isPurchaseOrder = (order.orderItems as any[]).some(
      (item) => item.days === 0,
    );
    if (isPurchaseOrder) {
      throw new BadRequestException(
        'Return requests are not available for purchase orders',
      );
    }

    const imageUrls: string[] = [];
    if (files && files.length > 0) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      for (const file of files) {
        const upload = await this.uploadService.uploadFile(
          randomUUID(),
          file,
          user as any,
        );
        imageUrls.push(upload.url);
      }
    }

    let returnShipmentId = data.shipmentId ?? null;
    if (returnShipmentId) {
      const onOrder = order.shipments?.some((s) => s.id === returnShipmentId);
      if (!onOrder) {
        throw new BadRequestException('Invalid shipment ID for this order');
      }
    } else if (order.shipments?.length) {
      returnShipmentId = order.shipments[0].id;
    }

    if (returnShipmentId) {
      const shipment = await this.prisma.shipment.findUnique({
        where: { id: returnShipmentId },
      });
      if (!shipment || shipment.orderId !== order.id) {
        throw new BadRequestException('Invalid shipment ID for this order');
      }
    }

    const [returnRequest] = await this.prisma.$transaction([
      this.prisma.returnRequest.create({
        data: {
          orderId: order.id,
          shipmentId: returnShipmentId,
          itemCondition: (data.itemCondition || 'GOOD').toUpperCase(),
          damageNotes: data.damageNotes,
          imageUrls,
        },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: 'RETURN_DUE',
          returnDueAt: new Date(),
        },
      }),
    ]);

    return {
      success: true,
      message: 'Return request submitted successfully',
      data: returnRequest,
    };
  }

  async getReturnRequest(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderId },
      include: {
        returnRequests: true,
        orderItems: {
          include: {
            product: {
              include: { attachments: { include: { uploads: true } } },
            },
          },
        },
      },
    });

    if (!order || order.userId !== userId) {
      throw new NotFoundException('Order not found or access denied');
    }

    if (!order.returnRequests || order.returnRequests.length === 0) {
      throw new NotFoundException('No return request found for this order');
    }

    return {
      success: true,
      data: {
        ...order.returnRequests[0],
        orderStatus: order.status,
        items: order.orderItems.map((oi: any) => ({
          id: oi.product.id,
          name: oi.product.name,
          image: oi.product.attachments?.uploads?.[0]?.url || null,
        })),
      },
    };
  }

  async getReturnShippingRates(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderId },
      include: {
        user: { include: { profile: { include: { address: true } } } },
        orderItems: {
          include: {
            product: {
              include: {
                curator: {
                  include: {
                    profile: { include: { businessInfo: true, address: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order || order.userId !== userId) {
      throw new NotFoundException('Order not found');
    }

    const renterProfile = order.user.profile;
    const firstItem = order.orderItems[0];
    const curatorProfile = firstItem.product.curator.profile;
    const curatorBusiness = curatorProfile?.businessInfo;
    const curatorAddress = curatorProfile?.address;

    const senderCity = renterProfile?.address?.city || 'Lagos';
    const receiverCity =
      curatorBusiness?.businessCity || curatorAddress?.city || 'Lagos';

    const ratePayload = {
      senderDetail: {
        addressLine1: renterProfile?.address?.street || 'Lagos, Nigeria',
        addressLine2: '',
        country: 'Nigeria',
        countryCode: 'NG',
        state: renterProfile?.address?.state || 'Lagos',
        city: senderCity,
      },
      receiverDetail: {
        addressLine1:
          curatorBusiness?.businessAddress ||
          curatorAddress?.street ||
          'Lagos, Nigeria',
        addressLine2: '',
        country: 'Nigeria',
        countryCode: 'NG',
        state: curatorAddress?.state || 'Lagos',
        city: receiverCity,
      },
      itemDetail: {
        packageType: 'Parcel',
        weight: 1,
        items: order.orderItems.map((oi) => ({
          category: 'ClothingAndTextile',
          description: topshipProductDetailLine(oi.product),
          weight: 1,
          quantity: 1,
          value:
            (oi.product.resalePrice || oi.product.originalValue || 10000) * 100,
        })),
      },
    };

    try {
      const rates = await this.topshipService.getShipmentRate(ratePayload);
      return {
        success: true,
        data: rates,
      };
    } catch (error) {
      console.error('[RentersService] Error fetching return rates:', error);
      throw new InternalServerErrorException('Failed to fetch shipping rates');
    }
  }

  async processReturnWithShipping(
    userId: string,
    orderId: string,
    data: CreateReturnRequestDto,
  ) {
    console.log(
      `[RentersService] Processing return request for order ${orderId}`,
    );
    const order = await this.prisma.order.findUnique({
      where: { orderId },
      include: {
        orderItems: {
          include: {
            product: {
              include: {
                curator: {
                  include: {
                    profile: {
                      include: { businessInfo: true, address: true },
                    },
                  },
                },
              },
            },
          },
        },
        user: {
          include: {
            profile: {
              include: { address: true },
            },
          },
        },
        returnRequests: true,
        shipments: true,
      },
    });

    if (!order) {
      console.log(`[RentersService] Order ${orderId} not found`);
      throw new NotFoundException('Order not found');
    }

    if (order.userId !== userId) {
      console.log(
        `[RentersService] User ${userId} not authorized for order ${orderId}`,
      );
      throw new BadRequestException('Not authorized to return this order');
    }

    if (order.returnRequests && order.returnRequests.length > 0) {
      console.log(
        `[RentersService] Return request already exists for order ${orderId}`,
      );
      throw new BadRequestException(
        'Return request already exists for this order',
      );
    }

    // Block return requests for purchase orders (only if ALL items are purchases, not mixed orders)
    const isPurchaseOrder = (order.orderItems as any[]).every(
      (item: any) => item.days === 0,
    );
    if (isPurchaseOrder) {
      console.log(
        `[RentersService] Purchase order ${orderId} cannot be returned`,
      );
      throw new BadRequestException(
        'Return requests are not available for purchase orders',
      );
    }

    const pickupWindow = this.resolveReturnPickupWindow(data.pickupWindow);

    let returnShipmentRow = this.resolveReturnShipmentLeg(
      order.shipments as any[],
      {
        shipmentId: data.shipmentId,
        pickupWindow,
      },
    );
    if (!returnShipmentRow) {
      returnShipmentRow = await this.prisma.shipment.findFirst({
        where: { orderId: order.id, type: 'RETURN' },
        orderBy: [{ scheduledWindowStart: 'asc' }, { createdAt: 'asc' }],
      });
    }

    const fromCheckout = returnShipmentRow
      ? selectedRateFromCheckoutReturnShipment(returnShipmentRow)
      : null;
    /** New flow: pricing tier + charges were chosen and paid at checkout — never require a fresh rate quote here. */
    const selectedRate =
      fromCheckout ?? data.selectedRate ?? null;
    if (!selectedRate) {
      bad(
        'Return shipping for this order is missing. For older orders, contact support.',
      );
    }

    // Upload images if provided
    const imageUrls: string[] = [];
    if (data.images && data.images.length > 0) {
      for (const imageId of data.images) {
        const upload = await this.prisma.upload.findUnique({
          where: { id: imageId },
        });
        if (upload) {
          imageUrls.push(upload.url);
        }
      }
    }

    // Get lister's address for pickup
    const listerForAddress = order.orderItems[0]?.product?.curator;
    const listerAddress = listerForAddress?.profile?.address
      ? `${listerForAddress.profile.address.street}, ${listerForAddress.profile.address.city}, ${listerForAddress.profile.address.state}`
      : '';

    const renterAddress = order.user.profile?.address
      ? `${order.user.profile.address.street}, ${order.user.profile.address.city}, ${order.user.profile.address.state}`
      : '';

    // Check if pickup window is scheduled for today to determine if we should book immediately
    const today = new Date();
    const pickupDate = new Date(pickupWindow.start);
    const isSameDay = today.toDateString() === pickupDate.toDateString();
    const shouldBookImmediately = isSameDay;

    console.log(
      `[RentersService] Pickup window date: ${pickupDate.toDateString()}, today: ${today.toDateString()}, booking immediately: ${shouldBookImmediately}`,
    );

    const toKobo = (amount: number | undefined | null) => {
      const value = Number(amount || 0);
      if (!Number.isFinite(value) || value <= 0) return 0;
      if (value > 100000) return Math.round(value);
      return Math.round(value * 100);
    };

    // Topship internal shipment row id (not Prisma Shipment.id)
    let topshipProviderShipmentId: string | null = null;
    let topshipTrackingNumber: string | null = null;
    let pickupScheduledAt: Date | null = pickupWindow.start;

    if (shouldBookImmediately) {
      try {
        console.log(
          `[RentersService] Booking Topship pickup for order ${orderId}`,
        );

      const firstItem = order.orderItems[0];
      const curatorProfile = firstItem.product.curator.profile;
      const curatorBusiness = curatorProfile?.businessInfo;
      const curatorAddress = curatorProfile?.address;

      const listerCity =
        curatorBusiness?.businessCity || curatorAddress?.city || 'Lagos';
      const renterCity = order.user.profile?.address?.city || 'Lagos';

      const value = order.orderItems.reduce(
        (acc: number, i: any) =>
          acc + (i.product.resalePrice || i.product.originalValue || 0),
        0,
      );

      const shipmentPayload = {
        shipment: [
          {
            senderDetail: {
              name: order.user.name || 'Renter',
              phoneNumber: order.user.profile?.phoneNumber || '08000000000',
              email: order.user.email || 'renter@relisted.com',
              city: renterCity,
              state: order.user.profile?.address?.state || 'Lagos',
              countryCode: 'NG',
              addressLine1: renterAddress || 'Lagos, Nigeria',
              country: 'Nigeria',
              postalCode: order.user.profile?.address?.zipCode || '1111202',
            },
            receiverDetail: {
              name:
                curatorBusiness?.businessName || firstItem.product.curator.name,
              phoneNumber:
                curatorBusiness?.businessPhone ||
                curatorProfile?.phoneNumber ||
                '08000000000',
              email:
                curatorBusiness?.businessEmail ||
                firstItem.product.curator.email ||
                'lister@relisted.com',
              city: listerCity,
              state: curatorAddress?.state || 'Lagos',
              countryCode: 'NG',
              addressLine1: listerAddress || 'Lagos, Nigeria',
              country: 'Nigeria',
              postalCode: curatorAddress?.zipCode,
            },
            pricingTier: selectedRate.pricingTier,
            insuranceType: 'None',
            itemCollectionMode: 'PickUp',
            shipmentRoute: 'Domestic',
            insuranceCharge: 0,
            shipmentCharge: toKobo(selectedRate.shipmentCharge),
            // Topship save-shipment: only pickupDate; pickupWindow is kept on ReturnRequest below.
            pickupDate: pickupWindow.start.toISOString(),
            pickupId: `RETURN-PICKUP-${Date.now()}`,
            pickupPartner: selectedRate.pickupPartner,
            pickupCharge: toKobo(selectedRate.pickupCharge),
            valueAddedTaxCharge: toKobo(selectedRate.vatCharge),
            discount: 0,
            deliveryLocation: listerAddress || 'Lagos, Nigeria',
            items: [
              {
                category: 'ClothingAndTextile',
                description: topshipCombinedOrderItemsDescription(
                  order.orderItems as any[],
                  TOPSHIP_DESCRIPTION_MAX_LEN,
                  'Relisted return shipment',
                ),
                weight: 1,
                quantity: order.orderItems.length,
                value: Number(value) * 100 || 1000000,
              },
            ],
          },
        ],
      };

      const shipmentResult =
        await this.topshipService.bookShipmentAsDraft(shipmentPayload);

      const responseData = shipmentResult?.[0] || shipmentResult?.data?.[0];
      if (responseData?.id || responseData?.shipmentId) {
        topshipProviderShipmentId =
          responseData?.id || responseData?.shipmentId;
        topshipTrackingNumber =
          responseData?.trackingId || responseData?.trackingNumber;
        pickupScheduledAt = pickupWindow.start;
        console.log(
          `[RentersService] Topship shipment booked: ${topshipProviderShipmentId}, tracking: ${topshipTrackingNumber}`,
        );

        // Trigger Payment for the return shipment
        if (topshipProviderShipmentId) {
          console.log(
            `[RentersService] Paying for return shipment ${topshipProviderShipmentId}...`,
          );
          try {
            await this.topshipService.payForShipment(topshipProviderShipmentId);
            console.log(
              `[RentersService] Return shipment ${topshipProviderShipmentId} paid successfully.`,
            );
          } catch (payErr: any) {
            console.error(
              `[RentersService] Payment for return shipment ${topshipProviderShipmentId} failed:`,
              payErr.message,
            );
          }
        }
      } else {
        console.warn(
          `[RentersService] Failed to book Topship shipment, continuing without shipping. Response:`,
          JSON.stringify(shipmentResult),
        );
      }
    } catch (error) {
      console.error(`[RentersService] Error booking Topship shipment:`, error);
      console.warn(
        `[RentersService] Continuing with return request without shipping`,
      );
    }
    } else {
      console.log(
        `[RentersService] Pickup window is not scheduled for today, skipping immediate booking. Return request will be created and shipment will be booked by cron when due.`,
      );
    }

    // Process in transaction
    console.log(`[RentersService] Starting transaction for order ${orderId}`);
    const result = await this.prisma.$transaction(async (tx) => {
      const returnLeg = returnShipmentRow
        ? await tx.shipment.findUnique({
            where: { id: returnShipmentRow.id },
          })
        : await tx.shipment.findFirst({
            where: { orderId: order.id, type: 'RETURN' },
            orderBy: [{ scheduledWindowStart: 'asc' }, { createdAt: 'asc' }],
          });

      if (returnLeg && topshipProviderShipmentId) {
        await tx.shipment.update({
          where: { id: returnLeg.id },
          data: {
            providerShipmentId: topshipProviderShipmentId,
            trackingId: topshipTrackingNumber,
            providerTrackingUrl: 'https://ship.topship.africa/tracking',
            status: 'DISPATCHED',
            dispatchedAt: new Date(),
            shipmentCharge: toKobo(selectedRate.shipmentCharge),
            pickupCharge: toKobo(selectedRate.pickupCharge),
            vatCharge: toKobo(selectedRate.vatCharge),
            pricingTier: selectedRate.pricingTier,
            pickupPartner: selectedRate.pickupPartner,
          },
        });
      }

      const prismaReturnShipmentId = returnLeg?.id ?? null;

      const returnRequest = await tx.returnRequest.create({
        data: {
          orderId: order.id,
          itemCondition: data.itemCondition.toUpperCase() as any,
          damageNotes: data.damageNotes,
          imageUrls,
          status: 'PENDING_PICKUP',
          shipmentId: prismaReturnShipmentId,
          trackingNumber: topshipTrackingNumber,
          pickupAddress: renterAddress,
          pickupScheduledAt,
          pickupWindowStart: pickupWindow.start,
          pickupWindowEnd: pickupWindow.end,
        },
      });
      console.log(
        `[RentersService] Return request created for order ${orderId} with ID ${returnRequest.id}`,
      );

      // Update order status and return tracking info
      await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'RETURN_DUE',
          returnDueAt: new Date(),
        },
      });

      return returnRequest;
    });
    console.log(
      `[RentersService] Transaction completed successfully for order ${orderId}`,
    );

    try {
      await syncOrderStatusFromShipments(this.prisma, order.id);
    } catch (syncErr: any) {
      console.warn(
        `[RentersService] Order shipment sync after return booking failed for ${order.id}: ${syncErr?.message ?? syncErr}`,
      );
    }

    const rr = result;
    const returnShipRow =
      (order.shipments as any[])?.find((s) => s.id === rr.shipmentId) ??
      this.resolveReturnShipmentLeg(order.shipments as any[], {
        shipmentId: null,
        pickupWindow,
      });
    const unifiedAfterReturn = resolveReturnWindowForDisplay({
      returnShipment: returnShipRow,
      returnRequest: rr,
    });
    const returnWindowSummary = unifiedAfterReturn?.summary;
    const windowSummary = returnWindowSummary ?? null;

    const clientUrl = process.env.CLIENT_URL || '';
    const listerOrderPageUrl = clientUrl
      ? `${clientUrl}/listers/orders/${order.id}`
      : '';

    // Notify all listers about return (for multi-lister orders)
    const uniqueListers = new Map(
      order.orderItems
        .map((item: any) => item.product?.curator)
        .filter((curator: any) => curator)
        .map((curator: any) => [curator.id, curator]),
    );

    for (const lister of uniqueListers.values()) {
      await this.notificationService.createNotification({
        userId: lister.id,
        title: 'Return started',
        message: `Return started for order ${order.orderId}. Check your email for the window and condition.`,
        type: 'RETURN_INITIATED',
        metadata: {
          orderId: order.id,
          orderNumber: order.orderId,
          returnRequestId: result.id,
        },
        sendEmail: true,
        emailData: {
          email: lister.email,
          curatorName:
            lister.profile?.businessInfo?.businessName || lister.name,
          renterName: order.user.name,
          renterEmail: order.user.email,
          renterPhone: order.user.profile?.phoneNumber || '',
          renterAddress: order.user.profile?.address
            ? `${order.user.profile.address.street}, ${order.user.profile.address.city}, ${order.user.profile.address.state}`
            : '',
          orderId: order.orderId,
          itemCondition: data.itemCondition,
          damageNotes: data.damageNotes,
          platformName: 'Relisted',
          returnWindowSummary,
          orderPageUrl: listerOrderPageUrl || undefined,
        },
      });
    }

    await this.notificationService.createNotification({
      userId: order.userId,
      title: topshipProviderShipmentId
        ? 'Return pickup scheduled'
        : 'Return request submitted',
      message: windowSummary
        ? `Your carrier pickup is scheduled for: ${windowSummary}. Have your item ready during this window. You will get another update when the rider collects the package.`
        : topshipProviderShipmentId
          ? 'Your return has been booked with the carrier. You will get another update when pickup starts.'
          : shouldBookImmediately
            ? 'Your return request has been submitted. We will book your return shipment when the pickup window approaches.'
            : 'Your return request has been submitted. We will book your return shipment closer to the return date.',
      type: topshipProviderShipmentId
        ? 'RETURN_PICKUP_SCHEDULED'
        : 'RETURN_REQUEST_SUBMITTED',
      metadata: {
        orderId: order.orderId,
        returnRequestId: rr.id,
      },
      sendEmail: true,
      emailData: {
        email: order.user.email,
        userName: order.user.name,
        orderId: order.orderId,
        status: topshipProviderShipmentId
          ? 'Return pickup scheduled (not collected yet)'
          : 'Return request submitted',
        emailSubject: topshipProviderShipmentId
          ? 'Return pickup scheduled'
          : 'Return request submitted',
        emailHeading: topshipProviderShipmentId
          ? 'Return pickup scheduled'
          : 'Return request submitted',
        trackingNumber: topshipTrackingNumber ?? undefined,
        pickupWindowSummary: windowSummary ?? undefined,
        extraNote: topshipProviderShipmentId
          ? 'The carrier is booked for your pickup window. The package is not yet on the way to the lister until you see an in-transit update.'
          : !isSameDay
            ? 'Shipping was paid at checkout. We’ll confirm pickup before your window. Watch for another email once it’s booked.'
            : undefined,
      },
    });

    return {
      success: true,
      message: 'Return request created successfully',
      data: {
        returnRequest: result,
        order: {
          orderId: order.orderId,
          status: 'RETURN_DUE',
        },
      },
    };
  }
}
