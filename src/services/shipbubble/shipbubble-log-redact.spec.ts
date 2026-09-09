import { redactShipbubbleLogPayload } from './shipbubble.service';

describe('redactShipbubbleLogPayload', () => {
  it('redacts auth headers and secret keys', () => {
    const input = {
      authorization: 'Bearer sk_live_secret',
      api_key: 'key123',
      access_key: 'access456',
      request_token: 'quote-token-abc',
      courier_id: '42',
    };

    expect(redactShipbubbleLogPayload(input)).toEqual({
      authorization: '[REDACTED]',
      api_key: '[REDACTED]',
      access_key: '[REDACTED]',
      request_token: 'quote-token-abc',
      courier_id: '42',
    });
  });

  it('redacts embedded api key strings', () => {
    const apiKey = 'super-secret-key';
    expect(
      redactShipbubbleLogPayload(`prefix ${apiKey} suffix`, { apiKey }),
    ).toBe('prefix [REDACTED] suffix');
  });

  it('redacts Bearer token strings', () => {
    expect(redactShipbubbleLogPayload('Bearer abc.def.ghi')).toBe(
      'Bearer [REDACTED]',
    );
  });
});
