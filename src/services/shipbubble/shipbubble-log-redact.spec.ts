import {
  isAllowedShipbubbleCourier,
  redactShipbubbleLogPayload,
  summarizeFetchRatesLogPayload,
} from './shipbubble.service';

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

describe('summarizeFetchRatesLogPayload', () => {
  it('keeps only checkout-eligible couriers in fetch_rates logs', () => {
    const input = {
      status: 'success',
      message: 'Retrieved successfully',
      data: {
        request_token: 'abc123',
        couriers: [
          {
            courier_id: 'gigl',
            courier_name: 'GIG Logistics',
            service_code: 'gigl',
            total: 9765,
          },
          {
            courier_id: 'chowdeck',
            courier_name: 'Chowdeck',
            service_code: 'chowdeck',
            total: 9573.4,
            pickup_eta: 'Within 15 hrs',
            delivery_eta: 'Within 17 hrs',
          },
        ],
      },
    };

    expect(summarizeFetchRatesLogPayload(input)).toEqual({
      status: 'success',
      message: 'Retrieved successfully',
      data: {
        request_token: 'abc123',
        courier_count: 2,
        allowed_courier_count: 1,
        allowed_couriers: [
          {
            courier_id: 'chowdeck',
            courier_name: 'Chowdeck',
            service_code: 'chowdeck',
            total: 9573.4,
            pickup_eta: 'Within 15 hrs',
            delivery_eta: 'Within 17 hrs',
          },
        ],
      },
    });
  });
});

describe('isAllowedShipbubbleCourier', () => {
  it('allows Routelift Same-Day and Economy via service_code', () => {
    expect(
      isAllowedShipbubbleCourier({
        courier_name: 'Routelift (Same-Day)',
        service_code: 'routelift',
      }),
    ).toBe(true);
    expect(
      isAllowedShipbubbleCourier({
        courier_name: 'Routelift (Economy)',
        service_code: 'routelift',
      }),
    ).toBe(true);
  });

  it('rejects unrelated couriers such as GIG', () => {
    expect(
      isAllowedShipbubbleCourier({
        courier_name: 'GIG Logistics',
        service_code: 'gigl',
      }),
    ).toBe(false);
  });
});
