import { MailerService } from '@nestjs-modules/mailer';
import { Injectable } from '@nestjs/common';
import {
  VerificationDto,
  VerifyOrderDto,
  ResetPasswordDto,
  RentalRequestDto,
  RentalResponseDto,
  WithdrawalDto,
  ShippingDto,
  ReturnInitiatedDto,
  ReturnCompletedDto,
  DisputeCreatedDto,
  DisputeStatusDto,
  DisputeMessageDto,
} from './mail.type';
import { Auth_Otp_Token_Subject } from '../../module/auth/auth.types';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import * as Handlebars from 'handlebars';

@Injectable()
export class MailService {
  private readonly devBypass = process.env.DEV_EMAIL_BYPASS === 'true';
  private readonly emailOutputDir = join(process.cwd(), 'dev-emails');

  constructor(private readonly mailerService: MailerService) {
    if (this.devBypass && !existsSync(this.emailOutputDir)) {
      mkdir(this.emailOutputDir, { recursive: true });
    }

    // Register custom helpers
    Handlebars.registerHelper('eq', (v1, v2) => v1 === v2);
    Handlebars.registerHelper('gt', (a: unknown, b: unknown) => Number(a) > Number(b));
    Handlebars.registerHelper('formatDateTime', (isoString: string) => {
      if (!isoString) return '';
      const date = new Date(isoString);
      return date.toLocaleString('en-NG', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    });
    Handlebars.registerHelper('currentYear', () =>
      String(new Date().getFullYear()),
    );
  }

  private async renderTemplateToHtml(
    template: string,
    context: any,
  ): Promise<string> {
    const templatePath = join(
      process.cwd(),
      'src/services/mail/templates',
      `${template}.hbs`,
    );
    const { readFile } = await import('fs/promises');
    const templateContent = await readFile(templatePath, 'utf-8');

    const compiledTemplate = Handlebars.compile(templateContent);
    return compiledTemplate(context);
  }

  private async handleDevBypass(
    template: string,
    subject: string,
    context: any,
    email: string,
  ) {
    console.log(`[DEV EMAIL BYPASS] Would send to: ${email}`);
    console.log(`[DEV EMAIL BYPASS] Subject: ${subject}`);
    console.log(
      `[DEV EMAIL BYPASS] Context:`,
      JSON.stringify(context, null, 2),
    );

    const html = await this.renderTemplateToHtml(template, context);
    const timestamp = Date.now();
    const filename = `${template}-${timestamp}.html`;
    const filepath = join(this.emailOutputDir, filename);

    await writeFile(filepath, html);
    console.log(`[DEV EMAIL BYPASS] Saved to: ${filepath}`);

    const { default: open } = await import('open');
    await open(filepath);
    console.log(`[DEV EMAIL BYPASS] Opened in browser`);
  }

  private async handleDevBypassHtml(
    subject: string,
    html: string,
    email: string,
  ) {
    console.log(`[DEV EMAIL BYPASS] Would send to: ${email}`);
    console.log(`[DEV EMAIL BYPASS] Subject: ${subject}`);

    const timestamp = Date.now();
    const filename = `raw-${timestamp}.html`;
    const filepath = join(this.emailOutputDir, filename);

    await writeFile(filepath, html);
    console.log(`[DEV EMAIL BYPASS] Saved to: ${filepath}`);

    const { default: open } = await import('open');
    await open(filepath);
    console.log(`[DEV EMAIL BYPASS] Opened in browser`);
  }

  async SendVerficationMail(dto: VerificationDto) {
    const { email, ...rest } = dto;
    console.log(`[EMAIL] Sending verify-email to ${email}`);

    if (this.devBypass) {
      await this.handleDevBypass(
        'verify-email',
        Auth_Otp_Token_Subject.Verify_Email,
        rest,
        email,
      );
      return;
    }

    await this.mailerService.sendMail({
      to: email,
      template: './verify-email',
      subject: Auth_Otp_Token_Subject.Verify_Email,
      context: rest,
    });
  }

  async SendVerificationOrderMail(dto: VerifyOrderDto) {
    const { email, ...rest } = dto;
    console.log(`[EMAIL] Sending confirm-order to ${email}`);

    const subject = dto.listerNewOrderConfirmed
      ? Auth_Otp_Token_Subject.LISTER_ORDER_PLACED
      : Auth_Otp_Token_Subject.CONFIRM_ORDER;

    if (this.devBypass) {
      await this.handleDevBypass('confirm-order', subject, rest, email);
      return;
    }

    await this.mailerService.sendMail({
      to: email,
      template: './confirm-order',
      subject,
      context: rest,
    });
  }

  async SendPasswordResetMail(dto: ResetPasswordDto) {
    const { email, ...rest } = dto;
    console.log(`[EMAIL] Sending reset-password to ${email}`);

    if (this.devBypass) {
      await this.handleDevBypass(
        'reset-password',
        Auth_Otp_Token_Subject.RESET_PASSWORD,
        rest,
        email,
      );
      return;
    }

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
    console.log(
      `[EMAIL] Sending rental-request to ${email}, withdrawn: ${dto.withdrawn}`,
    );

    if (this.devBypass) {
      await this.handleDevBypass('rental-request', subject, rest, email);
      return;
    }

    await this.mailerService.sendMail({
      to: email,
      template: './rental-request',
      subject,
      context: rest,
    });
  }

  async SendRentalResponseMail(dto: RentalResponseDto) {
    const { email, ...rest } = dto;
    console.log(
      `[EMAIL] Sending rental-response to ${email}, status: ${dto.status}`,
    );

    if (this.devBypass) {
      await this.handleDevBypass(
        'rental-response',
        Auth_Otp_Token_Subject.RENTAL_RESPONSE,
        rest,
        email,
      );
      return;
    }

    await this.mailerService.sendMail({
      to: email,
      template: './rental-response',
      subject: Auth_Otp_Token_Subject.RENTAL_RESPONSE,
      context: rest,
    });
  }

  async SendWithdrawalMail(dto: WithdrawalDto) {
    const { email, ...rest } = dto;
    console.log(
      `[EMAIL] Sending withdrawal-status to ${email}, status: ${dto.status}`,
    );

    if (this.devBypass) {
      await this.handleDevBypass(
        'withdrawal-status',
        Auth_Otp_Token_Subject.WITHDRAWAL_STATUS,
        rest,
        email,
      );
      return;
    }

    await this.mailerService.sendMail({
      to: email,
      template: './withdrawal-status',
      subject: Auth_Otp_Token_Subject.WITHDRAWAL_STATUS,
      context: rest,
    });
  }

  async SendShippingUpdateMail(dto: ShippingDto) {
    const { email, emailSubject, ...rest } = dto;
    const subject = emailSubject ?? Auth_Otp_Token_Subject.SHIPPING_UPDATE;
    console.log(`[EMAIL] Sending shipping-update to ${email}`);

    if (this.devBypass) {
      await this.handleDevBypass('shipping-update', subject, rest, email);
      return;
    }

    await this.mailerService.sendMail({
      to: email,
      template: './shipping-update',
      subject,
      context: rest,
    });
  }

  async SendReturnInitiatedMail(dto: ReturnInitiatedDto) {
    const { email, ...rest } = dto;
    console.log(`[EMAIL] Sending return-initiated to ${email}`);

    if (this.devBypass) {
      await this.handleDevBypass(
        'return-initiated',
        'Return Request Initiated',
        rest,
        email,
      );
      return;
    }

    await this.mailerService.sendMail({
      to: email,
      template: './return-initiated',
      subject: 'Return Request Initiated',
      context: rest,
    });
  }

  async SendReturnCompletedMail(dto: ReturnCompletedDto) {
    const { email, ...rest } = dto;
    console.log(`[EMAIL] Sending return-completed to ${email}`);

    if (this.devBypass) {
      await this.handleDevBypass(
        'return-completed',
        'Return Completed',
        rest,
        email,
      );
      return;
    }

    await this.mailerService.sendMail({
      to: email,
      template: './return-completed',
      subject: 'Return Completed',
      context: rest,
    });
  }

  async SendDisputeCreatedMail(dto: DisputeCreatedDto) {
    const { email, ...rest } = dto;
    console.log(`[EMAIL] Sending dispute-created to ${email}`);

    if (this.devBypass) {
      await this.handleDevBypass(
        'dispute-created',
        'New Dispute Created',
        rest,
        email,
      );
      return;
    }

    await this.mailerService.sendMail({
      to: email,
      template: './dispute-created',
      subject: 'New Dispute Created',
      context: rest,
    });
  }

  async SendDisputeStatusMail(dto: DisputeStatusDto) {
    const { email, ...rest } = dto;
    console.log(`[EMAIL] Sending dispute-status to ${email}`);
    const subject =
      dto.status === 'created' ? 'New Dispute Created' : 'Dispute Update';

    if (this.devBypass) {
      await this.handleDevBypass('dispute-status', subject, rest, email);
      return;
    }

    await this.mailerService.sendMail({
      to: email,
      template: './dispute-status',
      subject,
      context: rest,
    });
  }

  async SendDisputeMessageMail(dto: DisputeMessageDto) {
    const {
      email,
      recipientName,
      senderName,
      disputeId,
      orderId,
      messagePreview,
      threadLink,
    } = dto;

    const subject = `New message from ${senderName}`;
    console.log(`[EMAIL] Sending dispute-message to ${email}`);

    const safePreview = (messagePreview || '').trim();
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;overflow:hidden;">
    <div style="padding:18px 20px;background:#111827;color:#ffffff;">
      <div style="font-size:14px;opacity:0.9;">Relisted</div>
      <div style="font-size:18px;font-weight:700;margin-top:6px;">You have a new message</div>
    </div>
    <div style="padding:20px;">
      <p style="margin:0 0 12px;">Hello ${recipientName},</p>
      <p style="margin:0 0 16px;color:#374151;"><strong>${senderName}</strong> sent you a new message.</p>
      <div style="border:1px solid #eef0f5;border-radius:10px;padding:14px 16px;background:#fbfbfe;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;color:#111827;">
          <div style="min-width:220px;">
            <div style="font-size:12px;color:#6b7280;">Dispute ID</div>
            <div style="font-weight:600;">${disputeId}</div>
          </div>
          <div style="min-width:220px;">
            <div style="font-size:12px;color:#6b7280;">Order</div>
            <div style="font-weight:600;">${orderId}</div>
          </div>
        </div>
        ${
          safePreview
            ? `<div style="margin-top:12px;">
          <div style="font-size:12px;color:#6b7280;">Message</div>
          <div style="margin-top:6px;color:#111827;line-height:1.45;white-space:pre-wrap;">${safePreview}</div>
        </div>`
            : ''
        }
      </div>
      ${
        threadLink
          ? `<div style="margin-top:18px;">
        <a href="${threadLink}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:600;">
          Open message thread
        </a>
        <div style="margin-top:10px;font-size:12px;color:#6b7280;">
          If the button doesn't work, open: <span style="color:#111827;">${threadLink}</span>
        </div>
      </div>`
          : ''
      }
    </div>
  </div>
</div>`;

    if (this.devBypass) {
      await this.handleDevBypassHtml(subject, html, email);
      return;
    }

    await this.mailerService.sendMail({
      to: email,
      subject,
      html,
    });
  }

  async sendAdminDispatchFailureAlert(dto: {
    to: string;
    shipmentId: string;
    orderId: string;
    shipmentType: string;
    scheduledDate: Date;
    errorMessage: string;
    redispatchUrl: string;
  }) {
    const {
      to,
      shipmentId,
      orderId,
      shipmentType,
      scheduledDate,
      errorMessage,
      redispatchUrl,
    } = dto;
    console.log(`[EMAIL] Sending admin dispatch failure alert to ${to}`);

    const scheduledDateStr = new Date(scheduledDate).toLocaleDateString(
      'en-NG',
      {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      },
    );

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;overflow:hidden;">
    <div style="padding:18px 20px;background:#dc2626;color:#ffffff;">
      <div style="font-size:14px;opacity:0.9;">Relisted Admin Alert</div>
      <div style="font-size:18px;font-weight:700;margin-top:6px;">⚠️ Shipment Dispatch Failed</div>
    </div>
    <div style="padding:20px;">
      <p style="margin:0 0 16px;color:#374151;">A shipment dispatch has failed after 3 retry attempts. Manual action is required.</p>
      <div style="border:1px solid #eef0f5;border-radius:10px;padding:14px 16px;background:#fbfbfe;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;color:#111827;">
          <div style="min-width:220px;">
            <div style="font-size:12px;color:#6b7280;">Shipment ID</div>
            <div style="font-weight:600;">${shipmentId}</div>
          </div>
          <div style="min-width:220px;">
            <div style="font-size:12px;color:#6b7280;">Order ID</div>
            <div style="font-weight:600;">${orderId}</div>
          </div>
          <div style="min-width:220px;">
            <div style="font-size:12px;color:#6b7280;">Type</div>
            <div style="font-weight:600;">${shipmentType}</div>
          </div>
          <div style="min-width:220px;">
            <div style="font-size:12px;color:#6b7280;">Scheduled Date</div>
            <div style="font-weight:600;">${scheduledDateStr}</div>
          </div>
        </div>
        <div style="margin-top:12px;">
          <div style="font-size:12px;color:#6b7280;">Error Message</div>
          <div style="margin-top:6px;color:#dc2626;line-height:1.45;white-space:pre-wrap;">${errorMessage}</div>
        </div>
      </div>
      <div style="margin-top:18px;">
        <a href="${redispatchUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:600;">
          View Shipment & Redispatch
        </a>
        <div style="margin-top:10px;font-size:12px;color:#6b7280;">
          If the button doesn't work, open: <span style="color:#111827;">${redispatchUrl}</span>
        </div>
      </div>
    </div>
  </div>
</div>`;

    if (this.devBypass) {
      await this.handleDevBypassHtml('Admin Dispatch Failure Alert', html, to);
      return;
    }

    await this.mailerService.sendMail({
      to,
      subject: `⚠️ Shipment Dispatch Failed - ${shipmentId}`,
      html,
    });
  }

  async sendAdminShipmentCancelledAlert(dto: {
    to: string;
    shipmentId: string;
    orderId: string;
    shipmentType: string;
    providerStatus: string;
    providerMessage?: string;
    trackingUrl?: string;
    adminShipmentUrl?: string;
  }) {
    const {
      to,
      shipmentId,
      orderId,
      shipmentType,
      providerStatus,
      providerMessage,
      trackingUrl,
      adminShipmentUrl,
    } = dto;

    console.log(
      `[EMAIL] Sending admin shipment cancellation alert to ${to} for shipment ${shipmentId}`,
    );

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;overflow:hidden;">
    <div style="padding:18px 20px;background:#b91c1c;color:#ffffff;">
      <div style="font-size:14px;opacity:0.9;">Relisted Admin Alert</div>
      <div style="font-size:18px;font-weight:700;margin-top:6px;">🚨 Shipment Cancelled by Topship</div>
    </div>
    <div style="padding:20px;">
      <p style="margin:0 0 16px;color:#374151;">Topship reported that this shipment has been cancelled. Please review and take action.</p>
      <div style="border:1px solid #eef0f5;border-radius:10px;padding:14px 16px;background:#fbfbfe;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;color:#111827;">
          <div style="min-width:220px;">
            <div style="font-size:12px;color:#6b7280;">Shipment ID</div>
            <div style="font-weight:600;">${shipmentId}</div>
          </div>
          <div style="min-width:220px;">
            <div style="font-size:12px;color:#6b7280;">Order ID</div>
            <div style="font-weight:600;">${orderId}</div>
          </div>
          <div style="min-width:220px;">
            <div style="font-size:12px;color:#6b7280;">Type</div>
            <div style="font-weight:600;">${shipmentType}</div>
          </div>
          <div style="min-width:220px;">
            <div style="font-size:12px;color:#6b7280;">Provider Status</div>
            <div style="font-weight:600;">${providerStatus}</div>
          </div>
        </div>
        ${
          providerMessage
            ? `<div style="margin-top:12px;">
          <div style="font-size:12px;color:#6b7280;">Provider Message</div>
          <div style="margin-top:6px;color:#111827;line-height:1.45;white-space:pre-wrap;">${providerMessage}</div>
        </div>`
            : ''
        }
      </div>
      <div style="margin-top:18px;display:flex;gap:12px;flex-wrap:wrap;">
        ${
          adminShipmentUrl
            ? `<a href="${adminShipmentUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:600;">View in Admin</a>`
            : ''
        }
        ${
          trackingUrl
            ? `<a href="${trackingUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:600;">Topship Tracking</a>`
            : ''
        }
      </div>
    </div>
  </div>
</div>`;

    if (this.devBypass) {
      await this.handleDevBypassHtml('Admin Shipment Cancelled Alert', html, to);
      return;
    }

    await this.mailerService.sendMail({
      to,
      subject: `🚨 Shipment Cancelled - ${shipmentId}`,
      html,
    });
  }
}
