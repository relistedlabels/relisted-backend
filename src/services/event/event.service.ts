import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Order_Verification, Verification_Mail } from './event.types';
import { MailService } from '../mail/mail.service';

@Injectable()
export class EventService {
  constructor(private readonly mailService: MailService) {}
  @OnEvent('verification_mail', { async: true })
  async SendUserVerificationMail(payload: Verification_Mail) {
    await this.mailService.SendVerficationMail(payload);
  }


    @OnEvent('Order_Verification', { async: true })
  async SendOrderVerificationMail(payload: Order_Verification) {
    await this.mailService.SendVerificationOrderMail(payload);
  }

}
