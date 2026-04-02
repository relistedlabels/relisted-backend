import { BadRequestException, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus } from '@prisma/client';
import { Order_Verification } from 'src/services/event/event.types';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { TopshipService } from 'src/services/topship/topship.service';
import { bad } from 'src/utils/error';
import { userEntity } from '../auth/auth.types';
import { addMinutes, isAfter } from 'date-fns';
import { NotificationService } from 'src/services/notification/notification.service';

const APPROVAL_WINDOW_MINUTES = 15;

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private topshipService: TopshipService,
    private notificationService: NotificationService,
  ) {}

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

    const itemsByLister = new Map<string, any[]>();
    for (const item of cart.items) {
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
    const listerBreakdowns: any[] = [];
    const shippingTiersMap = new Map<
      string,
      { name: string; totalShippingCost: number }
    >();

    // Calculate totals and shipping for each lister
    for (const [listerId, items] of itemsByLister.entries()) {
      let listerRentalTotal = 0;
      let listerCollateralTotal = 0;
      let listerCleaningTotal = 0;
      let listerVatTotal = 0;
      let listerServiceChargeTotal = 0;
      let curatorAddress: any = null;

      for (const item of items) {
        if (!item.product.isActive) bad(`${item.product.name} is not active`);
        if (item.days <= 0) bad('Invalid rental duration');

        curatorAddress =
          item.product.curator.profile?.address ||
          item.product.curator.profile?.businessInfo;

        const rentalAmount = item.product.dailyPrice * item.days;
        const collateralAmount =
          Number(item.product.collateralPrice || item.product.originalValue) ||
          0;
        const cleaningFee = 2000;
        const vatAmount = Math.round(rentalAmount * 0.2);
        const serviceCharge = Math.round(rentalAmount * 0.1);

        listerRentalTotal += rentalAmount;
        listerCollateralTotal += collateralAmount;
        listerCleaningTotal += cleaningFee;
        listerVatTotal += vatAmount;
        listerServiceChargeTotal += serviceCharge;
      }
      const senderCity = curatorAddress?.city || 'Lagos';
      const receiverCity = renterProfile.address.city || 'Lagos';

      let pickupChargeRaw = 0;
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
        // Fallback if Topship fails to return anything
        rateData = [
          { pricingTier: 'Budget', name: 'Standard (Fallback)', cost: 300000 },
        ]; // 300000 kobo = NGN 3000
      }

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

      // Inside lister Breakdown we assume baseline fallback for backwards compatibility UI,
      // actual final costs will be calculated fully via checkout payload
      const baselineShipping = Math.ceil((rateData[0]?.cost || 300000) / 100);
      const listerGrandTotal =
        listerRentalTotal +
        listerCollateralTotal +
        listerCleaningTotal +
        baselineShipping +
        pickupChargeNGN +
        listerVatTotal +
        listerServiceChargeTotal;

      globalRentalTotal += listerRentalTotal;
      globalCollateralTotal += listerCollateralTotal;
      globalCleaningTotal += listerCleaningTotal;
      globalPickupTotal += pickupChargeNGN;
      globalVatTotal += listerVatTotal;
      globalServiceChargeTotal += listerServiceChargeTotal;
      listerBreakdowns.push({
        listerId,
        listerName: items[0]?.product?.curator?.name || 'Unknown',
        itemsCount: items.length,
        rentalTotal: listerRentalTotal,
        collateralTotal: listerCollateralTotal,
        cleaningTotal: listerCleaningTotal,
        shippingCost: baselineShipping,
        pickupCost: pickupChargeNGN,
        serviceCharge: listerServiceChargeTotal,
        vatAmount: listerVatTotal,
        listerGrandTotal,
      });
    }

    const itemTotalsBase =
      globalRentalTotal +
      globalCollateralTotal +
      globalCleaningTotal +
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

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId: user.id },
    });
    if (!wallet) bad('Wallet not found. Please fund your wallet first.');

    const createdOrders: any[] = [];

    // Group items by lister
    const itemsByLister = new Map<string, any[]>();
    for (const item of cart.items) {
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
        if (!item.product.isActive) bad(`${item.product.name} is not active`);
        if (item.days <= 0) bad('Invalid rental duration');

        curatorAddress =
          item.product.curator.profile?.address ||
          item.product.curator.profile?.businessInfo;

        const rentalAmount = item.product.dailyPrice * item.days;
        const collateralAmount =
          Number(item.product.collateralPrice || item.product.originalValue) ||
          0;
        const cleaningFee = 2000;
        const vatAmount = Math.round(rentalAmount * 0.2);
        const serviceCharge = Math.round(rentalAmount * 0.1);

        listerItemsTotal +=
          rentalAmount +
          collateralAmount +
          cleaningFee +
          vatAmount +
          serviceCharge;
        listerRentalAndCleaning += rentalAmount + cleaningFee;
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
              cart.items.length +
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

          const order = await tx.order.create({
            data: {
              orderId: orderIdStr,
              userId: user.id,
              expiresAt,
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
            await tx.orderItem.create({
              data: {
                orderId: order.id,
                productId: item.product.id,
                days: item.days,
                pricePerDay: item.product.dailyPrice,
                // New persisted fields
                imageUrl: (item.product.images?.[0] || null) as any,
                rentalFee: item.product.dailyPrice * item.days,
                cleaningFee: item.product.cleaningFee || 0,
                collateralFee: item.product.collateralValue || 0,
              } as any,
            });
          }

          // 3b. Credit Lister Wallet (90% of Rental and Cleaning fee)
          const payoutAmount = Math.floor(
            listerData.listerRentalAndCleaning * 1,
          );
          const listerWallet = await tx.wallet.upsert({
            where: { userId: listerData.listerId },
            create: {
              userId: listerData.listerId,
              mainBalance: payoutAmount,
              availableBalance: payoutAmount,
            },
            update: {
              mainBalance: { increment: payoutAmount },
              availableBalance: { increment: payoutAmount },
            },
          });

          await tx.walletTransaction.create({
            data: {
              walletId: listerWallet.id,
              amount: payoutAmount,
              type: 'MAIN',
              status: 'SUCCESS',
              note: `Earning from order ${order.orderId} (100% of rental/cleaning)`,
              orderId: order.id,
            },
          });

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
              approvalLink: `${process.env.CLIENT_URL}/listers/orders/${order.id}`,
              items: listerData.items.map((item: any) => ({
                productName: item.product.name,
                days: item.days,
                pricePerDay: item.product.dailyPrice,
              })),
            },
          });

          listerData.orderRef = order;

          createdOrders.push(order);
        }

        // 4. Clear cart
        await tx.cartItem.deleteMany({
          where: { cartId: cart.id },
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

    return {
      success: true,
      message:
        'Checkout successful. Orders created and awaiting lister confirmation.',
      data: {
        ordersCreated: createdOrders.length,
        totalPaid: grandTotal,
        orders: createdOrders,
      },
    };
  }

  async generateOrderId() {
    return `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }
}
