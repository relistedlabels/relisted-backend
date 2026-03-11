import { BadRequestException, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus } from '@prisma/client';
import { Order_Verification } from 'src/services/event/event.types';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { TopshipService } from 'src/services/topship/topship.service';
import { bad } from 'src/utils/error';
import { userEntity } from '../auth/auth.types';
import { addMinutes, isAfter } from 'date-fns';

const APPROVAL_WINDOW_MINUTES = 15;

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private topshipService: TopshipService,
  ) {}

  async getCheckoutSummary(user: userEntity) {
    const renterProfile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: { address: true }
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
                    profile: { include: { address: true, businessInfo: true } } 
                  } 
                } 
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

    const listerBreakdowns: any[] = [];
    const shippingTiersMap = new Map<string, { name: string; totalShippingCost: number }>();

    // Calculate totals and shipping for each lister
    for (const [listerId, items] of itemsByLister.entries()) {
      let listerRentalTotal = 0;
      let listerCollateralTotal = 0;
      let listerCleaningTotal = 0;
      let curatorAddress: any = null;

      for (const item of items) {
        if (!item.product.isActive) bad(`${item.product.name} is not active`);
        if (item.days <= 0) bad('Invalid rental duration');
        
        curatorAddress = item.product.curator.profile?.address || item.product.curator.profile?.businessInfo;
        
        const rentalAmount = item.product.dailyPrice * item.days;
        const collateralAmount = Number(item.product.originalValue) || 0;
        const cleaningFee = 2000;
        
        listerRentalTotal += rentalAmount;
        listerCollateralTotal += collateralAmount;
        listerCleaningTotal += cleaningFee;
      }

      const senderCity = curatorAddress?.city || 'Lagos';
      const receiverCity = renterProfile.address.city || 'Lagos';
      
      let rateData: any[] = [];
      try {
          const ratePayload = {
            senderDetails: { cityName: senderCity, countryCode: "NG" },
            receiverDetails: { cityName: receiverCity, countryCode: "NG" },
            totalWeight: 1 
          };
          rateData = await this.topshipService.getShipmentRate(ratePayload);
      } catch (err: any) {
         console.warn(`Shipping calculation failed between ${senderCity} and ${receiverCity}. Reason:`, err.message);
      }

      if (!rateData || !rateData.length) {
          // Fallback if Topship fails to return anything
          rateData = [{ pricingTier: 'Budget', name: 'Standard (Fallback)', cost: 300000 }]; // 300000 kobo = NGN 3000
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
                  totalShippingCost: tierCost
              });
          }
      }

      // Inside lister Breakdown we assume baseline fallback for backwards compatibility UI, 
      // actual final costs will be calculated fully via checkout payload
      const baselineShipping = Math.ceil((rateData[0]?.cost || 300000) / 100);
      const listerGrandTotal = listerRentalTotal + listerCollateralTotal + listerCleaningTotal + baselineShipping;
      
      globalRentalTotal += listerRentalTotal;
      globalCollateralTotal += listerCollateralTotal;
      globalCleaningTotal += listerCleaningTotal;
      
      listerBreakdowns.push({
         listerId,
         listerName: items[0]?.product?.curator?.name || 'Unknown',
         itemsCount: items.length,
         rentalTotal: listerRentalTotal,
         collateralTotal: listerCollateralTotal,
         cleaningTotal: listerCleaningTotal,
         shippingCost: baselineShipping,
         listerGrandTotal
      });
    }

    const itemTotalsBase = globalRentalTotal + globalCollateralTotal + globalCleaningTotal;
    
    // Map the aggregated shipping tiers into the response array
    const shippingTiers = Array.from(shippingTiersMap.values()).map(tier => ({
        name: tier.name,
        totalShippingCost: tier.totalShippingCost,
        grandTotal: itemTotalsBase + tier.totalShippingCost
    }));

    // For backwards compatibility and baseline metrics
    const baselineShippingTotal = shippingTiers.length > 0 ? shippingTiers[0].totalShippingCost : 3000;
    const baselineGrandTotal = itemTotalsBase + baselineShippingTotal;

    return {
      success: true,
      message: 'Checkout summary calculated successfully',
      data: {
         summary: {
           rentalTotal: globalRentalTotal,
           collateralTotal: globalCollateralTotal,
           cleaningTotal: globalCleaningTotal,
           shippingTotal: baselineShippingTotal,
           grandTotal: baselineGrandTotal,
         },
         shippingTiers,
         listerBreakdowns
      }
    };
  }

  async checkout(user: userEntity, selectedPricingTier?: string) {
    const renterProfile = await this.prisma.profile.findUnique({
      where: { userId: user.id },
      include: { address: true }
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
                    profile: { include: { address: true, businessInfo: true } } 
                  } 
                } 
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      bad('Cart is empty');
    }
    
    const wallet = await this.prisma.wallet.findUnique({ where: { userId: user.id } });
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
    const listerOrdersData: any[] = [];

    // Calculate totals and shipping for each lister
    for (const [listerId, items] of itemsByLister.entries()) {
      let listerItemsTotal = 0;
      let curatorAddress: any = null;
      
      for (const item of items) {
        if (!item.product.isActive) bad(`${item.product.name} is not active`);
        if (item.days <= 0) bad('Invalid rental duration');
        
        curatorAddress = item.product.curator.profile?.address || item.product.curator.profile?.businessInfo;
        
        const rentalAmount = item.product.dailyPrice * item.days;
        const collateralAmount = Number(item.product.originalValue) || 0;
        const cleaningFee = 2000;
        listerItemsTotal += rentalAmount + collateralAmount + cleaningFee;
      }

      // Calculate shipping
      // Provide fallback cities if missing in testing
      const senderCity = curatorAddress?.city || 'Lagos'; // Using Lagos as fallback for staging
      const receiverCity = renterProfile.address.city || 'Lagos';
      
      let shippingCost = 0;
      try {
          const ratePayload = {
            senderDetails: { cityName: senderCity, countryCode: "NG" },
            receiverDetails: { cityName: receiverCity, countryCode: "NG" },
            totalWeight: 1 // Default weight 1kg
          };
          const rateData = await this.topshipService.getShipmentRate(ratePayload);
          
          let matchedRate = rateData?.[0]; // Default to first available tier
          if (selectedPricingTier && rateData && rateData.length > 0) {
              const exactMatch = rateData.find((r: any) => r.pricingTier === selectedPricingTier);
              if (exactMatch) {
                  matchedRate = exactMatch;
              }
          }
          
          // Pick selected or fallback price and convert from Kobo to NGN
          shippingCost = matchedRate ? Math.ceil(matchedRate.cost / 100) : 3000;
      } catch (err: any) {
         console.warn(`Shipping calculation failed between ${senderCity} and ${receiverCity}. Reason:`, err.message);
         shippingCost = 3000;
      }

      const listerGrandTotal = listerItemsTotal + shippingCost;
      grandTotal += listerGrandTotal;
      
      listerOrdersData.push({
         listerId,
         items,
         listerGrandTotal,
         shippingCost,
         usedPricingTier: selectedPricingTier || 'Budget'
      });
    }

    if (wallet.availableBalance < grandTotal) {
       bad(`Insufficient wallet balance. Total cost is NGN ${grandTotal}, but your available balance is NGN ${wallet.availableBalance}.`);
    }

    // Process transaction and orders
    await this.prisma.$transaction(async (tx) => {
      // 1. Deduct wallet
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          mainBalance: { decrement: grandTotal },
          availableBalance: { decrement: grandTotal }
        }
      });

      // 2. Create Wallet Transaction
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: -grandTotal, // Negative for deduction
          type: 'MAIN',
          status: 'SUCCESS',
          note: 'Cart checkout payment for ' + cart.items.length + ' items',
        }
      });

      // 3. Create orders per lister
      for (const listerData of listerOrdersData) {
        const now = new Date();
        const expiresAt = addMinutes(now, APPROVAL_WINDOW_MINUTES);
        
        const orderIdStr = await this.generateOrderId();
        
        const order = await tx.order.create({
          data: {
            orderId: orderIdStr,
            userId: user.id,
            expiresAt,
          },
        });

        for (const item of listerData.items) {
           await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: item.product.id,
              days: item.days,
              pricePerDay: item.product.dailyPrice,
            },
          });
        }
        
        createdOrders.push(order);
      }

      // 4. Clear cart
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id },
      });
    });

    // 5. Trigger Topship Save Shipment As Draft automatically (Outside transaction to prevent P2028 Timeouts)
    for (const listerData of listerOrdersData) {
      try {
        const firstItem = listerData.items[0];
        if (!firstItem) continue;

        const curatorProfile = firstItem.product.curator.profile;
        const curatorBusiness = curatorProfile?.businessInfo;
        const curatorAddress = curatorProfile?.address;
        
        const senderCity = curatorBusiness?.city || curatorAddress?.city || 'Lagos';
        const receiverCity = renterProfile.address?.city || 'Lagos';
        
        const description = listerData.items.map((i: any) => i.product.name).join(', ');

        const payload = { 
          shipment: [{
            senderDetails: {
              name: curatorBusiness?.businessName || firstItem.product.curator.name,
              phoneNumber: curatorBusiness?.businessPhone || curatorProfile?.phoneNumber || '08000000000',
              email: curatorBusiness?.businessEmail || firstItem.product.curator.email || 'lister@relisted.com',
              cityName: senderCity,
              countryCode: "NG",
              addressLine: curatorBusiness?.businessAddress || curatorAddress?.street || 'Lagos, Nigeria'
            },
            receiverDetails: {
              name: user.name || 'Renter',
              phoneNumber: renterProfile.phoneNumber || '08000000000',
              email: user.email || 'renter@relisted.com',
              cityName: receiverCity,
              countryCode: "NG",
              addressLine: renterProfile.address?.street || 'Lagos, Nigeria'
            },
            pricingTier: listerData.usedPricingTier,
            itemCollectionMode: 'PickUp',
            items: [{
              category: firstItem.product?.category?.name || 'apparel',
              description: description.substring(0, 50) || 'Clothing Rental Item',
              weight: 1,
              quantity: listerData.items.length,
              value: Number(firstItem.product.dailyPrice) || 1000
            }]
          }]
        };

        await this.topshipService.bookShipmentAsDraft(payload);
      } catch (err: any) {
        console.error(`Automatic Topship Draft Booking failed for lister ${listerData.listerId}. Order succeeded otherwise. Reason:`, err.message);
      }
    }

    return {
      success: true,
      message: 'Checkout successful. Orders created and awaiting lister confirmation.',
      data: {
        ordersCreated: createdOrders.length,
        totalPaid: grandTotal,
        orders: createdOrders
      }
    };
  }

  async generateOrderId() {
    return `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }
}
