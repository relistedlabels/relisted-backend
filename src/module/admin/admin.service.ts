import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../services/prisma/prisma.service';
import { NotificationService } from 'src/services/notification/notification.service';
import {
  DisputeStatus,
  OrderStatus,
  ProductStatus,
  Role,
} from '@prisma/client';
import { incrementClosetRevenueForListerPayout } from '../closet/closet-revenue.util';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  private getDisputeUniqueWhere(disputeId: string) {
    return disputeId.startsWith('DQ-') ? { disputeId } : { id: disputeId };
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

  async getAnalyticsStats(timeframe: string, year?: string, month?: string) {
    const totalRentees = await this.prisma.user.count({
      where: { role: 'RENTER' },
    });
    const products = await this.prisma.product.aggregate({
      _sum: { originalValue: true },
    });
    const activeRentals = await this.prisma.rental.count({
      where: { isReturned: false },
    });

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

  async getRentalsRevenueTrend(
    timeframe: string,
    year?: string,
    month?: string,
  ) {
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

        // 6. Bank accounts
        await tx.bankAccount.deleteMany({ where: { userId } });

        // 7. Withdrawal requests
        await tx.withdrawalRequest.deleteMany({ where: { userId } });

        // 8. Availability requests where user is lister or requester
        await tx.availabilityRequest.deleteMany({
          where: { listerId: userId },
        });
        await tx.availabilityRequest.deleteMany({
          where: { requesterId: userId },
        });

        // 9. Transactions (by userId)
        await tx.transaction.deleteMany({ where: { userId } });

        // 10. Uploads
        await tx.upload.deleteMany({ where: { userId } });

        // 11. Nullify user-owned Brand, Tag, ProductCategory
        await tx.brand.updateMany({
          where: { userId },
          data: { userId: null },
        });
        await tx.productCategory.updateMany({
          where: { userId },
          data: { userId: null },
        });
        await tx.tag.updateMany({ where: { userId }, data: { userId: null } });

        // 12. Orders and their dependencies
        const orders = await tx.order.findMany({
          where: { userId },
          select: { id: true },
        });
        for (const order of orders) {
          const orderId = order.id;
          const rental = await tx.rental.findFirst({ where: { orderId } });
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
            const chatRoom = await tx.chatRoom.findUnique({
              where: { disputeId: dispute.id },
            });
            if (chatRoom) {
              await tx.message.deleteMany({
                where: { chatRoomId: chatRoom.id },
              });
              await tx.chatRoom.delete({ where: { id: chatRoom.id } });
            }
            await tx.attachments.updateMany({
              where: { disputeId: dispute.id },
              data: { disputeId: null },
            });
            await tx.dispute.delete({ where: { id: dispute.id } });
          }
          await tx.order.delete({ where: { id: orderId } });
        }

        // 13. Rentals where user is curator or rentee (not already deleted via order)
        await tx.rental.deleteMany({ where: { userId } });
        await tx.rental.deleteMany({ where: { curatorId: userId } });

        // 14. Reviews by this user
        await tx.review.deleteMany({ where: { userId } });
        await tx.review.deleteMany({ where: { curatorId: userId } });

        // 15. Products owned by user (curator)
        const products = await tx.product.findMany({
          where: { curatorId: userId },
          select: { id: true },
        });
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

        // 16. Wallet and wallet transactions
        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (wallet) {
          await tx.walletTransaction.deleteMany({
            where: { walletId: wallet.id },
          });
          await tx.wallet.delete({ where: { id: wallet.id } });
        }

        // 17. Disputes, Notifications and Settings
        await tx.dispute.deleteMany({ where: { userId } });
        await tx.notification.deleteMany({ where: { userId } });
        await tx.notificationSettings.deleteMany({ where: { userId } });

        // 18. User
        await tx.user.delete({ where: { id: userId } });
      },
      { timeout: 60_000 },
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
            uploads: true,
          },
        },
        chatRooms: {
          include: {
            message: {
              include: {
                uploads: true,
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

      if (
        order.returnRequest?.status === 'COMPLETED' &&
        order.status !== 'COMPLETED'
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
    const [totalActive, totalEscrow] = await Promise.all([
      this.prisma.wallet.aggregate({
        _sum: {
          mainBalance: true,
          availableBalance: true,
          collateralBalance: true,
        },
      }),
      this.prisma.escrow.aggregate({
        where: { status: 'LOCKED' },
        _sum: { collateralAmount: true, rentalAmount: true },
      }),
    ]);

    const escrowBalance =
      (totalEscrow._sum.collateralAmount || 0) +
      (totalEscrow._sum.rentalAmount || 0);

    return {
      success: true,
      data: {
        totalWalletBalance:
          (totalActive._sum.mainBalance || 0) +
          (totalActive._sum.availableBalance || 0) +
          (totalActive._sum.collateralBalance || 0),
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
    status: 'PENDING' | 'REJECTED' | 'APPROVED',
    page: number,
    limit: number,
  ) {
    const skip = (page - 1) * limit;
    const [total, products] = await this.prisma.$transaction([
      this.prisma.product.count({ where: { status: status as any } }),
      this.prisma.product.findMany({
        where: { status: status as any },
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
                orderBy: { createdAt: 'asc' },
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
        attachments: { include: { uploads: true } },
      },
    });

    if (!product) throw new NotFoundException('Product not found');
    return { success: true, data: product };
  }

  async updateProductStatus(
    productId: string,
    status: 'APPROVED' | 'REJECTED',
    reason?: string,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) throw new NotFoundException('Product not found');

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: {
        status: status as any,
        ...(reason ? { rejectionComment: reason } : {}),
        ...(status === 'APPROVED' ? { productVerified: true } : {}),
      },
    });

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
  async getOrderStats() {
    const total = await this.prisma.order.count();
    return { success: true, data: { total } };
  }
  async getAllOrders(page: number, limit: number, status?: string) {
    const where = status && status !== 'ALL' ? { status: status as any } : {};

    const [
      total,
      orders,
      totalListings,
      completedOrders,
      activeOrders,
      disputedOrders,
      revenue,
    ] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
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
      this.prisma.product.count(),
      this.prisma.order.count({ where: { status: 'COMPLETED' } }),
      this.prisma.order.count({
        where: {
          status: { in: ['CONFIRMED', 'IN_TRANSIT', 'DELIVERED', 'ACTIVE'] },
        },
      }),
      this.prisma.dispute.count(),
      this.prisma.transaction.aggregate({
        where: { status: 'SUCCESS' },
        _sum: { amount: true },
      }),
    ]);

    const formattedOrders = orders.map((o: any) => {
      // Determine total amount
      const rental = o.rentals?.[0];
      const totalAmount =
        rental?.totalAmount ||
        o.orderItems.reduce(
          (sum: number, item: any) => sum + item.pricePerDay * item.days,
          0,
        );

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
        curator: curatorUser
          ? {
              id: curatorUser.id,
              name: curatorUser.name,
              avatar: curatorUser.profile?.avatarUpload?.url || null,
            }
          : null,
        dresser: o.user
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
          page,
          limit,
          pages: Math.ceil(total / limit),
        },
        stats: {
          totalListings,
          completedOrders,
          activeOrders,
          disputedOrders,
          totalRevenue: revenue._sum.amount || 0,
        },
      },
    };
  }
  async exportOrders() {
    return { success: true, data: { message: 'Export initiated' } };
  }
  async getOrderDetails(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderId },
      include: { orderItems: true, user: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return { success: true, data: order };
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

  async getReturnRequests(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [total, returns] = await this.prisma.$transaction([
      this.prisma.returnRequest.count(),
      this.prisma.returnRequest.findMany({
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
                uploads: { take: 1, select: { url: true } },
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
}
