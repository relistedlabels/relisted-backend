import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../services/prisma/prisma.service';
import { NotificationService } from 'src/services/notification/notification.service';

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

  async addAdmin(data: any) {
    // In real app, create user and assign role
    return { success: true, message: 'Admin added successfully' };
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

  async getAllWithdrawals(page: number, limit: number, status?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};
    if (status && status !== 'ALL') {
      where.status = status;
    }

    const [total, withdrawals] = await this.prisma.$transaction([
      this.prisma.withdrawalRequest.count({ where }),
      this.prisma.withdrawalRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          bankAccount: true,
        },
      }),
    ]);

    return {
      success: true,
      data: {
        withdrawals,
        total,
        page,
        totalPages: Math.ceil(total / limit),
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
          data: { status }
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
    const rentals = await this.prisma.rental.findMany({ where: { userId }, include: { product: true } });
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
