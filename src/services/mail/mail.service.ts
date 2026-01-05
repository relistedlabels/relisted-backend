import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { VerificationDto } from './mail.type';
import { Auth_Otp_Token_Subject } from '../../module/auth/auth.types';

@Injectable()
export class MailService {
    constructor(private readonly mailerService:MailerService){}
    async SendVerficationMail(dto:VerificationDto){
        const{email,...rest} =dto
     await this.mailerService.sendMail({
        to:email,
        template:"./verify-email",     
        subject:Auth_Otp_Token_Subject.Verify_Email,
        context:rest
     })
    }
}
