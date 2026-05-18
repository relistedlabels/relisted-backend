/** Returned on GET /order/summary when an optional carrier quote fails (checkout still proceeds). */
export type ShippingQuoteWarning = {
  provider: string;
  message: string;
  leg: 'outbound' | 'return';
  bucketIndex?: number;
  listerName?: string;
};
