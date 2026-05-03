import { Injectable } from '@nestjs/common';
import { Shipment } from '@prisma/client';
import { DeliveryProvider } from './delivery-provider.interface';
import { TopshipProvider } from './providers/topship.provider';

@Injectable()
export class DeliveryProviderService {
  constructor(private readonly topshipProvider: TopshipProvider) {}

  /**
   * Returns the correct DeliveryProvider for a given shipment.
   * In v1 all shipments route to Topship.
   * Future: add routing logic here (e.g. Chowdeck Relay for same-day Lagos).
   */
  forShipment(_shipment: Shipment): DeliveryProvider {
    return this.topshipProvider;
  }
}
