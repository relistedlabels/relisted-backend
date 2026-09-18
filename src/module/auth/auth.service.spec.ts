import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { AuthOtpTokenService } from 'src/services/auth-otp-token/auth-otp-token.service';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { UserActivityService } from 'src/services/user-activity/user-activity.service';
import { Auth_Otp_Token_Subject } from './auth.types';

jest.mock('argon2');

const mockPrisma = {
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  authOtpToken: {
    deleteMany: jest.fn(),
    findFirst: jest.fn(),
  },
};

const mockAuthOtpTokenService = {
  createOtp: jest.fn(),
  findCode: jest.fn(),
  verifyOtp: jest.fn(),
  deleteOtp: jest.fn(),
};

const mockUserActivity = {
  recordLogin: jest.fn(),
};

const mockEventEmitter = {
  emit: jest.fn(),
};

const mockJwtService = {
  signAsync: jest.fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuthOtpTokenService, useValue: mockAuthOtpTokenService },
        { provide: UserActivityService, useValue: mockUserActivity },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('creates user, sends verification email, and returns success message', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('hashed-password');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'renter@test.com',
        name: 'Renter',
        role: Role.RENTER,
      });
      mockAuthOtpTokenService.createOtp.mockResolvedValue({
        id: 'otp-1',
        code: 'verify-token',
      });

      const result = await service.register({
        name: 'Renter',
        email: 'renter@test.com',
        password: 'Password123!',
        role: Role.RENTER,
      });

      expect(result).toEqual({ message: 'User successfully registered' });
      expect(mockPrisma.authOtpToken.deleteMany).toHaveBeenCalledWith({
        where: {
          email: 'renter@test.com',
          subject: Auth_Otp_Token_Subject.Verify_Email,
        },
      });
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'verification_mail',
        expect.objectContaining({ email: 'renter@test.com' }),
      );
    });

    it('rejects duplicate email with 400', async () => {
      mockPrisma.user.create.mockRejectedValue({ code: 'P2002' });

      await expect(
        service.register({
          name: 'Renter',
          email: 'exists@test.com',
          password: 'Password123!',
          role: Role.RENTER,
        }),
      ).rejects.toThrow('email already exists');
    });

    it('upgrades an existing guest account instead of rejecting duplicate email', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('hashed-password');
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'guest-1',
        email: 'guest@test.com',
        provider: 'guest',
      });
      mockPrisma.user.update.mockResolvedValue({
        id: 'guest-1',
        email: 'guest@test.com',
        name: 'Guest Upgraded',
        role: Role.RENTER,
      });
      mockAuthOtpTokenService.createOtp.mockResolvedValue({
        id: 'otp-1',
        code: 'verify-token',
      });

      const result = await service.register({
        name: 'Guest Upgraded',
        email: 'guest@test.com',
        password: 'Password123!',
        role: Role.RENTER,
      });

      expect(result).toEqual({ message: 'User successfully registered' });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'guest-1' },
        data: expect.objectContaining({
          name: 'Guest Upgraded',
          password: 'hashed-password',
          provider: null,
          isVerified: false,
          role: Role.RENTER,
        }),
      });
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'verification_mail',
        expect.objectContaining({ email: 'guest@test.com' }),
      );
    });

    it('rejects duplicate email when an existing account is not a guest', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'exists@test.com',
        provider: null,
      });

      await expect(
        service.register({
          name: 'Renter',
          email: 'exists@test.com',
          password: 'Password123!',
          role: Role.RENTER,
        }),
      ).rejects.toThrow('email already exists');
    });
  });

  describe('login', () => {
    const verifiedRenter = {
      id: 'renter-1',
      email: 'renter@test.com',
      name: 'Renter',
      password: 'hashed',
      role: Role.RENTER,
      isVerified: true,
      passwordSetAt: new Date(),
      tokenVersion: 0,
    };

    it('rejects unknown email with 401', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login(
          { email: 'missing@test.com', password: 'Password123!' },
          {},
        ),
      ).rejects.toThrow('invalid credentials');
    });

    it('rejects wrong password with 401', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(verifiedRenter);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login(
          { email: verifiedRenter.email, password: 'wrong' },
          {},
        ),
      ).rejects.toThrow('invalid credential');
    });

    it('rejects guest accounts without a chosen password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...verifiedRenter,
        provider: 'guest',
        passwordSetAt: null,
      });

      await expect(
        service.login(
          { email: verifiedRenter.email, password: 'Password123!' },
          {},
        ),
      ).rejects.toThrow('email login links');
      expect(argon2.verify).not.toHaveBeenCalled();
    });

    it('allows legacy password accounts with null passwordSetAt', async () => {
      const legacyUser = {
        ...verifiedRenter,
        provider: null,
        passwordSetAt: null,
        createdAt: new Date('2026-05-05T12:48:05.175Z'),
      };
      mockPrisma.user.findUnique.mockResolvedValue(legacyUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockJwtService.signAsync.mockResolvedValue('jwt-token');

      const result = await service.login(
        { email: legacyUser.email, password: 'Password123!' },
        {},
      );

      expect(result.token).toBe('jwt-token');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: legacyUser.id },
        data: { passwordSetAt: legacyUser.createdAt },
      });
    });

    it('returns JWT for verified renter login', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(verifiedRenter);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockJwtService.signAsync.mockResolvedValue('jwt-token');

      const result = await service.login(
        { email: verifiedRenter.email, password: 'Password123!' },
        {},
      );

      expect(result).toEqual({
        token: 'jwt-token',
        user: {
          id: verifiedRenter.id,
          email: verifiedRenter.email,
          name: verifiedRenter.name,
          role: verifiedRenter.role,
          isVerified: true,
        },
        requiresMfa: false,
      });
      expect(mockUserActivity.recordLogin).toHaveBeenCalledWith('renter-1');
    });

    it('requires MFA for admin users', async () => {
      const adminUser = {
        ...verifiedRenter,
        id: 'admin-1',
        email: 'admin@test.com',
        role: Role.ADMIN,
      };
      mockPrisma.user.findUnique.mockResolvedValue(adminUser);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockPrisma.authOtpToken.findFirst.mockResolvedValue(null);
      mockAuthOtpTokenService.createOtp.mockResolvedValue({
        id: 'mfa-otp',
        code: '123456',
      });
      mockJwtService.signAsync.mockResolvedValue('session-token');

      const result = await service.login(
        { email: adminUser.email, password: 'Password123!' },
        {},
      );

      expect(result).toEqual({
        requiresMfa: true,
        sessionToken: 'session-token',
        message:
          'MFA code sent to your email. Please verify to complete login.',
      });
    });

    it('blocks unverified user with valid existing token', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...verifiedRenter,
        isVerified: false,
      });
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      mockPrisma.authOtpToken.findFirst.mockResolvedValue({
        id: 'otp-1',
        expiry: new Date(Date.now() + 60_000),
        createdAt: new Date(Date.now() - 120_000),
      });

      await expect(
        service.login(
          { email: verifiedRenter.email, password: 'Password123!' },
          {},
        ),
      ).rejects.toThrow('Please verify your email');
    });
  });

  describe('forgotPassword', () => {
    it('returns generic success when email is unknown', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword({ email: 'ghost@test.com' });

      expect(result.success).toBe(true);
      expect(mockAuthOtpTokenService.createOtp).not.toHaveBeenCalled();
    });
  });
});
