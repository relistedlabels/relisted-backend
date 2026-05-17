import {
  buildShipbubbleAddressFingerprint,
  normalizeAddressLineForFingerprint,
  shipbubbleApiCacheScope,
} from './shipbubble-address-normalize';

describe('shipbubble address normalize', () => {
  it('treats street abbreviations as equivalent', () => {
    const a = normalizeAddressLineForFingerprint(
      '12 Adeola Odeku St, Victoria Island, Lagos',
    );
    const b = normalizeAddressLineForFingerprint(
      '12 Adeola Odeku Street, Victoria Island, Lagos',
    );
    expect(a).toBe(b);
  });

  it('builds stable hashes for the same normalized contact', () => {
    const contact = {
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '08031234567',
      addressLine: '12 Adeola Odeku St, Lagos',
    };
    const fp1 = buildShipbubbleAddressFingerprint(contact);
    const fp2 = buildShipbubbleAddressFingerprint({
      ...contact,
      addressLine: '12 Adeola Odeku Street, Lagos',
    });
    expect(fp1.addressHash).toBe(fp2.addressHash);
  });

  it('uses different cache hashes for sandbox vs production API keys', () => {
    const contact = {
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '08031234567',
      addressLine: '12 Adeola Odeku St, Lagos',
    };
    const sandbox = buildShipbubbleAddressFingerprint(contact);
    const prev = process.env.SHIPBUBBLE_API_KEY;
    process.env.SHIPBUBBLE_API_KEY = 'sb_prod_test_key';
    const production = buildShipbubbleAddressFingerprint(contact);
    if (prev === undefined) delete process.env.SHIPBUBBLE_API_KEY;
    else process.env.SHIPBUBBLE_API_KEY = prev;

    expect(shipbubbleApiCacheScope('sb_sandbox_x')).toBe('sandbox');
    expect(shipbubbleApiCacheScope('sb_prod_x')).toBe('production');
    expect(sandbox.addressHash).not.toBe(production.addressHash);
  });
});
