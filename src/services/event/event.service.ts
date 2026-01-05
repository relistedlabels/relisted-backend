import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Verification_Mail } from './event.types';
import { MailService } from '../mail/mail.service';

@Injectable()
export class EventService {
  constructor(private readonly mailService: MailService) {}
  @OnEvent('verification_mail', { async: true })
  async SendUserVerificationMail(payload: Verification_Mail) {
    await this.mailService.SendVerficationMail(payload);
  }
}
