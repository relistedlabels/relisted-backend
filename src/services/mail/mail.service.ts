import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import { VerificationDto, VerifyOrderDto, ResetPasswordDto, RentalRequestDto, RentalResponseDto, WithdrawalDto, ShippingDto } from './mail.type';
import { Auth_Otp_Token_Subject } from '../../module/auth/auth.types';

@Injectable()
export class MailService {
    constructor(private readonly mailerService:MailerService){}
    async SendVerficationMail(dto:VerificationDto){
        const{email,...rest} =dto
        console.log(`[EMAIL] Sending verify-email to ${email}`);
     await this.mailerService.sendMail({
        to:email,
        template:"./verify-email",
        subject:Auth_Otp_Token_Subject.Verify_Email,
        context:rest
     })
    }

    async SendVerificationOrderMail(dto:VerifyOrderDto){
        const {email,...rest} =dto
        console.log(`[EMAIL] Sending confirm-order to ${email}`);
        await this.mailerService.sendMail({
            to:email,
            template:"./confirm-order",
            subject:Auth_Otp_Token_Subject.CONFIRM_ORDER,
            context:rest

        })

    }

    async SendPasswordResetMail(dto: ResetPasswordDto) {
        const { email, ...rest } = dto;
        console.log(`[EMAIL] Sending reset-password to ${email}`);
        await this.mailerService.sendMail({
            to: email,
            template: './reset-password',
            subject: Auth_Otp_Token_Subject.RESET_PASSWORD,
            context: rest,
        });
    }

    async SendRentalRequestMail(dto: RentalRequestDto) {
        const { email, ...rest } = dto;
        const subject = dto.withdrawn
            ? Auth_Otp_Token_Subject.RENTAL_REQUEST_WITHDRAWN
            : Auth_Otp_Token_Subject.RENTAL_REQUEST;
        console.log(`[EMAIL] Sending rental-request to ${email}, withdrawn: ${dto.withdrawn}`);
        await this.mailerService.sendMail({
            to: email,
            template: './rental-request',
            subject,
            context: rest,
        });
    }

    async SendRentalResponseMail(dto: RentalResponseDto) {
        const { email, ...rest } = dto;
        console.log(`[EMAIL] Sending rental-response to ${email}, status: ${dto.status}`);
        await this.mailerService.sendMail({
            to: email,
            template: './rental-response',
            subject: Auth_Otp_Token_Subject.RENTAL_RESPONSE,
            context: rest,
        });
    }

    async SendWithdrawalMail(dto: WithdrawalDto) {
        const { email, ...rest } = dto;
        console.log(`[EMAIL] Sending withdrawal-status to ${email}, status: ${dto.status}`);
        await this.mailerService.sendMail({
            to: email,
            template: './withdrawal-status',
            subject: Auth_Otp_Token_Subject.WITHDRAWAL_STATUS,
            context: rest,
        });
    }

    async SendShippingUpdateMail(dto: ShippingDto) {
        const { email, ...rest } = dto;
        console.log(`[EMAIL] Sending shipping-update to ${email}`);
        await this.mailerService.sendMail({
            to: email,
            template: './shipping-update',
            subject: Auth_Otp_Token_Subject.SHIPPING_UPDATE,
            context: rest,
        });
    }
}
