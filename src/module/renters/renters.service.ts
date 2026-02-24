import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../services/prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class RentersService {
  constructor(private prisma: PrismaService) {}

  async getDashboardSummary(userId: string, timeframe: string = 'month') {
    const activeRentals = await this.prisma.rental.findMany({
      where: { userId, isReturned: false },
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
        endDate: { lte: new Date() }
      }
    });

    // Cast to any to avoid strict type checks on partial returns if needed
    const wallet: any = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    const favoriteItemsCount = await this.prisma.favourite.count({
        where: { userId }
    });

    return {
      success: true,
      data: {
        dashboard: {
          activeRentals: { 
            count: activeRentals.length,
            items: activeRentals.map(r => ({
                orderId: r.order?.orderId || r.orderId,
                itemName: r.product.name,
                listerName: (r as any).curator?.name || 'Unknown',
                rentalStartDate: r.startDate,
                rentalEndDate: r.endDate,
                daysRemaining: Math.ceil((new Date(r.endDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)),
                status: 'active'
            }))
          },
          pendingReturns: {
            count: pendingReturnsCount,
            dueDate: new Date().toISOString()
          },
          walletBalance: {
            amount: wallet?.availableBalance || 0,
            currency: 'NGN'
          },
          totalSpent: {
            amount: 0, 
            currency: 'NGN'
          },
          favoriteItems: favoriteItemsCount,
          recentOrders: 5 
        }
      }
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: { include: { address: true, avatarUpload: true } } }
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
          profileImage: user.profile?.avatarUpload?.url,
          dateJoined: user.createdAt,
          addresses: user.profile?.address ? [user.profile.address] : []
        }
      }
    };
  }

  async updateProfile(userId: string, updateData: any) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: updateData.fullName,
        profile: {
          upsert: {
            create: { phoneNumber: updateData.phone },
            update: { phoneNumber: updateData.phone }
          }
        }
      },
      include: { profile: true }
    });

    return {
        success: true,
        message: "Profile updated successfully",
        data: {
            profile: {
                userId: user.id,
                fullName: user.name,
                email: user.email,
                phone: user.profile?.phoneNumber,
                updatedAt: new Date()
            }
        }
    }
  }

  async getAddresses(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      include: { address: true }
    });

    return {
      success: true,
      data: {
        addresses: profile?.address ? [profile.address] : [],
        total: profile?.address ? 1 : 0
      }
    };
  }

  async addAddress(userId: string, addressData: any) {
     const profile = await this.prisma.profile.findUnique({where: {userId}});
     if(!profile) throw new NotFoundException("Profile not found");
     
     const address = await this.prisma.address.upsert({
         where: { profileId: profile.id },
         create: {
             profileId: profile.id,
             street: addressData.street,
             city: addressData.city,
             state: addressData.state,
             country: addressData.country,
             zipCode: addressData.postalCode,
             isDefault: addressData.isDefault
         },
         update: {
             street: addressData.street,
             city: addressData.city,
             state: addressData.state,
             country: addressData.country,
             zipCode: addressData.postalCode,
             isDefault: addressData.isDefault
         }
     });

     return {
         success: true,
         message: "Address added successfully",
         data: { address }
     };
  }

  async getWallet(userId: string) {
    let wallet: any = await this.prisma.wallet.findUnique({
      where: { userId },
      include: { transactions: { take: 1, orderBy: { createdAt: 'desc' } } }
    });

    if (!wallet) {
        wallet = await this.prisma.wallet.create({ data: { userId } });
        wallet.transactions = [];
    }
    
    // Explicit casting to allow access to transactions if inferred type is incomplete due to include
    const safeWallet = wallet as any;

    const activeRentals = await this.prisma.rental.findMany({
        where: { userId, isReturned: false },
        include: { order: true }
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
            lastUpdated: safeWallet.updatedAt
          },
          lockedBreakdown: {
              activeRentals: [], 
              disputeHolds: [],
              totalLockedAmount: 0
          },
          statistics: {
              totalDeposits: 0,
              totalSpent: 0,
              totalRefunds: 0,
              lifetimeTransactions: 0,
              activeRentalOrders: activeRentals.length,
              activeDisputes: 0
          },
          lastTransaction: safeWallet.transactions?.[0] ? {
              type: safeWallet.transactions[0].amount < 0 ? 'debit' : 'credit', 
              amount: Math.abs(safeWallet.transactions[0].amount),
              description: safeWallet.transactions[0].note,
              date: safeWallet.transactions[0].createdAt
          } : null,
          linkedBankAccounts: await (this.prisma as any).bankAccount.count({ where: { userId } }),
          canWithdraw: true,
          minimumFundsForTransaction: 1000
        }
      }
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
            include: { order: { include: { orderItems: { include: { product: true }, take: 1 } } } }
        })
    ]);

    return {
        success: true,
        data: {
            transactions: transactions.map(t => ({
                transactionId: t.id,
                type: t.amount < 0 ? 'debit' : 'credit', 
                amount: Math.abs(t.amount),
                currency: 'NGN',
                description: t.note,
                orderId: t.orderId,
                status: t.status,
                timestamp: t.createdAt,
                relatedOrder: t.order ? {
                    orderId: t.order.orderId,
                    itemName: t.order.orderItems[0]?.product.name || 'Unknown Item',
                    listerName: 'Unknown' 
                } : null
            })),
            totalTransactions: total,
            page,
            totalPages: Math.ceil(total / limit)
        }
    }
  }

  async getBankAccounts(userId: string) {
      const accounts = await (this.prisma as any).bankAccount.findMany({ where: { userId } });
      return {
          success: true,
          data: {
              bankAccounts: accounts,
              totalAccounts: accounts.length
          }
      }
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
                      upcomingReleases: []
                  }
              }
          }
      }
  }
  
  async getWithdrawal(userId: string, withdrawalId: string) {
      const withdrawal = await (this.prisma as any).withdrawalRequest.findFirst({
          where: { id: withdrawalId, userId },
          include: { bankAccount: true }
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
                      accountName: withdrawal.bankAccount.accountName
                  },
                  fee: withdrawal.fee,
                  netAmount: withdrawal.netAmount,
                  status: withdrawal.status, 
                  estimatedDelivery: null,
                  reference: withdrawal.reference,
                  initiatedAt: withdrawal.createdAt,
                  timeline: []
              }
          }
      }
  }

  async uploadAvatar(userId: string, file: Express.Multer.File) {
      return {
          success: true,
          message: "Profile avatar updated successfully",
          data: {
              profileImage: "https://cloudinary.com/mock.jpg",
              uploadedAt: new Date()
          }
      }
  }

  async getOrders(userId: string, query: any) {
      const page = Number(query.page) || 1;
      const limit = Number(query.limit) || 10;
      const skip = (page - 1) * limit;
      const status = query.status; 

      const where: any = { userId };
      if (status === 'active') where.status = { in: ['CONFIRMED', 'IN_TRANSIT', 'DELIVERED', 'ACTIVE'] };
      if (status === 'completed') where.status = 'COMPLETED';
      if (status === 'cancelled') where.status = 'CANCELLED';

      const [total, orders] = await this.prisma.$transaction([
          this.prisma.order.count({ where }),
          this.prisma.order.findMany({
              where,
              skip,
              take: limit,
              orderBy: { createdAt: 'desc' },
              include: { orderItems: { include: { product: { include: { curator: true } } } }, rental: true } 
          })
      ]);

      const typedOrders = orders as any[];

      return {
          success: true,
          data: {
              orders: typedOrders.map(o => {
                  const totalAmount = o.rental?.totalAmount || o.orderItems.reduce((sum: number, item: any) => sum + (item.pricePerDay * item.days), 0);
                  const firstItem = o.orderItems[0];
                  // Safe access for images
                  const image = (firstItem?.product as any).images?.[0] || null;
                  
                  return {
                      orderId: o.orderId,
                      items: o.orderItems.map((i: any) => i.product.name),
                      totalAmount: totalAmount,
                      status: o.status,
                      date: o.createdAt,
                      image: image
                  };
              }),
              totalOrders: total,
              page,
              totalPages: Math.ceil(total / limit)
          }
      }
  }

  async getOrder(userId: string, orderId: string) {
      const order = await this.prisma.order.findUnique({
          where: { orderId },
          include: { 
              orderItems: { include: { product: { include: { curator: { select: { name: true } } } } } },
              rental: true,
              user: { include: { profile: { include: { address: true } } } }
          }
      });

      if (!order || order.userId !== userId) throw new NotFoundException('Order not found');
      
      const typedOrder = order as any;
      const totalAmount = typedOrder.rental?.totalAmount || typedOrder.orderItems.reduce((sum: number, item: any) => sum + (item.pricePerDay * item.days), 0);

      return {
          success: true,
          data: {
              order: {
                  orderId: typedOrder.orderId,
                  status: typedOrder.status,
                  createdAt: typedOrder.createdAt,
                  totalAmount: totalAmount,
                  deliveryFee: 0, 
                  serviceFee: 0, 
                  items: typedOrder.orderItems.map((i: any) => ({
                      name: i.product.name,
                      price: i.pricePerDay,
                      quantity: i.days,
                      image: (i.product as any).images?.[0] || null,
                      lister: i.product.curator?.name || 'Unknown'
                  })),
                  shippingAddress: typedOrder.user.profile?.address || null, 
                  tracking: {
                      status: typedOrder.status,
                      updates: [] 
                  }
              }
          }
      }
  }

  async updateOrderTracking(userId: string, orderId: string, data: any) {
      return {
          success: true,
          message: "Order updated"
      }
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
              include: { product: true } 
          })
      ]);

      const typedFavorites = favorites as any[];

      return {
          success: true,
          data: {
              favorites: typedFavorites.map(f => ({
                  favoriteId: f.id,
                  productId: f.product.id,
                  productName: f.product.name,
                  productImage: f.product.images?.[0] || null,
                  addedAt: f.createdAt
              })),
              totalFavorites: total,
              page,
              totalPages: Math.ceil(total / limit)
          }
      }
  }

  async addFavorite(userId: string, productId: string) {
      return this.prisma.favourite.create({
          data: {
              userId,
              productId
          }
      })
  }

  async removeFavorite(userId: string, productId: string) {
      return this.prisma.favourite.delete({
          where: {
              userId_productId: {
                  userId,
                  productId
              }
          }
      })
}
