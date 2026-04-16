import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus } from '@prisma/client';
import { Order_Verification } from 'src/services/event/event.types';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { TopshipService } from 'src/services/topship/topship.service';
import { bad } from 'src/utils/error';
import { userEntity } from '../auth/auth.types';
import { addMinutes, isAfter } from 'date-fns';
import { NotificationService } from 'src/services/notification/notification.service';
import { DEFAULT_CLEANING_FEE_NGN } from 'src/constants/rental-pricing';

const APPROVAL_WINDOW_MINUTES = 15;

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private topshipService: TopshipService,
    private notificationService: NotificationService,
  ) {}

  private async cartItemsApprovedForCheckout(
    requesterId: string,
    items: any[],
  ): Promise<any[]> {
    const ids = items.map((i) => i.id);
    if (ids.length === 0) return [];
    const accepted = await this.prisma.availabilityRequest.findMany({
      where: {
        requesterId,
        cartItemId: { in: ids },
        status: 'ACCEPTED',
      },
      select: { cartItemId: true, startDate: true, endDate: true },
    });
    const acceptedMap = new Map(
      accepted.map((r) => [r.cartItemId, { startDate: r.startDate, endDate: r.endDate }]),
    );
    return items
      .filter((i) => acceptedMap.has(i.id))
      .map((i) => ({
        ...i,
        startDate: acceptedMap.get(i.id)?.startDate,
        endDate: acceptedMap.get(i.id)?.endDate,
      }));
  }

  async getCheckoutSummary(user: userEntity) {
    const renterProfile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: { address: true },
    });

    if (!renterProfile?.address) {
      bad('Please add a delivery address to your profile before checkout.');
    }

    const cart = await this.prisma.cart.findUnique({
      where: { userId: user.id },
      include: {
        items: {
          include: {
            product: {
              include: {
                curator: {
                  include: {
                    profile: { include: { address: true, businessInfo: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      bad('Cart is empty');
    }

    const eligibleItems = await this.cartItemsApprovedForCheckout(
      user.id,
      cart.items,
    );
    if (eligibleItems.length === 0) {
      bad(
        'No items are approved for checkout yet. Wait for lister approval before viewing the payment summary.',
      );
    }

    const itemsByLister = new Map<string, any[]>();
    for (const item of eligibleItems) {
      const listerId = item.product.curatorId;
      if (!itemsByLister.has(listerId)) {
        itemsByLister.set(listerId, []);
      }
      itemsByLister.get(listerId)!.push(item);
    }

    let globalRentalTotal = 0;
    let globalCollateralTotal = 0;
    let globalCleaningTotal = 0;
    let globalPickupTotal = 0;
    let globalVatTotal = 0;
    let globalServiceChargeTotal = 0;
    let globalPurchaseTotal = 0;
    const listerBreakdowns: any[] = [];
    const shippingTiersMap = new Map<
      string,
      { name: string; totalShippingCost: number }
    >();

    // Calculate item totals for each lister first (without external API calls)
    const listerData: any[] = [];
    for (const [listerId, items] of itemsByLister.entries()) {
      let listerRentalTotal = 0;
      let listerCollateralTotal = 0;
      let listerCleaningTotal = 0;
      let listerVatTotal = 0;
      let listerServiceChargeTotal = 0;
      let listerPurchaseTotal = 0;
      let curatorAddress: any = null;

      for (const item of items) {
        if (!item.product.isActive) bad(`${item.product.name} is not active`);
        if (!item.product.productVerified)
          bad(`${item.product.name} is not verified by admin`);
        if (item.product.status === 'SOLD')
          bad(`${item.product.name} is already sold`);

        // Determine if this item is a resale purchase
        const isResalePurchase =
          item.product.listingType === 'RESALE' ||
          (item.product.listingType === 'RENT_OR_RESALE' && item.days === 0);

        // Validate rental duration only for rental items
        if (!isResalePurchase && item.days <= 0) {
          bad('Invalid rental duration');
        }

        curatorAddress =
          item.product.curator.profile?.address ||
          item.product.curator.profile?.businessInfo;

        let rentalAmount = 0;
        let collateralAmount = 0;
        let cleaningFee = 0;
        let vatAmount = 0;
        let serviceCharge = 0;

        if (isResalePurchase) {
          // Resale calculation
          if (!item.product.resalePrice || item.product.resalePrice <= 0) {
            bad(
              `${item.product.name} has invalid resale price for RESALE listing`,
            );
          }
          rentalAmount = 0;
          collateralAmount = 0;
          cleaningFee = 0;
          vatAmount = Math.round(item.product.resalePrice * 0.2);
          serviceCharge = Math.round(item.product.resalePrice * 0.1);
          listerPurchaseTotal += item.product.resalePrice;
          listerRentalTotal += 0; // No rental fee for resale
        } else {
          // Rental calculation
          if (!item.product.dailyPrice) {
            bad(`${item.product.name} is missing daily price for rental`);
          }
          rentalAmount = item.product.dailyPrice * item.days;
          collateralAmount =
            Number(
              item.product.collateralPrice || item.product.originalValue,
            ) || 0;
          cleaningFee = DEFAULT_CLEANING_FEE_NGN;
          vatAmount = Math.round(rentalAmount * 0.2);
          serviceCharge = Math.round(rentalAmount * 0.1);
          listerRentalTotal += rentalAmount;
        }

        listerCollateralTotal += collateralAmount;
        listerCleaningTotal += cleaningFee;
        listerVatTotal += vatAmount;
        listerServiceChargeTotal += serviceCharge;
      }

      listerData.push({
        listerId,
        items,
        listerRentalTotal,
        listerCollateralTotal,
        listerCleaningTotal,
        listerVatTotal,
        listerServiceChargeTotal,
        listerPurchaseTotal,
        curatorAddress,
      });
    }

    // Batch external API calls for all listers in parallel
    const shippingPromises = listerData.map(async (data) => {
      const senderCity = data.curatorAddress?.city || 'Lagos';
      const receiverCity = renterProfile.address!.city || 'Lagos';

      let pickupChargeRaw = 0;
      try {
        const pickupPayload = {
          senderDetail: {
            addressLine1: data.curatorAddress?.street || 'Lagos',
            addressLine2: '',
            country: 'Nigeria',
            countryCode: 'NG',
            state: data.curatorAddress?.state || 'Lagos',
            city: senderCity,
          },
          pickupDate: new Date().toISOString(),
        };
        const pickupData =
          await this.topshipService.getPickupRates(pickupPayload);
        if (pickupData && pickupData.length > 0) {
          pickupChargeRaw = Number(pickupData[0].pickupCharge) || 0;
        }
      } catch (err: any) {
        console.warn(
          `Pickup calculation failed for ${senderCity}. Reason:`,
          err.message,
        );
      }
      const pickupChargeNGN = Math.ceil(pickupChargeRaw / 100);

      let rateData: any[] = [];
      try {
        const ratePayload = {
          senderDetails: { cityName: senderCity, countryCode: 'NG' },
          receiverDetails: { cityName: receiverCity, countryCode: 'NG' },
          totalWeight: 1,
        };
        rateData = await this.topshipService.getShipmentRate(ratePayload);
      } catch (err: any) {
        console.warn(
          `Shipping calculation failed between ${senderCity} and ${receiverCity}. Reason:`,
          err.message,
        );
      }

      if (!rateData || !rateData.length) {
        rateData = [
          { pricingTier: 'Budget', name: 'Standard (Fallback)', cost: 300000 },
        ];
      }

      return {
        listerId: data.listerId,
        pickupChargeNGN,
        rateData,
      };
    });

    const shippingResults = await Promise.all(shippingPromises);

    // Process shipping results and calculate final totals
    for (const result of shippingResults) {
      const lister = listerData.find((l) => l.listerId === result.listerId);
      if (!lister) continue;

      const { pickupChargeNGN, rateData } = result;

      // Aggregate shipping tiers globally
      for (const rate of rateData) {
        if (!rate.pricingTier) continue;

        const tierCost = Math.ceil((rate.cost || 300000) / 100);
        const existingTier = shippingTiersMap.get(rate.pricingTier);

        if (existingTier) {
          existingTier.totalShippingCost += tierCost;
        } else {
          shippingTiersMap.set(rate.pricingTier, {
            name: rate.pricingTier,
            totalShippingCost: tierCost,
          });
        }
      }

      const baselineShipping = Math.ceil((rateData[0]?.cost || 300000) / 100);
      const listerGrandTotal =
        lister.listerRentalTotal +
        lister.listerCollateralTotal +
        lister.listerCleaningTotal +
        lister.listerPurchaseTotal +
        baselineShipping +
        pickupChargeNGN +
        lister.listerVatTotal +
        lister.listerServiceChargeTotal;

      globalRentalTotal += lister.listerRentalTotal;
      globalCollateralTotal += lister.listerCollateralTotal;
      globalCleaningTotal += lister.listerCleaningTotal;
      globalPickupTotal += pickupChargeNGN;
      globalVatTotal += lister.listerVatTotal;
      globalServiceChargeTotal += lister.listerServiceChargeTotal;
      globalPurchaseTotal += lister.listerPurchaseTotal;

      listerBreakdowns.push({
        listerId: lister.listerId,
        listerName: lister.items[0]?.product?.curator?.name || 'Unknown',
        itemsCount: lister.items.length,
        rentalTotal: lister.listerRentalTotal,
        collateralTotal: lister.listerCollateralTotal,
        cleaningTotal: lister.listerCleaningTotal,
        purchaseTotal: lister.listerPurchaseTotal,
        shippingCost: baselineShipping,
        pickupCost: pickupChargeNGN,
        serviceCharge: lister.listerServiceChargeTotal,
        vatAmount: lister.listerVatTotal,
        listerGrandTotal,
      });
    }

    const itemTotalsBase =
      globalRentalTotal +
      globalCollateralTotal +
      globalCleaningTotal +
      globalPurchaseTotal +
      globalPickupTotal;

    // Map the aggregated shipping tiers into the response array
    const shippingTiers = Array.from(shippingTiersMap.values()).map((tier) => ({
      name: tier.name,
      totalShippingCost: tier.totalShippingCost,
      grandTotal: itemTotalsBase + tier.totalShippingCost,
    }));

    // For backwards compatibility and baseline metrics
    const baselineShippingTotal =
      shippingTiers.length > 0 ? shippingTiers[0].totalShippingCost : 3000;
    const baselineGrandTotal = itemTotalsBase + baselineShippingTotal;

    return {
      success: true,
      message: 'Checkout summary calculated successfully',
      data: {
        summary: {
          rentalTotal: globalRentalTotal,
          collateralTotal: globalCollateralTotal,
          cleaningTotal: globalCleaningTotal,
          purchaseTotal: globalPurchaseTotal,
          pickupTotal: globalPickupTotal,
          shippingTotal: baselineShippingTotal,
          serviceCharge: globalServiceChargeTotal,
          vatAmount: globalVatTotal,
          grandTotal: baselineGrandTotal,
        },
        shippingTiers,
        listerBreakdowns,
      },
    };
  }

  async checkout(user: userEntity, selectedPricingTier?: string) {
    const renterProfile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: { address: true },
    });

    // Topship usually needs cities, fallback if no address
    if (!renterProfile?.address) {
      bad('Please add a delivery address to your profile before checkout.');
    }

    const cart = await this.prisma.cart.findUnique({
      where: { userId: user.id },
      include: {
        items: {
          include: {
            product: {
              include: {
                curator: {
                  include: {
                    profile: { include: { address: true, businessInfo: true } },
                  },
                },
                brand: true,
                category: true,
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      bad('Cart is empty');
    }

    const eligibleItems = await this.cartItemsApprovedForCheckout(
      user.id,
      cart.items,
    );
    if (eligibleItems.length === 0) {
      bad(
        'No items are approved for checkout yet. Wait for lister approval before paying.',
      );
    }

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: user.id },
    });
    if (!wallet) bad('Wallet not found. Please fund your wallet first.');

    const createdOrders: any[] = [];

    // Group items by lister
    const itemsByLister = new Map<string, any[]>();
    for (const item of eligibleItems) {
      const listerId = item.product.curatorId;
      if (!itemsByLister.has(listerId)) {
        itemsByLister.set(listerId, []);
      }
      itemsByLister.get(listerId)!.push(item);
    }

    let grandTotal = 0;
    let totalCollateral = 0;
    const listerOrdersData: any[] = [];

    // Calculate totals and shipping for each lister
    for (const [listerId, items] of itemsByLister.entries()) {
      let listerItemsTotal = 0;
      let listerRentalAndCleaning = 0;
      let listerCollateralTotal = 0;
      let listerVatTotal = 0;
      let listerServiceChargeTotal = 0;
      let curatorAddress: any = null;

      for (const item of items) {
        // Check product is active, verified, and not sold
        if (!item.product.isActive) bad(`${item.product.name} is not active`);
        if (!item.product.productVerified)
          bad(`${item.product.name} is not verified by admin`);
        if (item.product.status === 'SOLD')
          bad(`${item.product.name} is already sold`);

        curatorAddress =
          item.product.curator.profile?.address ||
          item.product.curator.profile?.businessInfo;

        let itemTotal = 0;
        let rentalAmount = 0;
        let collateralAmount = 0;
        let cleaningFee = 0;
        let vatAmount = 0;
        let serviceCharge = 0;

        if (item.product.listingType === 'RESALE') {
          // RESALE flow: only sale price, no collateral or cleaning
          if (!item.product.resalePrice || item.product.resalePrice <= 0) {
            bad(
              `${item.product.name} has invalid resale price for RESALE listing`,
            );
          }
          rentalAmount = 0;
          collateralAmount = 0;
          cleaningFee = 0;
          vatAmount = Math.round(item.product.resalePrice * 0.2);
          serviceCharge = Math.round(item.product.resalePrice * 0.1);
          itemTotal = item.product.resalePrice + vatAmount + serviceCharge;
        } else if (item.product.listingType === 'RENT_OR_RESALE') {
          // RENT_OR_RESALE flow: can be either rental or resale based on context
          if (item.days > 0) {
            // Rental path
            if (!item.product.dailyPrice) {
              bad(`${item.product.name} is missing daily price for rental`);
            }
            rentalAmount = item.product.dailyPrice * item.days;
            collateralAmount =
              Number(
                item.product.collateralPrice || item.product.originalValue,
              ) || 0;
            cleaningFee = DEFAULT_CLEANING_FEE_NGN;
            vatAmount = Math.round(rentalAmount * 0.2);
            serviceCharge = Math.round(rentalAmount * 0.1);
            itemTotal =
              rentalAmount +
              collateralAmount +
              cleaningFee +
              vatAmount +
              serviceCharge;
            listerRentalAndCleaning += rentalAmount + cleaningFee;
          } else {
            // Resale path
            if (!item.product.resalePrice || item.product.resalePrice <= 0) {
              bad(
                `${item.product.name} has invalid resale price for RESALE listing`,
              );
            }
            rentalAmount = 0;
            collateralAmount = 0;
            cleaningFee = 0;
            vatAmount = Math.round(item.product.resalePrice * 0.2);
            serviceCharge = Math.round(item.product.resalePrice * 0.1);
            itemTotal = item.product.resalePrice + vatAmount + serviceCharge;
          }
        } else {
          // RENTAL flow: original logic
          if (item.days <= 0) bad('Invalid rental duration');
          if (!item.product.dailyPrice) {
            bad(
              `${item.product.name} is missing daily price for RENTAL listing`,
            );
          }
          rentalAmount = item.product.dailyPrice * item.days;
          collateralAmount =
            Number(
              item.product.collateralPrice || item.product.originalValue,
            ) || 0;
          cleaningFee = DEFAULT_CLEANING_FEE_NGN;
          vatAmount = Math.round(rentalAmount * 0.2);
          serviceCharge = Math.round(rentalAmount * 0.1);
          itemTotal =
            rentalAmount +
            collateralAmount +
            cleaningFee +
            vatAmount +
            serviceCharge;
          listerRentalAndCleaning += rentalAmount + cleaningFee;
        }

        listerItemsTotal += itemTotal;
        listerCollateralTotal += collateralAmount;
        listerVatTotal += vatAmount;
        listerServiceChargeTotal += serviceCharge;
      }
      totalCollateral += listerCollateralTotal;

      // Calculate shipping & pickup
      // Provide fallback cities if missing in testing
      const senderCity = curatorAddress?.city || 'Lagos'; // Using Lagos as fallback for staging
      const receiverCity = renterProfile.address.city || 'Lagos';

      let pickupChargeRaw = 0;
      let deliveryLocation = '';
      let pickupId = '';
      let pickupPartner = 'Standard';
      try {
        const pickupPayload = {
          senderDetail: {
            addressLine1: curatorAddress?.street || 'Lagos',
            addressLine2: '',
            country: 'Nigeria',
            countryCode: 'NG',
            state: curatorAddress?.state || 'Lagos',
            city: senderCity,
          },
          pickupDate: new Date().toISOString(),
        };
        const pickupData =
          await this.topshipService.getPickupRates(pickupPayload);
        console.log(
          `[OrderService] Fetched Pickup Rates for ${senderCity}:`,
          JSON.stringify(pickupData, null, 2),
        );
        if (pickupData && pickupData.length > 0) {
          pickupChargeRaw = Number(pickupData[0].pickupCharge) || 0;
          deliveryLocation = pickupData[0].deliveryLocation || '';
          pickupId = pickupData[0].pickupId || '';
          pickupPartner = pickupData[0].partner || 'Standard';
        }
      } catch (err: any) {
        console.warn(
          `Pickup calculation failed for ${senderCity}. Reason:`,
          err.message,
        );
      }
      const pickupCostNGN = Math.ceil(pickupChargeRaw / 100);

      let shippingCost = 0;
      let shipmentChargeRaw = 300000;
      try {
        const ratePayload = {
          senderDetails: { cityName: senderCity, countryCode: 'NG' },
          receiverDetails: { cityName: receiverCity, countryCode: 'NG' },
          totalWeight: 1, // Default weight 1kg
        };
        const rateData = await this.topshipService.getShipmentRate(ratePayload);

        let matchedRate = rateData?.[0]; // Default to first available tier
        if (selectedPricingTier && rateData && rateData.length > 0) {
          const exactMatch = rateData.find(
            (r: any) => r.pricingTier === selectedPricingTier,
          );
          if (exactMatch) {
            matchedRate = exactMatch;
          }
        }

        if (matchedRate) {
          shipmentChargeRaw = Number(matchedRate.cost) || 0;
        }
        // Pick selected or fallback price and convert from Kobo to NGN
        shippingCost = Math.ceil(shipmentChargeRaw / 100);
      } catch (err: any) {
        console.warn(
          `Shipping calculation failed between ${senderCity} and ${receiverCity}. Reason:`,
          err.message,
        );
        shippingCost = 3000;
      }

      const listerGrandTotal = listerItemsTotal + shippingCost + pickupCostNGN;
      grandTotal += listerGrandTotal;

      listerOrdersData.push({
        listerId,
        items,
        listerGrandTotal,
        listerRentalAndCleaning,
        listerCollateralTotal,
        listerVatTotal,
        shippingCost,
        usedPricingTier: selectedPricingTier || 'Budget',
        pickupChargeRaw,
        deliveryLocation,
        pickupId,
        pickupPartner,
        shipmentChargeRaw,
      });
    }

    if (wallet.mainBalance < grandTotal) {
      bad(
        `Insufficient wallet balance. Total cost is NGN ${grandTotal}, but your available balance is NGN ${wallet.mainBalance}.`,
      );
    }

    // Process transaction and orders
    await this.prisma.$transaction(
      async (tx) => {
        // 1. Deduct wallet & lock collateral
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            availableBalance: { decrement: grandTotal },
            mainBalance: { decrement: grandTotal - totalCollateral },
            collateralBalance: { increment: totalCollateral },
          },
        });

        // 2. Create Wallet Transaction for Renter
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            amount: -grandTotal, // Negative for deduction
            type: 'MAIN',
            status: 'SUCCESS',
            note:
              'Cart checkout payment for ' +
              eligibleItems.length +
              ' items (Collateral locked: ' +
              totalCollateral +
              ')',
          },
        });

        // 3. Create orders per lister & payout listers
        for (const listerData of listerOrdersData) {
          const now = new Date();
          const expiresAt = addMinutes(now, APPROVAL_WINDOW_MINUTES);

          const orderIdStr = await this.generateOrderId();

          // Fetch lister details to persist
          const lister = await tx.user.findUnique({
            where: { id: listerData.listerId },
            include: {
              profile: {
                include: {
                  businessInfo: true,
                  avatarUpload: { select: { url: true } },
                },
              },
              curatorReviews: true,
            },
          });

          const listerRating =
            lister?.curatorReviews && lister.curatorReviews.length > 0
              ? lister.curatorReviews.reduce(
                  (acc: number, r: any) => acc + r.rating,
                  0,
                ) / lister.curatorReviews.length
              : 0;

          const listerBusinessName =
            lister?.profile?.businessInfo?.businessName ||
            lister?.name ||
            'Unknown';
          const listerImage = lister?.profile?.avatarUpload?.url || null;

          // Calculate lister-specific platform fee (10% of rental + cleaning)
          const listerServiceFee = Math.round(
            listerData.listerRentalAndCleaning * 0.1,
          );

          // Validate product availability inside transaction to prevent race conditions
          for (const item of listerData.items) {
            // Re-check product is active, verified, and not sold
            const product = await tx.product.findUnique({
              where: { id: item.product.id },
            });
            if (!product?.isActive) {
              throw new BadRequestException(
                `${item.product.name} is not active`,
              );
            }
            if (!product?.productVerified) {
              throw new BadRequestException(
                `${item.product.name} is not verified by admin`,
              );
            }
            if (product?.status === 'SOLD') {
              throw new BadRequestException(
                `${item.product.name} is already sold`,
              );
            }

            // Check if product is actively rented or has overlapping rental period (inside transaction for race condition protection)
            const newRentalStart = item.startDate ? new Date(item.startDate) : new Date();
            const newRentalEnd = item.endDate ? new Date(item.endDate) : new Date();
            const bufferDays = 1;
            const bufferMs = bufferDays * 24 * 60 * 60 * 1000;

            const activeRental = await tx.rental.findFirst({
              where: {
                productId: item.product.id,
                isReturned: false,
                OR: [
                  // Current active rental (not yet ended)
                  { endDate: { gt: new Date() } },
                  // Overlapping rental: new start before existing end + buffer
                  {
                    endDate: {
                      gte: new Date(newRentalStart.getTime() - bufferMs),
                    },
                  },
                  // Overlapping rental: new end + buffer after existing start
                  {
                    startDate: {
                      lte: new Date(newRentalEnd.getTime() + bufferMs),
                    },
                  },
                ],
              },
            });
            if (activeRental) {
              throw new BadRequestException(
                `${item.product.name} has an overlapping rental period. Please choose different dates.`,
              );
            }

            // Check for concurrent resale orders (inside transaction for race condition protection)
            const isResaleItem =
              item.product.listingType === 'RESALE' ||
              (item.product.listingType === 'RENT_OR_RESALE' &&
                item.days === 0);

            if (isResaleItem) {
              const activeResaleOrder = await tx.order.findFirst({
                where: {
                  orderItems: {
                    some: {
                      productId: item.product.id,
                    },
                  },
                  listingType: { in: ['RESALE', 'RENT_OR_RESALE'] },
                  status: { in: ['PROCESSING', 'ACCEPTED', 'COMPLETED'] },
                },
              });
              if (activeResaleOrder) {
                throw new BadRequestException(
                  `${item.product.name} already has a pending or completed resale order`,
                );
              }
            }

            // Check for concurrent rental orders to prevent double-renting
            const isRentalItem =
              item.product.listingType === 'RENTAL' ||
              (item.product.listingType === 'RENT_OR_RESALE' &&
                item.days > 0);

            if (isRentalItem) {
              const activeRentalOrder = await tx.order.findFirst({
                where: {
                  orderItems: {
                    some: {
                      productId: item.product.id,
                    },
                  },
                  listingType: { in: ['RENTAL', 'RENT_OR_RESALE'] },
                  status: {
                    in: [
                      'PROCESSING',
                      'ACCEPTED',
                      'ACTIVE',
                      'DELIVERED',
                      'RETURN_DUE',
                    ],
                  },
                },
              });
              if (activeRentalOrder) {
                throw new BadRequestException(
                  `${item.product.name} already has an active rental order`,
                );
              }
            }
          }

          // 3b. Handle payment based on listing type
          const isResaleOrder = listerData.items.some(
            (item) =>
              item.product.listingType === 'RESALE' ||
              (item.product.listingType === 'RENT_OR_RESALE' &&
                item.days === 0),
          );
          const hasRentalItem = listerData.items.some(
            (item) =>
              item.product.listingType === 'RENTAL' ||
              (item.product.listingType === 'RENT_OR_RESALE' && item.days > 0),
          );

          // Support mixed orders - use RENT_OR_RESALE for mixed orders
          const isMixedOrder = isResaleOrder && hasRentalItem;

          // Determine order listing type - use RENT_OR_RESALE for mixed orders
          const orderListingType = isMixedOrder
            ? 'RENT_OR_RESALE'
            : listerData.items[0]?.product?.listingType || 'RENTAL';

          const order = await tx.order.create({
            data: {
              orderId: orderIdStr,
              userId: user.id,
              expiresAt,
              listingType: orderListingType,
              // New persisted fields
              totalAmountPaid: listerData.listerGrandTotal as any,
              deliveryFee:
                listerData.shippingCost +
                Math.ceil(listerData.pickupChargeRaw / 100),
              serviceFee: listerServiceFee,
              vatAmount: listerData.listerVatTotal,
              listerId: listerData.listerId,
              listerBusinessName: listerBusinessName,
              listerImage: listerImage,
              listerRating: listerRating,
            } as any,
          });

          for (const item of listerData.items) {
            // Determine if this item is a resale purchase (days = 0 for RENT_OR_RESALE means resale)
            const isResalePurchase =
              item.product.listingType === 'RESALE' ||
              (item.product.listingType === 'RENT_OR_RESALE' &&
                item.days === 0);
            const collateralFee = isResalePurchase
              ? 0
              : Number(
                  item.product.collateralPrice || item.product.originalValue,
                ) || 0;

            await tx.orderItem.create({
              data: {
                orderId: order.id,
                productId: item.product.id,
                days: isResalePurchase ? 0 : item.days,
                pricePerDay: isResalePurchase
                  ? 0
                  : item.product.dailyPrice || 0,
                // New persisted fields
                imageUrl: (item.product.attachments?.uploads?.[0]?.url ||
                  null) as any,
                rentalFee: isResalePurchase
                  ? 0
                  : (item.product.dailyPrice || 0) * item.days,
                cleaningFee: isResalePurchase ? 0 : DEFAULT_CLEANING_FEE_NGN,
                collateralFee,
              } as any,
            });
          }

          // Set product status based on listing type when order is created (PROCESSING)
          for (const item of listerData.items) {
            const isRentalItem =
              item.product.listingType === 'RENTAL' ||
              (item.product.listingType === 'RENT_OR_RESALE' &&
                item.days > 0);
            const isResaleItem =
              item.product.listingType === 'RESALE' ||
              (item.product.listingType === 'RENT_OR_RESALE' &&
                item.days === 0);

            if (isRentalItem) {
              await tx.product.update({
                where: { id: item.product.id },
                data: { status: 'RENTED' },
              });
            } else if (isResaleItem) {
              await tx.product.update({
                where: { id: item.product.id },
                data: { status: 'SOLD' },
              });
            }
          }

          if (isMixedOrder) {
            // For mixed orders: handle both rental and resale amounts
            const totalRentalAmount = listerData.listerRentalAndCleaning;
            const totalCollateralAmount = listerData.listerCollateralTotal;
            const totalCleaningFee = listerData.items.reduce(
              (sum, item) =>
                sum + (item.days > 0 ? DEFAULT_CLEANING_FEE_NGN : 0),
              0,
            );
            const totalSalePrice = listerData.items.reduce((sum, item) => {
              if (
                item.product.listingType === 'RESALE' ||
                (item.product.listingType === 'RENT_OR_RESALE' &&
                  item.days === 0)
              ) {
                return sum + (item.product.resalePrice || 0);
              }
              return sum;
            }, 0);

            // Create escrow record for mixed order with both amounts
            await tx.escrow.create({
              data: {
                orderId: order.id,
                renterId: user.id,
                curatorId: listerData.listerId,
                rentalAmount: totalRentalAmount,
                resaleAmount: totalSalePrice,
                collateralAmount: totalCollateralAmount,
                cleaningFee: totalCleaningFee,
                status: 'LOCKED',
              },
            });
          } else if (isResaleOrder && !hasRentalItem) {
            // For resale orders: hold payment in escrow until buyer confirms delivery
            // Calculate total sale price for escrow
            const totalSalePrice = listerData.items.reduce((sum, item) => {
              const isResaleItem =
                item.product.listingType === 'RESALE' ||
                (item.product.listingType === 'RENT_OR_RESALE' &&
                  item.days === 0);
              if (isResaleItem) {
                return sum + (item.product.resalePrice || 0);
              }
              return sum;
            }, 0);

            // Create escrow record (no funds moved yet - funds are locked from buyer at checkout)
            await tx.escrow.create({
              data: {
                orderId: order.id,
                renterId: user.id,
                curatorId: listerData.listerId,
                rentalAmount: 0, // No rental amount for pure resale orders
                resaleAmount: totalSalePrice, // Use dedicated resaleAmount field
                collateralAmount: 0,
                cleaningFee: 0,
                status: 'LOCKED',
              },
            });

            // Do NOT credit lister wallet yet - payment released only after buyer confirms
          } else {
            // For rental orders: hold payment in escrow until delivery is confirmed
            // This provides dispute protection - lister only paid after renter confirms receipt
            const totalRentalAmount = listerData.listerRentalAndCleaning;
            const totalCollateralAmount = listerData.listerCollateralTotal;
            const totalCleaningFee = listerData.items.reduce(
              (sum, item) =>
                sum + (item.days > 0 ? DEFAULT_CLEANING_FEE_NGN : 0),
              0,
            );

            // Create escrow record for rental order
            await tx.escrow.create({
              data: {
                orderId: order.id,
                renterId: user.id,
                curatorId: listerData.listerId,
                rentalAmount: totalRentalAmount,
                resaleAmount: 0, // No resale amount for rental orders
                collateralAmount: totalCollateralAmount,
                cleaningFee: totalCleaningFee,
                status: 'LOCKED',
              },
            });

            // Do NOT credit lister wallet yet - payment released only after delivery confirmation
          }

          // 3c. Notify Lister of new order
          await this.notificationService.createNotification({
            userId: listerData.listerId,
            title: 'New Order Received',
            message: `You have a new paid order (${order.orderId}) from ${user.name || 'a renter'}.`,
            type: 'ORDER_CONFIRMATION',
            metadata: { orderId: order.id, orderNumber: order.orderId },
            sendEmail: true,
            emailData: {
              email: lister?.email,
              curatorName: listerBusinessName,
              renterName: user.name || 'A Renter',
              orderId: order.orderId,
              totalAmount: listerData.listerGrandTotal,
              platformName: 'Relisted',
              items: listerData.items.map((item: any) => ({
                productName: item.product.name,
                days: item.days,
                pricePerDay: item.product.dailyPrice,
              })),
            },
          });

          // Emit notification event to lister for resale orders
          const hasResaleItems = listerData.items.some(
            (item) =>
              item.product.listingType === 'RESALE' ||
              (item.product.listingType === 'RENT_OR_RESALE' &&
                item.days === 0),
          );

          if (hasResaleItems) {
            await this.eventEmitter.emit('order.resale.placed', {
              orderId: order.orderId,
              listerId: listerData.listerId,
              listerName: listerBusinessName,
              buyerName: user.name,
              items: listerData.items.filter(
                (item) =>
                  item.product.listingType === 'RESALE' ||
                  (item.product.listingType === 'RENT_OR_RESALE' &&
                    item.days === 0),
              ),
            });
          }

          listerData.orderRef = order;

          createdOrders.push(order);
        }

        // 4. Mark ACCEPTED availability requests as ORDERED
        const cartItemIds = eligibleItems.map((i) => i.id);
        await tx.availabilityRequest.updateMany({
          where: {
            cartItemId: { in: cartItemIds },
            status: 'ACCEPTED',
          },
          data: {
            status: 'ORDERED',
          },
        });

        // 5. Remove only lines that were paid (keep pending / unrequested items)
        await tx.cartItem.deleteMany({
          where: { id: { in: eligibleItems.map((i) => i.id) } },
        });
      },
      { timeout: 30000 },
    );

    // 5. Trigger Topship Save Shipment As Draft automatically (Outside transaction to prevent P2028 Timeouts)
    for (const listerData of listerOrdersData) {
      try {
        const firstItem = listerData.items[0];
        if (!firstItem) continue;

        const curatorProfile = firstItem.product.curator.profile;
        const curatorBusiness = curatorProfile?.businessInfo;
        const curatorAddress = curatorProfile?.address;

        const senderCity =
          curatorBusiness?.city || curatorAddress?.city || 'Lagos';
        const receiverCity = renterProfile.address?.city || 'Lagos';

        const description = listerData.items
          .map((i: any) => {
            const p = i.product;
            return `${p.brand?.name || ''} ${p.name} (${p.color}, ${p.material || ''}, ${p.measurement}, ${p.category?.name || ''})`.trim();
          })
          .join(', ');
        const value = listerData.items.reduce(
          (acc: number, i: any) => acc + i.product.originalValue,
          0,
        );
        const payload = {
          shipment: [
            {
              senderDetail: {
                name:
                  curatorBusiness?.businessName ||
                  firstItem.product.curator.name,
                phoneNumber:
                  curatorBusiness?.businessPhone ||
                  curatorProfile?.phoneNumber ||
                  '08000000000',
                email:
                  curatorBusiness?.businessEmail ||
                  firstItem.product.curator.email ||
                  'lister@relisted.com',
                city: senderCity,
                state: curatorAddress?.state || 'Lagos',
                countryCode: 'NG',
                addressLine1:
                  curatorBusiness?.businessAddress ||
                  curatorAddress?.street ||
                  'Lagos, Nigeria',
                country: 'Nigeria',
                postalCode: curatorAddress?.zipCode,
              },
              receiverDetail: {
                name: user.name || 'Renter',
                phoneNumber: renterProfile.phoneNumber || '08000000000',
                email: user.email || 'renter@relisted.com',
                city: receiverCity,
                state: renterProfile.address?.state || 'Lagos',
                countryCode: 'NG',
                addressLine1: renterProfile.address?.street || 'Lagos, Nigeria',
                country: 'Nigeria',
                postalCode: renterProfile.address?.zipCode || '1111202',
              },
              pricingTier: listerData.usedPricingTier,
              insuranceType: 'None',
              itemCollectionMode: 'PickUp',
              shipmentRoute: 'Domestic',
              insuranceCharge: 0,
              shipmentCharge: listerData.shipmentChargeRaw || 0,
              pickupId: listerData.pickupId || `PICKUP-${Date.now()}`,
              pickupPartner: listerData.pickupPartner || 'Standard',
              pickupCharge: listerData.pickupChargeRaw || 0,
              valueAddedTaxCharge: Math.ceil(
                (listerData.shipmentChargeRaw || 0) * 0.075,
              ),
              discount: 0,
              deliveryLocation:
                listerData.deliveryLocation ||
                renterProfile.address?.street ||
                'Lagos, Nigeria',
              items: [
                {
                  category: 'ClothingAndTextile',
                  description:
                    description.substring(0, 200) || 'Clothing Rental Item',
                  weight: 1,
                  quantity: listerData.items.length,
                  value: Number(value) * 100 || 1000000,
                },
              ],
            },
          ],
        };

        const response = await this.topshipService.bookShipmentAsDraft(payload);
        console.log(
          `[OrderService] Topship Draft Created:`,
          JSON.stringify(response, null, 2),
        );

        const shipmentData = response?.[0] || response?.data?.[0];
        const shipmentId = shipmentData?.id || shipmentData?.shipmentId;
        const trackingId =
          shipmentData?.trackingId || shipmentData?.trackingNumber;

        if (shipmentId) {
          // Update order with Topship IDs
          await this.prisma.order.update({
            where: { id: listerData.orderRef.id },
            data: { shipmentId, trackingId },
          });

          // Trigger Payment
          console.log(`[OrderService] Paying for shipment ${shipmentId}...`);
          try {
            await this.topshipService.payForShipment(shipmentId);
            console.log(
              `[OrderService] Shipment ${shipmentId} paid successfully.`,
            );
          } catch (payErr: any) {
            console.error(
              `[OrderService] Payment for shipment ${shipmentId} failed:`,
              payErr.message,
            );
          }
        }
      } catch (err: any) {
        console.error(
          `Automatic Topship Draft Booking failed for lister ${listerData.listerId}. Order succeeded otherwise. Reason:`,
          err.message,
        );
      }
    }

    const orderIds = createdOrders.map((o: { orderId: string }) => o.orderId);

    return {
      success: true,
      message:
        'Checkout successful. Orders created and awaiting lister confirmation.',
      data: {
        ordersCreated: createdOrders.length,
        totalPaid: grandTotal,
        orders: createdOrders,
        /** All new public order numbers (one per lister). */
        orderIds,
        /**
         * First order’s public id — useful when the UI expects a single `orderId`
         * (multi-lister checkouts create several; use `orderIds` then).
         */
        orderId: orderIds[0],
      },
    };
  }

  async generateOrderId() {
    return `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }

  /**
   * Calculate the amount to release from escrow based on order type and escrow state
   * - RESALE orders: always release resaleAmount
   * - RENTAL orders: always release rentalAmount
   * - RENT_OR_RESALE orders: depends on actual transaction type and escrow state
   * - If escrow is PARTIALLY_RELEASED, rental was already released, so only release resale
   */
  private calculateEscrowReleaseAmount(order: any, escrow: any): number {
    const isRentalTransaction = order.orderItems.some(
      (item: any) => item.days > 0,
    );
    const isResaleTransaction = order.orderItems.some(
      (item: any) => item.days === 0,
    );
    const isPartiallyReleased = escrow.status === 'PARTIALLY_RELEASED';

    if (order.listingType === 'RESALE') {
      return escrow.resaleAmount ?? 0;
    }

    if (order.listingType === 'RENTAL') {
      return escrow.rentalAmount ?? 0;
    }

    if (order.listingType === 'RENT_OR_RESALE') {
      if (isPartiallyReleased) {
        // Rental already released on delivery, only release resale now
        return escrow.resaleAmount ?? 0;
      }

      if (isRentalTransaction && isResaleTransaction) {
        // Mixed order: release both amounts
        return (escrow.rentalAmount ?? 0) + (escrow.resaleAmount ?? 0);
      }

      if (isRentalTransaction) {
        // Pure rental (no resale items)
        return escrow.rentalAmount ?? 0;
      }

      if (isResaleTransaction) {
        // Pure resale (no rental items)
        return escrow.resaleAmount ?? 0;
      }
    }

    return 0;
  }

  async confirmResaleOrder(user: userEntity, orderId: string) {
    try {
      let order: any;
      await this.prisma.$transaction(async (tx) => {
        // Use pessimistic locking to prevent race conditions - lock the row during the initial query
        const lockedOrder = await tx.$queryRaw<
          Array<{
            id: string;
            orderId: string;
            userId: string;
            listingType: string;
            status: string;
            listerId: string | null;
            totalAmountPaid: number | null;
          }>
        >`
          SELECT * FROM "Order"
          WHERE "orderId" = ${orderId}
            AND "userId" = ${user.id}
            AND "listingType" IN ('RESALE', 'RENT_OR_RESALE')
            AND "status" = 'DELIVERED'
          FOR UPDATE
        `;

        if (!lockedOrder || lockedOrder.length === 0) {
          throw new BadRequestException(
            'Order not found or cannot be confirmed',
          );
        }

        // Fetch full order with relations after locking
        order = await tx.order.findFirst({
          where: { id: lockedOrder[0].id },
          include: {
            orderItems: {
              include: {
                product: true,
              },
            },
          },
        });

        if (order.status === 'COMPLETED') {
          throw new BadRequestException('Order is already completed');
        }

        // Validate listerId exists before making any state changes
        const listerId = order.listerId;
        if (!listerId) {
          throw new BadRequestException('Order lister ID is missing');
        }

        // Update order status to COMPLETED
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'COMPLETED' },
        });

        // Update product status to SOLD and deactivate only for resale items
        for (const orderItem of order.orderItems) {
          // Check individual item's listingType to determine if it's a resale purchase
          const itemListingType = (orderItem as any).product?.listingType;
          const isResaleItem =
            itemListingType === 'RESALE' ||
            (itemListingType === 'RENT_OR_RESALE' &&
              (orderItem as any).days === 0);

          if (isResaleItem) {
            await tx.product.update({
              where: { id: orderItem.productId },
              data: {
                status: 'SOLD',
                isActive: false,
              },
            });
          }
        }

        // Release escrow to lister wallet
        const escrow = await tx.escrow.findUnique({
          where: { orderId: order.id },
        });

        // Defensive check: escrow should exist for resale orders
        if (!escrow) {
          throw new BadRequestException(
            'Escrow record not found for this order',
          );
        }

        // Calculate release amount using helper method
        const releaseAmount = this.calculateEscrowReleaseAmount(order, escrow);

        // Determine transaction type for wallet transaction note
        const isRentalTransaction = order.orderItems.some(
          (item: any) => item.days > 0,
        );
        const isResaleTransaction = order.orderItems.some(
          (item: any) => item.days === 0,
        );

        if (releaseAmount > 0) {
          // Credit lister wallet (listerId already validated above)
          const listerWallet = await tx.wallet.upsert({
            where: { userId: listerId },
            create: {
              userId: listerId,
              mainBalance: releaseAmount,
              availableBalance: releaseAmount,
            },
            update: {
              mainBalance: { increment: releaseAmount },
              availableBalance: { increment: releaseAmount },
            },
          });

          // Create wallet transaction for lister
          await tx.walletTransaction.create({
            data: {
              walletId: listerWallet.id,
              amount: releaseAmount,
              type: 'MAIN',
              status: 'SUCCESS',
              note:
                isRentalTransaction && isResaleTransaction
                  ? `Payment released for completed mixed order ${order.orderId} (rental + resale)`
                  : order.listingType === 'RESALE' ||
                      order.listingType === 'RENT_OR_RESALE'
                    ? `Payment released for completed resale order ${order.orderId}`
                    : `Escrow release for completed rental order ${order.orderId}`,
              orderId: order.id,
            },
          });

          // Update escrow status
          await tx.escrow.update({
            where: { id: escrow.id },
            data: {
              status: 'RELEASED',
              releasedAt: new Date(),
            },
          });
        }

        // Send notification to buyer
        await this.notificationService.createNotification({
          userId: user.id,
          title: 'Order Completed',
          message: `Your order ${order.orderId} has been completed and payment has been released to the lister.`,
          type: 'ORDER_COMPLETED',
          metadata: { orderId: order.id, orderNumber: order.orderId },
          sendEmail: true,
          emailData: {
            email: user.email,
            buyerName: user.name || 'Customer',
            orderId: order.orderId,
            totalAmount: order.totalAmountPaid,
            platformName: 'Relisted',
          },
        });

        // Emit notification event to buyer when escrow is released
        await this.eventEmitter.emit('order.escrow.released', {
          orderId: order.orderId,
          buyerId: user.id,
          buyerName: user.name,
          buyerEmail: user.email,
          listerId: order.listerId,
          amount: releaseAmount,
        });
      });

      return {
        success: true,
        message: 'Order confirmed and completed successfully',
        data: {
          orderId: order.orderId,
          status: 'COMPLETED',
        },
      };
    } catch (error) {
      console.error('Confirm order error:', error);
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Failed to confirm order',
      );
    }
  }
}
