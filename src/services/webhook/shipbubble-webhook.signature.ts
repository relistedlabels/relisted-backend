import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verify Shipbubble webhook HMAC-SHA512 signature.
 * Shipbubble signs with SECRET_KEY (= SHIPBUBBLE_API_KEY).
 * @see https://docs.shipbubble.com/api-reference/webhooks
 */
export function verifyShipbubbleWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  const secretTrimmed = String(secret ?? '').trim();
  const signature = String(signatureHeader ?? '').trim();
  if (!secretTrimmed || !signature || !rawBody.length) {
    return false;
  }

  const expected = createHmac('sha512', secretTrimmed)
    .update(rawBody)
    .digest('hex')
    .toLowerCase();

  const provided = signature.toLowerCase();
  if (provided.length !== expected.length) {
    return false;
  }

  try {
    return timingSafeEqual(
      Buffer.from(provided, 'utf8'),
      Buffer.from(expected, 'utf8'),
    );
  } catch {
    return false;
  }
}
