import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Order_Verification, Verification_Mail, Password_Reset_Mail } from './event.types';
import { MailService } from '../mail/mail.service';

type NewType = Order_Verification;

@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(private readonly mailService: MailService) {}

  @OnEvent('verification_mail', { async: true })
  async SendUserVerificationMail(
    payload: Verification_Mail | Record<string, unknown>,
  ) {
    try {
      const p =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : null;
      if (
        !p ||
        typeof p.email !== 'string' ||
        typeof p.code !== 'string' ||
        typeof p.name !== 'string' ||
        typeof p.year !== 'number'
      ) {
        this.logger.warn(
          'verification_mail payload missing required fields (email, code, name, year)',
        );
        return;
      }
      const dto = {
        email: p.email,
        code: p.code,
        name: p.name,
        year: p.year,
        ...(typeof p.verificationLink === 'string' && {
          verificationLink: p.verificationLink,
        }),
        ...(typeof p.expiryMinutes === 'number' && {
          expiryMinutes: p.expiryMinutes,
        }),
      };
      await this.mailService.SendVerficationMail(dto);
      this.logger.log(`Verification email sent to ${dto.email}`);
    } catch (err) {
      this.logger.error(
        `Failed to send verification email: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  @OnEvent('Order_Verification', { async: true })
  async SendOrderVerificationMail(payload: NewType) {
    await this.mailService.SendVerificationOrderMail(payload);
  }

  @OnEvent('password_reset_mail', { async: true })
  async SendPasswordResetMail(
    payload: Password_Reset_Mail | Record<string, unknown>,
  ) {
    try {
      const p =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : null;
      if (
        !p ||
        typeof p.email !== 'string' ||
        typeof p.code !== 'string' ||
        typeof p.name !== 'string' ||
        typeof p.year !== 'number'
      ) {
        this.logger.warn(
          'password_reset_mail payload missing required fields (email, code, name, year)',
        );
        return;
      }
      const dto = {
        email: p.email,
        code: p.code,
        name: p.name,
        year: p.year,
        ...(typeof p.expiryMinutes === 'number' && {
          expiryMinutes: p.expiryMinutes,
        }),
      };
      await this.mailService.SendPasswordResetMail(dto);
      this.logger.log(`Password reset email sent to ${dto.email}`);
    } catch (err) {
      this.logger.error(
        `Failed to send password reset email: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
