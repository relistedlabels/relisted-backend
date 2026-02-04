import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { VerificationDto, VerifyOrderDto, ResetPasswordDto } from './mail.type';
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

    async SendVerificationOrderMail(dto:VerifyOrderDto){
        const {email,...rest} =dto
        await this.mailerService.sendMail({
            to:email,
            template:"./confirm-order",
            subject:Auth_Otp_Token_Subject.CONFIRM_ORDER,
            context:rest

        })

    }

    async SendPasswordResetMail(dto: ResetPasswordDto) {
        const { email, ...rest } = dto;
        await this.mailerService.sendMail({
            to: email,
            template: './reset-password',
            subject: Auth_Otp_Token_Subject.RESET_PASSWORD,
            context: rest,
        });
    }
}
