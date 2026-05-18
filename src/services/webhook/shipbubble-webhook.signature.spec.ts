import { createHmac } from 'crypto';
import { verifyShipbubbleWebhookSignature } from './shipbubble-webhook.signature';

describe('verifyShipbubbleWebhookSignature', () => {
  it('accepts a valid HMAC-SHA512 hex signature', () => {
    const secret = 'test_webhook_secret';
    const body = Buffer.from(JSON.stringify({ event: 'shipment.status.changed' }));
    const signature = createHmac('sha512', secret).update(body).digest('hex');

    expect(verifyShipbubbleWebhookSignature(body, signature, secret)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    const body = Buffer.from('{}');
    expect(
      verifyShipbubbleWebhookSignature(body, 'deadbeef', 'secret'),
    ).toBe(false);
  });
});
