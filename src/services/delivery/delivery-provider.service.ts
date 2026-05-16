import { Injectable } from '@nestjs/common';
import { Shipment } from '@prisma/client';
import { chowdeckRelayQuotesAvailable } from 'src/constants/shipping-fulfillment-providers';
import { DeliveryProvider } from './delivery-provider.interface';
import { TopshipProvider } from './providers/topship.provider';
import { ChowdeckRelayProvider } from './providers/chowdeck-relay.provider';

@Injectable()
export class DeliveryProviderService {
  constructor(
    private readonly topshipProvider: TopshipProvider,
    private readonly chowdeckRelayProvider: ChowdeckRelayProvider,
  ) {}

  /**
   * Routes by persisted `Shipment.pricingTier`: `chowdeck_relay` uses Chowdeck Relay
   * when that provider is enabled and configured; everything else uses Topship.
   */
  forShipment(shipment: Shipment): DeliveryProvider {
    const tier = String(shipment.pricingTier ?? '').trim().toLowerCase();
    if (tier === 'chowdeck_relay' && chowdeckRelayQuotesAvailable()) {
      return this.chowdeckRelayProvider;
    }
    return this.topshipProvider;
  }
}
