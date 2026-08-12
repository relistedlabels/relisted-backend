import { DispatchWindowType } from 'src/utils/dispatch-windows';

export type CartItemDispatchContext = {
  days: number;
  product?: { listingType?: string | null } | null;
};

/** Required dispatch window types for a cart line (rental outbound/return, resale, or both). */
export function resolveRequiredDispatchWindowTypes(
  cartItem: CartItemDispatchContext,
): DispatchWindowType[] {
  const listingType = cartItem.product?.listingType;
  const isRentalItem =
    cartItem.days > 0 &&
    (listingType === 'RENTAL' || listingType === 'RENT_OR_RESALE');
  const isResaleItem =
    cartItem.days === 0 &&
    (listingType === 'RESALE' || listingType === 'RENT_OR_RESALE');

  const required: DispatchWindowType[] = [];
  if (isRentalItem) {
    required.push('OUTBOUND', 'RETURN');
  }
  if (isResaleItem) {
    required.push('RESALE');
  }

  return required;
}
