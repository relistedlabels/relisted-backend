import { ShipmentQuoteService } from './shipment-quote.service';
import { RELISTED_DISPATCH_SHIPPING_LABEL } from 'src/constants/relisted-dispatch-shipping';

describe('ShipmentQuoteService.findTierInPreview', () => {
  const service = new ShipmentQuoteService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const tiers = [
    {
      pricingTier: 'chowdeck',
      name: 'Chowdeck',
      shipmentChargeKobo: 300000,
      pickupChargeKobo: 0,
      vatChargeKobo: 22500,
      totalCostKobo: 322500,
      deltaKobo: 0,
    },
    {
      pricingTier: 'shipbubble:glovo_express',
      name: 'Glovo Express',
      shipmentChargeKobo: 280000,
      pickupChargeKobo: 0,
      vatChargeKobo: 0,
      totalCostKobo: 280000,
      deltaKobo: -42500,
      shipbubbleRequestToken: 'token-1',
      shipbubbleCourierId: 'courier-1',
    },
  ];

  it('returns null when tier is absent from preview', () => {
    expect(service.findTierInPreview(tiers, 'unknown')).toBeNull();
    expect(service.findTierInPreview(tiers, '   ')).toBeNull();
  });

  it('matches pricingTier case-insensitively', () => {
    expect(service.findTierInPreview(tiers, 'CHOWDECK')?.pricingTier).toBe(
      'chowdeck',
    );
  });

  it('matches display name case-insensitively', () => {
    expect(service.findTierInPreview(tiers, 'glovo express')?.pricingTier).toBe(
      'shipbubble:glovo_express',
    );
  });
});

describe('ShipmentQuoteService.tierToShipmentCharges', () => {
  const service = new ShipmentQuoteService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('maps shipbubble tiers to pickup token and courier id', () => {
    const charges = service.tierToShipmentCharges({
      pricingTier: 'shipbubble:glovo_express',
      name: 'Glovo Express',
      shipmentChargeKobo: 280000,
      pickupChargeKobo: 0,
      vatChargeKobo: 0,
      totalCostKobo: 280000,
      deltaKobo: 0,
      shipbubbleRequestToken: ' req-token ',
      shipbubbleCourierId: ' courier-9 ',
    });

    expect(charges).toEqual({
      pricingTier: 'shipbubble:glovo_express',
      shipmentCharge: 280000,
      pickupCharge: 0,
      vatCharge: 0,
      pickupId: 'req-token',
      pickupPartner: 'courier-9',
    });
  });

  it('maps non-shipbubble tiers to topship partner slug', () => {
    const charges = service.tierToShipmentCharges({
      pricingTier: 'chowdeck',
      name: 'Chowdeck',
      shipmentChargeKobo: 300000,
      pickupChargeKobo: 0,
      vatChargeKobo: 22500,
      totalCostKobo: 322500,
      deltaKobo: 0,
    });

    expect(charges.pickupId).toBeNull();
    expect(charges.pickupPartner).toBe('chowdeck');
  });

  it('leaves pickup fields null for Relisted dispatch fallback tier', () => {
    const charges = service.tierToShipmentCharges({
      pricingTier: RELISTED_DISPATCH_SHIPPING_LABEL,
      name: RELISTED_DISPATCH_SHIPPING_LABEL,
      shipmentChargeKobo: 500000,
      pickupChargeKobo: 0,
      vatChargeKobo: 0,
      totalCostKobo: 500000,
      deltaKobo: 0,
    });

    expect(charges.pickupId).toBeNull();
    expect(charges.pickupPartner).toBeNull();
  });
});
