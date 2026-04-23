import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../services/prisma/prisma.service';
import { UploadService } from '../upload/upload.service';
import { WemaServiceService } from '../../services/wema-service/wema-service.service';
import { TopshipService } from '../../services/topship/topship.service';
import { randomUUID } from 'crypto';
import { Role } from '@prisma/client';
import { addMinutes } from 'date-fns';
import { createAttachments } from 'prisma/prisma.utils';

import { NotificationService } from '../../services/notification/notification.service';
import { assertNoOpenAvailabilityRequestForProduct } from '../../utils/assert-no-open-availability-for-product';
import { DEFAULT_CLEANING_FEE_NGN } from '../../constants/rental-pricing';
import { bad } from '../../utils/error';
import {
  buildListerWithdrawRentalRequestEmailContext,
  type ListerWithdrawNotify,
} from '../cart-items/withdraw-availability-for-cart-item';

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

  /** PENDING + past expiresAt should read as EXPIRED (same idea as lister order list). */
  private async expireStalePendingAvailabilityRequestsForRequester(
    requesterId: string,
  ) {
    await this.prisma.availabilityRequest.updateMany({
      where: {
        requesterId,
        status: 'PENDING',
        expiresAt: { lte: new Date() },
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
            status: o.status,
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
        user: { include: { profile: { include: { address: true } } } },
      } as any,
    });

    if (!order || order.userId !== userId)
      throw new NotFoundException('Order not found');

    const typedOrder = order as any;
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
    const availRows =
      productIds.length > 0
        ? await this.prisma.availabilityRequest.findMany({
            where: {
              requesterId: userId,
              productId: { in: productIds },
              status: 'ACCEPTED',
            },
            orderBy: { createdAt: 'desc' },
            select: { productId: true, startDate: true, endDate: true },
          })
        : [];
    const availByProduct = new Map<
      string,
      { startDate: Date | null; endDate: Date | null }
    >();
    for (const row of availRows) {
      if (!availByProduct.has(row.productId)) {
        availByProduct.set(row.productId, {
          startDate: row.startDate,
          endDate: row.endDate,
        });
      }
    }

    const rentals: any[] = typedOrder.rentals ?? [];

    return {
      success: true,
      data: {
        order: {
          orderId: typedOrder.orderId,
          status: typedOrder.status,
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
          lister: {
            userId:
              typedOrder.listerId ||
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
            };
          }),
          shippingAddress: typedOrder.user.profile?.address || null,
          tracking: {
            status: typedOrder.status,
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
      this.prisma.dispute.count({ where: { userId } }),
      this.prisma.dispute.count({
        where: { userId, status: 'PENDING' },
      }),
      this.prisma.dispute.count({
        where: { userId, status: 'IN_REVIEW' },
      }),
      this.prisma.dispute.count({
        where: { userId, status: 'RESELOVED' },
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

    const where: any = { userId };
    if (status && status !== 'all') {
      const map: Record<string, string> = {
        pending: 'PENDING',
        in_review: 'IN_REVIEW',
        resolved: 'RESELOVED',
      };
      where.status = map[status] || undefined;
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
      evidenceFiles?: string[];
    },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { orderId: data.orderId },
    });
    if (!order || order.userId !== userId)
      throw new NotFoundException('Order not found');

    const raisedBy = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, role: true },
    });

    const dispute = await this.prisma.dispute.create({
      data: {
        disputeId: `DSP-${Date.now()}`,
        issueCategory: data.issueCategory,
        description: data.description,
        orderId: order.id,
        userId,
        status: 'PENDING',
        chatRooms: { create: {} },
        attachment: createAttachments(data.evidenceFiles),
      },
    });

    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true, name: true, email: true },
    });

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
          },
        }),
      ),
    );

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
        order: { include: { orderItems: { include: { product: true } } } },
        chatRooms: { include: { message: true } },
      },
    });

    if (!dispute || dispute.userId !== userId)
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

    if (!dispute || dispute.userId !== userId)
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
          preferredResolution: 'Full Refund',
          description: dispute.description,
        },
      },
    };
  }

  async getDisputeEvidence(userId: string, disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { disputeId },
      include: { attachment: { include: { uploads: true } } },
    });

    if (!dispute || dispute.userId !== userId)
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
    });

    if (!dispute || dispute.userId !== userId)
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
    });

    if (!dispute || dispute.userId !== userId)
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
        chatRooms: { include: { message: { orderBy: { createdAt: 'asc' } } } },
      },
    });

    if (!dispute || dispute.userId !== userId)
      throw new NotFoundException('Dispute not found');

    const messages: any[] = dispute.chatRooms
      ? dispute.chatRooms.message.map((m: any) => ({
          id: m.id,
          type: m.senderRole === 'admin' ? 'admin' : 'user',
          content: m.content,
          timestamp: m.createdAt.toISOString(),
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
    data: { message: string; attachmentUrls?: string[] },
  ) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { disputeId },
      include: { chatRooms: true },
    });

    if (!dispute || dispute.userId !== userId)
      throw new NotFoundException('Dispute not found');

    if (!dispute.chatRooms)
      throw new BadRequestException('Chat room not initialized');

    const msg = await this.prisma.message.create({
      data: {
        senderId: userId,
        senderRole: 'renter',
        content: data.message,
        chatRoomId: dispute.chatRooms.id,
      },
    });

    return {
      success: true,
      message: 'Message sent successfully',
      data: {
        messageId: msg.id,
        type: 'user',
        content: msg.content,
        timestamp: msg.createdAt.toISOString(),
        attachments: data.attachmentUrls || [],
      },
    };
  }

  async getOrderProgress(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderId },
      include: { rentals: true } as any,
    });

    if (!order || order.userId !== userId)
      throw new NotFoundException('Order not found');

    return {
      success: true,
      data: {
        timeline: [
          {
            milestone: 'order_placed',
            label: 'Order Placed',
            timestamp: order.createdAt.toISOString(),
            status: 'completed',
            description: 'Your rental order has been confirmed',
          },
          {
            milestone: 'in_transit',
            label: 'In Transit',
            timestamp: null,
            status: 'current',
            description: 'Your item is on the way',
          },
          {
            milestone: 'delivered',
            label: 'Delivered',
            timestamp: null,
            status: 'pending',
            description: 'Item will be delivered to you',
          },
        ],
        currentMilestone: 'in_transit',
        percentComplete: 50,
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
        returnRequest: true,
        orderItems: { include: { product: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.userId !== userId) {
      throw new BadRequestException('Unauthorized to return this order');
    }

    if (order.returnRequest) {
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

    const [returnRequest] = await this.prisma.$transaction([
      this.prisma.returnRequest.create({
        data: {
          orderId: order.id,
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
        returnRequest: true,
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

    if (!order.returnRequest) {
      throw new NotFoundException('No return request found for this order');
    }

    return {
      success: true,
      data: {
        ...order.returnRequest,
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
          description: oi.product.name,
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
    data: {
      itemCondition: string;
      damageNotes?: string;
      images?: string[];
      selectedRate?: {
        pickupPartner: string;
        shipmentCharge: number;
        pickupCharge: number;
        vatCharge: number;
        totalCharge: number;
        pricingTier: string;
      };
    },
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
        returnRequest: true,
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

    if (order.returnRequest) {
      console.log(
        `[RentersService] Return request already exists for order ${orderId}`,
      );
      throw new BadRequestException(
        'Return request already exists for this order',
      );
    }

    // Block return requests for purchase orders (only if ALL items are purchases, not mixed orders)
    const isPurchaseOrder = order.orderItems.every(
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

    // Book Topship pickup shipment
    let shipmentId: string | null = null;
    let trackingNumber: string | null = null;
    let pickupScheduledAt: Date | null = null;

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

      const description = order.orderItems
        .map((i: any) => {
          const p = i.product;
          return `${p.brand?.name || ''} ${p.name} (${p.color}, ${p.material || ''}, ${p.measurement}, ${p.category?.name || ''})`.trim();
        })
        .join(', ');

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
            pricingTier:
              order.returnShippingTier ||
              data.selectedRate?.pricingTier ||
              'Budget',
            insuranceType: 'None',
            itemCollectionMode: 'PickUp',
            shipmentRoute: 'Domestic',
            insuranceCharge: 0,
            shipmentCharge:
              (order.returnShippingFee ||
                data.selectedRate?.shipmentCharge ||
                0) * 100, // Convert to Kobo
            pickupId: `RETURN-PICKUP-${Date.now()}`,
            pickupPartner:
              order.returnPickupPartner ||
              data.selectedRate?.pickupPartner ||
              'Standard',
            pickupCharge: (data.selectedRate?.pickupCharge || 0) * 100, // Pickup charge usually separate
            valueAddedTaxCharge: (data.selectedRate?.vatCharge || 0) * 100,
            discount: 0,
            deliveryLocation: listerAddress || 'Lagos, Nigeria',
            items: [
              {
                category: 'ClothingAndTextile',
                description:
                  description.substring(0, 200) || 'Return Clothing Item',
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
        shipmentId = responseData?.id || responseData?.shipmentId;
        trackingNumber =
          responseData?.trackingId || responseData?.trackingNumber;
        pickupScheduledAt = new Date();
        pickupScheduledAt.setHours(pickupScheduledAt.getHours() + 24); // Schedule pickup for 24 hours from now

        console.log(
          `[RentersService] Topship shipment booked: ${shipmentId}, tracking: ${trackingNumber}`,
        );

        // Trigger Payment for the return shipment
        if (shipmentId) {
          console.log(
            `[RentersService] Paying for return shipment ${shipmentId}...`,
          );
          try {
            await this.topshipService.payForShipment(shipmentId);
            console.log(
              `[RentersService] Return shipment ${shipmentId} paid successfully.`,
            );
          } catch (payErr: any) {
            console.error(
              `[RentersService] Payment for return shipment ${shipmentId} failed:`,
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

    // Process in transaction
    console.log(`[RentersService] Starting transaction for order ${orderId}`);
    const result = await this.prisma.$transaction(async (tx) => {
      // Create return request
      const returnRequest = await tx.returnRequest.create({
        data: {
          orderId: order.id,
          itemCondition: data.itemCondition.toUpperCase() as any,
          damageNotes: data.damageNotes,
          imageUrls,
          status: 'PENDING_PICKUP',
          shipmentId,
          trackingNumber,
          pickupAddress: renterAddress,
          pickupScheduledAt,
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
          returnShipmentId: shipmentId,
          returnTrackingId: trackingNumber,
        },
      });

      return returnRequest;
    });
    console.log(
      `[RentersService] Transaction completed successfully for order ${orderId}`,
    );

    // Notify lister about return
    const lister = order.orderItems[0]?.product?.curator;
    if (lister) {
      await this.notificationService.createNotification({
        userId: lister.id,
        title: 'Return Request Initiated',
        message: `A return has been initiated for order ${order.orderId}. Please coordinate pickup with the renter.`,
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
        },
      });
    }

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
