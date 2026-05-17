import {
  canAdvanceShipmentStatus,
  mapProviderStatusToShipmentStatus,
  normalizeProviderStatus,
} from './shipment-provider-status';

describe('shipment-provider-status', () => {
  it('normalizes provider status strings', () => {
    expect(normalizeProviderStatus('In-Transit')).toBe('intransit');
  });

  it('maps shipbubble tiers with shipbubble-specific statuses', () => {
    expect(
      mapProviderStatusToShipmentStatus('pending', 'shipbubble:gokada'),
    ).toBe('DISPATCHED');
    expect(
      mapProviderStatusToShipmentStatus('completed', 'shipbubble:gokada'),
    ).toBe('COMPLETED');
  });

  it('does not apply shipbubble-only map to topship tiers', () => {
    expect(mapProviderStatusToShipmentStatus('pending', 'chowdeck')).toBe(
      undefined,
    );
  });

  it('allows forward-only advancement', () => {
    expect(canAdvanceShipmentStatus('DISPATCHED', 'IN_TRANSIT')).toBe(true);
    expect(canAdvanceShipmentStatus('IN_TRANSIT', 'DISPATCHED')).toBe(false);
    expect(canAdvanceShipmentStatus('PENDING', 'DISPATCHED')).toBe(true);
  });
});
