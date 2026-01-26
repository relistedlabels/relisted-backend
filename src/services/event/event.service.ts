import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Order_Verification, Verification_Mail } from './event.types';
import { MailService } from '../mail/mail.service';

type NewType = Order_Verification;

@Injectable()
export class EventService {
  constructor(private readonly mailService: MailService) {}
  @OnEvent('verification_mail', { async: true })
  async SendUserVerificationMail(payload: Verification_Mail) {
    await this.mailService.SendVerficationMail(payload);
  }


    @OnEvent('Order_Verification', { async: true })
  async SendOrderVerificationMail(payload: NewType) {
    await this.mailService.SendVerificationOrderMail(payload);
  }

}
