import { Injectable } from '@nestjs/common';
import { Shipment } from '@prisma/client';
import {
  chowdeckRelayQuotesAvailable,
  shipbubbleQuotesAvailable,
} from 'src/constants/shipping-fulfillment-providers';
import { isShipbubblePricingTier } from 'src/services/shipbubble/shipbubble.service';
import { DeliveryProvider } from './delivery-provider.interface';
import { TopshipProvider } from './providers/topship.provider';
import { ChowdeckRelayProvider } from './providers/chowdeck-relay.provider';
import { ShipbubbleProvider } from './providers/shipbubble.provider';

@Injectable()
export class DeliveryProviderService {
  constructor(
    private readonly topshipProvider: TopshipProvider,
    private readonly chowdeckRelayProvider: ChowdeckRelayProvider,
    private readonly shipbubbleProvider: ShipbubbleProvider,
  ) {}

  /**
   * Routes by persisted `Shipment.pricingTier`: `chowdeck_relay` and `shipbubble`
   * when enabled and configured; everything else uses Topship.
   */
  forShipment(shipment: Shipment): DeliveryProvider {
    const tier = String(shipment.pricingTier ?? '').trim().toLowerCase();
    if (tier === 'chowdeck_relay' && chowdeckRelayQuotesAvailable()) {
      return this.chowdeckRelayProvider;
    }
    if (isShipbubblePricingTier(tier) && shipbubbleQuotesAvailable()) {
      return this.shipbubbleProvider;
    }
    return this.topshipProvider;
  }
}
