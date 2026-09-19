import { buildListerAvailabilityResponsePageUrl } from './app-urls';

describe('buildListerAvailabilityResponsePageUrl', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env, CLIENT_URL: 'https://dev.relistedlabels.com' };
  });

  afterAll(() => {
    process.env = env;
  });

  it('builds a confirmation page url with response details', () => {
    const url = buildListerAvailabilityResponsePageUrl({
      outcome: 'accepted',
      requestId: 'req_123',
      productName: 'Silk midi dress',
      requestType: 'rental',
    });

    expect(url).toBe(
      'https://dev.relistedlabels.com/shop/availability/lister-response?outcome=accepted&requestId=req_123&productName=Silk+midi+dress&requestType=rental',
    );
  });

  it('returns empty string when client url is unavailable', () => {
    delete process.env.CLIENT_URL;
    delete process.env.FRONTEND_URL;
    process.env.RENDER = 'true';

    expect(
      buildListerAvailabilityResponsePageUrl({ outcome: 'error' }),
    ).toBe('');
  });
});
