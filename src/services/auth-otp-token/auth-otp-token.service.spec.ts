import { AuthOtpTokenService } from './auth-otp-token.service';

describe('AuthOtpTokenService', () => {
  const mockPrisma = {
    authOtpToken: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  };

  let service: AuthOtpTokenService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthOtpTokenService(mockPrisma as any);
  });

  it('verifies a token by code and subject', async () => {
    mockPrisma.authOtpToken.findUnique.mockResolvedValue({
      id: 'token-1',
      code: 'abc',
      subject: 'Sign in to Relisted',
      expiry: new Date(Date.now() + 60_000),
    });
    mockPrisma.authOtpToken.delete.mockResolvedValue({});

    const valid = await service.verifyOtp(
      { code: 'abc', subject: 'Sign in to Relisted' },
      true,
    );

    expect(valid).toBe(true);
    expect(mockPrisma.authOtpToken.findUnique).toHaveBeenCalledWith({
      where: { code: 'abc' },
    });
  });

  it('rejects a token when the subject does not match', async () => {
    mockPrisma.authOtpToken.findUnique.mockResolvedValue({
      id: 'token-1',
      code: 'abc',
      subject: 'verify email',
      expiry: new Date(Date.now() + 60_000),
    });

    await expect(
      service.verifyOtp({ code: 'abc', subject: 'Sign in to Relisted' }, true),
    ).rejects.toThrow('invalid token');
  });
});
