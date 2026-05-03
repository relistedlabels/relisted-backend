import { Shipment, Order } from '@prisma/client';

export interface DispatchResult {
  providerShipmentId: string;
  providerTrackingUrl?: string | null;
  trackingId?: string | null;
  rawResponse?: any;
}

export interface TrackingStatus {
  status: string;
  location?: string;
  updatedAt?: Date;
  message?: string;
  providerShipmentStatus?: string;
  rawEvents?: any[];
}

/** Topship `track-shipment` expects the carrier tracking reference, not the save-shipment row id. */
export type TrackingLookupRef = {
  providerShipmentId: string;
  trackingId?: string | null;
};

export interface DeliveryProvider {
  dispatch(shipment: Shipment, order: Order): Promise<DispatchResult>;
  getTrackingStatus(ref: TrackingLookupRef): Promise<TrackingStatus>;
  cancelShipment(providerShipmentId: string): Promise<void>;
}
