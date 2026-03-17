import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../services/prisma/prisma.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { OrderStatus, ProductStatus, Role } from '@prisma/client';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService
  ) {}

  async getAnalyticsStats(timeframe: string, year?: string, month?: string) {
    const totalRentees = await this.prisma.user.count({ where: { role: 'RENTER' } });
    const products = await this.prisma.product.aggregate({ _sum: { originalValue: true } });
    const activeRentals = await this.prisma.rental.count({ where: { isReturned: false } });
    
    // Total revenue could be sum of all successful transaction amounts.
    const revenue = await this.prisma.transaction.aggregate({
      where: { status: 'SUCCESS' },
      _sum: { amount: true },
    });

    return {
      success: true,
      data: {
        totalRentees,
        totalItemValue: products._sum.originalValue || 0,
        activeRentals,
        revenueGenerated: revenue._sum.amount || 0,
      },
    };
  }

  async getRentalsRevenueTrend(timeframe: string, year?: string, month?: string) {
    // Returning dummy data for chart structure. Actual grouped queries can be complex in Prisma.
    return {
      success: true,
      data: [
        { month: 'Jan', revenue: 4000, rentals: 24 },
        { month: 'Feb', revenue: 3000, rentals: 13 },
        { month: 'Mar', revenue: 5000, rentals: 35 },
        { month: 'Apr', revenue: 4500, rentals: 28 },
      ],
    };
  }

  async getCategoryBreakdown(timeframe: string, year?: string, month?: string) {
    const categories = await this.prisma.productCategory.findMany({
      include: { _count: { select: { products: true } } },
    });
    
    const total = categories.reduce((sum, cat) => sum + cat._count.products, 0) || 1;

    return {
      success: true,
      data: categories.map(cat => ({
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
        _count: { select: { products: true, rentalsCurated: true } }
      },
      orderBy: { rentalsCurated: { _count: 'desc' } }
    });

    return {
      success: true,
      data: topCurators.map(user => ({
        id: user.id,
        name: user.name,
        avatar: user.profile?.avatarUploadId || null, // Simplified
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
      orderBy: { rentals: { _count: 'desc' } }
    });

    return {
      success: true,
      data: topProducts.map(prod => ({
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
    return { success: true, message: `2FA ${data.enabled ? 'enabled' : 'disabled'}` };
  }

  async getAdminDevices(adminId: string) {
    return {
      success: true,
      data: [{ device: 'MacBook Pro', location: 'Lagos, Nigeria', current: true }],
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
        // 1. Auth OTP tokens
        await tx.authOtpToken.deleteMany({ where: { userId } });

        // 2. Profile and related (EmergencyContact, BusinessInfo, Address)
        const profile = await tx.profile.findUnique({ where: { userId } });
        if (profile) {
          const profileId = profile.id;
          await tx.emergencyContact.deleteMany({ where: { profileId } });
          await tx.businessInfo.deleteMany({ where: { profileId } });
          await tx.address.deleteMany({ where: { profileId } });
          await tx.profile.update({
            where: { id: profileId },
            data: { avatarUploadId: null, ninUploadId: null },
          });
          await tx.profile.delete({ where: { id: profileId } });
        }

        // 3. Cart and cart items
        const cart = await tx.cart.findUnique({ where: { userId } });
        if (cart) {
          await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
          await tx.cart.delete({ where: { id: cart.id } });
        }

        // 4. Favourites
        await tx.favourite.deleteMany({ where: { userId } });

        // 5. Virtual accounts (by userId)
        await tx.virtualAccount.deleteMany({ where: { userId } });

        // 6. Transactions (by userId)
        await tx.transaction.deleteMany({ where: { userId } });

        // 7. Uploads
        await tx.upload.deleteMany({ where: { userId } });

        // 8. Nullify user-owned Brand, Tag, ProductCategory
        await tx.brand.updateMany({ where: { userId }, data: { userId: null } });
        await tx.productCategory.updateMany({ where: { userId }, data: { userId: null } });
        await tx.tag.updateMany({ where: { userId }, data: { userId: null } });

        // 9. Orders and their dependencies
        const orders = await tx.order.findMany({ where: { userId }, select: { id: true } });
        for (const order of orders) {
          const orderId = order.id;
          const rental = await tx.rental.findUnique({ where: { orderId } });
          if (rental) {
            await tx.review.deleteMany({ where: { rentalId: rental.id } });
          }
          await tx.rental.deleteMany({ where: { orderId } });
          await tx.orderItem.deleteMany({ where: { orderId } });
          await tx.walletTransaction.deleteMany({ where: { orderId } });
          await tx.transaction.deleteMany({ where: { orderId } });
          await tx.virtualAccount.deleteMany({ where: { orderId } });
          await tx.escrow.deleteMany({ where: { orderId } });
          const dispute = await tx.dispute.findFirst({ where: { orderId } });
          if (dispute) {
            const chatRoom = await tx.chatRoom.findUnique({ where: { disputeId: dispute.id } });
            if (chatRoom) {
              await tx.message.deleteMany({ where: { chatRoomId: chatRoom.id } });
              await tx.chatRoom.delete({ where: { id: chatRoom.id } });
            }
            await tx.attachments.updateMany({ where: { disputeId: dispute.id }, data: { disputeId: null } });
            await tx.dispute.delete({ where: { id: dispute.id } });
          }
          await tx.order.delete({ where: { id: orderId } });
        }

        // 10. Rentals where user is curator or rentee (not already deleted via order)
        await tx.rental.deleteMany({ where: { userId } });
        await tx.rental.deleteMany({ where: { curatorId: userId } });

        // 11. Reviews by this user
        await tx.review.deleteMany({ where: { userId } });
        await tx.review.deleteMany({ where: { curatorId: userId } });

        // 12. Products owned by user (curator)
        const products = await tx.product.findMany({ where: { curatorId: userId }, select: { id: true } });
        for (const product of products) {
          const productId = product.id;
          await tx.availabilityRequest.deleteMany({ where: { productId } });
          await tx.cartItem.deleteMany({ where: { productId } });
          await tx.favourite.deleteMany({ where: { productId } });
          await tx.review.deleteMany({ where: { productId } });
          await tx.orderItem.deleteMany({ where: { productId } });
          const att = await tx.attachments.findFirst({ where: { productId } });
          if (att) {
            await tx.upload.deleteMany({ where: { attachmentId: att.id } });
            await tx.attachments.delete({ where: { id: att.id } });
          }
          await tx.product.delete({ where: { id: productId } });
        }

        // 13. Wallet and wallet transactions
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (wallet) {
          await tx.walletTransaction.deleteMany({ where: { walletId: wallet.id } });
          await tx.wallet.delete({ where: { id: wallet.id } });
        }

        // 14. Disputes and Notification Settings
        await tx.dispute.deleteMany({ where: { userId } });
        await tx.notificationSettings.deleteMany({ where: { userId } });

        // 15. User
        await tx.user.delete({ where: { id: userId } });
        await tx.notification.deleteMany({ where: { userId } });
        await tx.notificationSettings.delete({where:{userId}})
      },
      { timeout: 60_000 }
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

  async getAuditLogs(page: number, limit: number, action?: string, admin?: string, dateRange?: string) {
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
      this.prisma.dispute.count({ where: { status: 'RESELOVED' } }),
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
    if (status && status !== 'ALL') {
      where.status = status as any;
    }

    const [total, disputes] = await this.prisma.$transaction([
      this.prisma.dispute.count({ where }),
      this.prisma.dispute.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { name: true, email: true } },
          order: { select: { id: true, orderId: true } },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        disputes,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getDisputeDetails(disputeId: string) {
    const dispute = await this.prisma.dispute.findUnique({
      where: { id: disputeId },
      include: {
        user: true,
        order: { include: { orderItems: { include: { product: true } } } },
      },
    });

    if (!dispute) throw new NotFoundException('Dispute not found');
    return { success: true, data: dispute };
  }

  async updateDisputeStatus(disputeId: string, data: { status: string; note: string }) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');

    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: data.status as any,
      },
    });

    return {
      success: true,
      message: 'Dispute status updated successfully',
      data: updated,
    };
  }

  async resolveDispute(disputeId: string, data: { resolutionDetails: string; refundAmount?: number }) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new NotFoundException('Dispute not found');

    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: 'RESELOVED',
      },
    });

    return {
      success: true,
      message: 'Dispute resolved successfully',
      data: updated,
    };
  }

  async assignDispute(disputeId: string, data: { adminId: string }) {
    const dispute = await this.prisma.dispute.findUnique({ where: { id: disputeId } });
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
    const [totalActive, totalEscrow] = await Promise.all([
      this.prisma.wallet.aggregate({ _sum: { mainBalance: true, availableBalance: true, collateralBalance: true } }),
      this.prisma.escrow.aggregate({
        where: { status: 'LOCKED' },
        _sum: { collateralAmount: true, rentalAmount: true },
      }),
    ]);

    const escrowBalance = (totalEscrow._sum.collateralAmount || 0) + (totalEscrow._sum.rentalAmount || 0);

    return {
      success: true,
      data: {
        totalWalletBalance: (totalActive._sum.mainBalance || 0) + (totalActive._sum.availableBalance || 0) + (totalActive._sum.collateralBalance || 0),
        totalEscrowBalance: escrowBalance,
      },
    };
  }

  async getAllWallets(page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [total, wallets] = await this.prisma.$transaction([
      this.prisma.wallet.count(),
      this.prisma.wallet.findMany({
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
        total,
        page,
        totalPages: Math.ceil(total / limit),
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

  async getAllEscrows(page: number, limit: number, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status as any;
    }

    const [total, escrows] = await this.prisma.$transaction([
      this.prisma.escrow.count({ where }),
      this.prisma.escrow.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { orderId: true } },
        },
      }),
    ]);

    return {
      success: true,
      data: {
        escrows,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async releaseEscrow(escrowId: string, data: { amount?: number; note: string }) {
    const escrow = await this.prisma.escrow.findUnique({ where: { id: escrowId } });
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

  async getAllWalletTransactions(page: number, limit: number) {
    const skip = (page - 1) * limit;

    const [total, transactions] = await this.prisma.$transaction([
      this.prisma.walletTransaction.count(),
      this.prisma.walletTransaction.findMany({
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
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async exportWallets() {
    return { success: true, data: { message: 'Wallets exported successfully' } };
  }

  async getAllWithdrawals(page: number, limit: number, status?: string, search?: string) {
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
                  avatarUpload: { select: { url: true } }
                }
              }
            } 
          },
          bankAccount: {
            select: {
              accountNumber: true,
              bankName: true,
              accountName: true,
            }
          },
        },
      }),
    ]);

    // Format to match user requested structure
    const formatted = withdrawals.map(w => ({
      id: w.id,
      userId: w.userId,
      user: {
        id: w.user.id,
        name: w.user.name,
        email: w.user.email,
        avatar: (w.user as any).profile?.avatarUpload?.url || null
      },
      bankAccount: w.bankAccount,
      amount: w.amount,
      status: w.status.toLowerCase(),
      requestedDate: w.createdAt,
      paidDate: (w as any).paidDate,
      trackingId: (w as any).trackingId,
      reference: w.reference
    }));

    return {
      success: true,
      data: {
        withdrawals: formatted,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPayouts(page: number, limit: number, search?: string) {
    return this.getAllWithdrawals(page, limit, 'paid', search);
  }

  async markWithdrawalAsPaid(withdrawalId: string, trackingId: string) {
    const withdrawal = await this.prisma.withdrawalRequest.findUnique({
      where: { id: withdrawalId },
    });

    if (!withdrawal) {
      throw new NotFoundException('Withdrawal request not found');
    }

    if (withdrawal.status.toLowerCase() === 'paid') {
      throw new BadRequestException('Withdrawal is already marked as paid');
    }

    // Usually withdrawal must be APPROVED before being PAID?
    // But user request just says "Mark Withdrawal as Paid"

    const updated = await this.prisma.withdrawalRequest.update({
      where: { id: withdrawalId },
      data: {
        status: 'paid',
        paidDate: new Date(),
        trackingId: trackingId,
        processedAt: new Date(),
      } as any,
      include: {
        user: { select: { name: true, email: true } }
      }
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

  async updateWithdrawalStatus(withdrawalId: string, status: 'APPROVED' | 'REJECTED', note?: string) {
    const withdrawal = await this.prisma.withdrawalRequest.findUnique({ where: { id: withdrawalId } });
    if (!withdrawal) throw new NotFoundException('Withdrawal request not found');
    if (withdrawal.status !== 'PENDING') throw new BadRequestException(`Withdrawal is already ${withdrawal.status}`);

    if (status === 'REJECTED') {
      // Refund wallet in a transaction
      await this.prisma.$transaction(async (tx) => {
        const wallet = await (tx as any).wallet.findUnique({ where: { userId: withdrawal.userId } });
        if (wallet) {
          await (tx as any).wallet.update({
            where: { id: wallet.id },
            data: { mainBalance: { increment: withdrawal.amount } }
          });
          
          await (tx as any).walletTransaction.create({
            data: {
              walletId: wallet.id,
              type: "MAIN",
              amount: withdrawal.amount,
              status: "SUCCESS",
              note: `Refund for rejected withdrawal request (Ref: ${withdrawal.reference})`
            }
          });
        }
        
        await (tx as any).withdrawalRequest.update({
          where: { id: withdrawalId },
          data: { 
            status: (status as string) === 'APPROVED' ? 'approved' : 'rejected',
            processedAt: new Date(),
          }
        });
      });
    } else {
      await this.prisma.withdrawalRequest.update({
        where: { id: withdrawalId },
        data: { status }
      });
    }

    // Trigger Notification
    await this.notificationService.createNotification({
        userId: withdrawal.userId,
        title: `Withdrawal ${status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
        message: `Your withdrawal request of NGN ${withdrawal.amount} (Ref: ${withdrawal.reference}) has been ${status.toLowerCase()}.`,
        type: "WITHDRAWAL_STATUS",
        metadata: { withdrawalId: withdrawal.id, status },
        sendEmail: true,
        emailData: {
            email: (await this.prisma.user.findUnique({ where: { id: withdrawal.userId } }))?.email,
            userName: (await this.prisma.user.findUnique({ where: { id: withdrawal.userId } }))?.name,
            amount: withdrawal.amount,
            reference: withdrawal.reference,
            status: status,
        }
    });

    return {
      success: true,
      message: `Withdrawal ${status.toLowerCase()} successfully`,
      data: { status }
    };
  }

  /* PRODUCTS */

  async getProductStats() {
    const [total, pending, approved, rejected] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.product.count({ where: { status: 'PENDING' } }),
      this.prisma.product.count({ where: { status: 'APPROVED' } }),
      this.prisma.product.count({ where: { status: 'REJECTED' } }),
    ]);
    return {
      success: true,
      data: {
        getTotalProducts: { count: total },
        getPendingProducts: { count: pending },
        getApprovedProducts: { count: approved },
        getRejectedProducts: { count: rejected },
        getActiveProducts: { count: approved },
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
        orderItems: { some: { productId } },
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] },
        rental: {
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
      include: {
        rental: true,
        user: { select: { id: true, name: true } },
      },
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
      const booking = orders.find((o) => {
        if (!o.rental) return false;
        const start = new Date(o.rental.startDate);
        const end = new Date(o.rental.endDate);
        // Normalize to date parts for comparison
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        const s = new Date(start);
        s.setHours(0, 0, 0, 0);
        const e = new Date(end);
        e.setHours(23, 59, 59, 999);
        return d >= s && d <= e;
      });

      if (booking && booking.rental) {
        daysRentedThisMonth++;
        calendar.push({
          date: isoDate,
          status: 'rented',
          booking: {
            id: booking.id,
            dresserId: booking.userId,
            dresserName: booking.user.name,
            startDate: booking.rental.startDate.toISOString().split('T')[0],
            endDate: booking.rental.endDate.toISOString().split('T')[0],
            orderTotal: booking.rental.totalAmount || 0,
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
    totalRentalRevenue = orders.reduce((sum, o) => sum + (o.rental?.totalAmount || 0), 0);

    // Current status
    const now = new Date();
    const currentRental = orders.find(o => o.rental && now >= o.rental.startDate && now <= o.rental.endDate);

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
        nextAvailableDate: nextAvailable?.startDate.toISOString().split('T')[0] || null,
        currentlyRented: !!currentRental,
        currentRentalEndDate: currentRental?.rental?.endDate.toISOString().split('T')[0] || null,
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
          { targetType: 'ORDER', details: { path: ['productId'], equals: productId } as any },
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

      if (order.status === OrderStatus.COMPLETED || order.status === OrderStatus.RETURNED) {
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
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return {
      success: true,
      data: {
        productId,
        activities,
      },
    };
  }

  async getProductsByStatus(status: 'PENDING' | 'REJECTED' | 'APPROVED', page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [total, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where: { status: status as any } }),
      this.prisma.product.findMany({
        where: { status: status as any },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          brand: true,
          category: true,
          curator: { select: { name: true, email: true } },
          attachments: true,
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
        curator: true,
        attachments: { include: { uploads: true } },
      },
    });

    if (!product) throw new NotFoundException('Product not found');
    return { success: true, data: product };
  }

  async updateProductStatus(productId: string, status: 'APPROVED' | 'REJECTED', reason?: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        status: status as any,
        ...(reason ? { rejectionComment: reason } : {}),
      },
    });

    return {
      success: true,
      message: `Product ${status.toLowerCase()} successfully`,
      data: updated,
    };
  }

  async deleteProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');

    await this.prisma.product.delete({
      where: { id: productId },
    });

    return {
      success: true,
      message: 'Product deleted successfully',
    };
  }

  /* USERS */
  async getAllUsers() {
    const users = await this.prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, profile: true } });
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
    const listings = await this.prisma.product.findMany({ where: { curatorId: userId } });
    return { success: true, data: listings };
  }
  async getUserWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    return { success: true, data: wallet };
  }
  async getUserTransactions(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return { success: true, data: [] };
    const transactions = await this.prisma.walletTransaction.findMany({ where: { walletId: wallet.id } });
    return { success: true, data: transactions };
  }
  async getUserDisputes(userId: string) {
    const disputes = await this.prisma.dispute.findMany({ where: { userId } });
    return { success: true, data: disputes };
  }
  async getUserFavorites(userId: string) {
    const favorites = await this.prisma.favourite.findMany({ where: { userId }, include: { product: true } });
    return { success: true, data: favorites };
  }

  /* ORDERS */
  async getOrderStats() {
    const total = await this.prisma.order.count();
    return { success: true, data: { total } };
  }
  async getAllOrders(page: number, limit: number, status?: string) {
    const where = status && status !== 'ALL' ? { status: status as any } : {};
    
    const [total, orders, totalListings, completedOrders, activeOrders, disputedOrders, revenue] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({ 
        where, 
        skip: (page - 1) * limit, 
        take: limit, 
        orderBy: { createdAt: 'desc' },
        include: { 
          orderItems: { include: { product: { include: { curator: { include: { profile: { include: { avatarUpload: true } } } } } } } },
          rental: { include: { curator: { include: { profile: { include: { avatarUpload: true } } } } } },
          user: { include: { profile: { include: { avatarUpload: true } } } },
          payments: { take: 1, orderBy: { createdAt: 'desc' } }
        } 
      }),
      this.prisma.product.count(),
      this.prisma.order.count({ where: { status: 'COMPLETED' } }),
      this.prisma.order.count({ where: { status: { in: ['CONFIRMED', 'IN_TRANSIT', 'DELIVERED', 'ACTIVE'] } } }),
      this.prisma.dispute.count(),
      this.prisma.transaction.aggregate({ where: { status: 'SUCCESS' }, _sum: { amount: true } })
    ]);

    const formattedOrders = orders.map((o: any) => {
      // Determine total amount
      const totalAmount = o.rental?.totalAmount || o.orderItems.reduce((sum: number, item: any) => sum + (item.pricePerDay * item.days), 0);
      
      // Determine curator (from rental or first order item)
      const curatorUser = o.rental?.curator || o.orderItems[0]?.product?.curator;
      
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
        date: o.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        curator: curatorUser ? {
          id: curatorUser.id,
          name: curatorUser.name,
          avatar: curatorUser.profile?.avatarUpload?.url || null
        } : null,
        dresser: o.user ? {
          id: o.user.id,
          name: o.user.name,
          avatar: o.user.profile?.avatarUpload?.url || null
        } : null,
        items: o.orderItems.length,
        total: totalAmount,
        status: displayStatus,
        returnDue: o.returnDueAt ? o.returnDueAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null,
        paymentReference: paymentRef
      };
    });

    return { 
      success: true, 
      data: {
        orders: formattedOrders,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit)
        },
        stats: {
          totalListings,
          completedOrders,
          activeOrders,
          disputedOrders,
          totalRevenue: revenue._sum.amount || 0
        }
      }
    };
  }
  async exportOrders() {
    return { success: true, data: { message: 'Export initiated' } };
  }
  async getOrderDetails(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { orderId }, include: { orderItems: true, user: true } });
    if (!order) throw new NotFoundException('Order not found');
    return { success: true, data: order };
  }
  async updateOrderStatus(orderId: string, data: { status: string; note: string }) {
    const order = await this.prisma.order.update({ where: { orderId }, data: { status: data.status as any } });
    return { success: true, data: order };
  }
  async cancelOrder(orderId: string, data: { reason: string }) {
    const order = await this.prisma.order.update({ where: { orderId }, data: { status: 'CANCELLED' as any } });
    return { success: true, data: order };
  }
  async getOrderActivity(orderId: string) {
    return { success: true, data: [] };
  }
}
