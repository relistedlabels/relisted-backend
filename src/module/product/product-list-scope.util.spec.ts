import { ProductStatus } from '@prisma/client';
import {
  ADMIN_ACTIVE_LISTING_STATUSES,
  AVAILABILITY_TOGGLE_STATUSES,
  isAvailabilityToggleStatus,
  isLiveAdminListingStatus,
} from './product-list-scope.util';

describe('live admin listing status parity', () => {
  it('treats AVAILABLE and APPROVED as equivalent live admin listing statuses', () => {
    expect(ADMIN_ACTIVE_LISTING_STATUSES).toEqual(
      expect.arrayContaining([
        ProductStatus.AVAILABLE,
        ProductStatus.APPROVED,
      ]),
    );
    expect(ADMIN_ACTIVE_LISTING_STATUSES).toHaveLength(2);
  });

  it.each([ProductStatus.AVAILABLE, ProductStatus.APPROVED])(
    'isLiveAdminListingStatus(%s) is true',
    (status) => {
      expect(isLiveAdminListingStatus(status)).toBe(true);
    },
  );

  it.each([ProductStatus.AVAILABLE, ProductStatus.APPROVED])(
    'isAvailabilityToggleStatus(%s) is true for deactivation',
    (status) => {
      expect(isAvailabilityToggleStatus(status)).toBe(true);
    },
  );

  it('allows reactivation from UNAVAILABLE only through availability toggle', () => {
    expect(isLiveAdminListingStatus(ProductStatus.UNAVAILABLE)).toBe(false);
    expect(isAvailabilityToggleStatus(ProductStatus.UNAVAILABLE)).toBe(true);
  });

  it.each([
    ProductStatus.PENDING,
    ProductStatus.REJECTED,
    ProductStatus.RENTED,
    ProductStatus.SOLD,
    ProductStatus.MAINTENANCE,
    ProductStatus.RESERVED,
  ])('blocks non-live status %s from availability toggle', (status) => {
    expect(isLiveAdminListingStatus(status)).toBe(false);
    expect(isAvailabilityToggleStatus(status)).toBe(false);
  });

  it('keeps every admin-active status toggleable for deactivation', () => {
    for (const status of ADMIN_ACTIVE_LISTING_STATUSES) {
      expect(AVAILABILITY_TOGGLE_STATUSES).toContain(status);
    }
  });
});
