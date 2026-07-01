import { MailerService } from '@nestjs-modules/mailer';
import { Injectable, Logger } from '@nestjs/common';
import {
  VerificationDto,
  VerifyOrderDto,
  ResetPasswordDto,
  RentalRequestDto,
  AvailabilityRequestReminderDto,
  RentalResponseDto,
  WithdrawalDto,
  ShippingDto,
  ReturnInitiatedDto,
  ReturnCompletedDto,
  DisputeCreatedDto,
  DisputeStatusDto,
  DisputeMessageDto,
  ReturnDueReminderDto,
  ReturnRequestReminderDto,
  EscrowReleaseNotificationDto,
  AdminWithdrawalRequestAlertDto,
  ListerReturnInTransitDto,
  ListerReturnDeliveredConfirmDto,
  ListerReturnWindowPassedDto,
} from './mail.type';
import { Auth_Otp_Token_Subject } from '../../module/auth/auth.types';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import * as Handlebars from 'handlebars';
import { ResendService } from './resend.service';
import {
  returnRequestReminderEmailCopy,
  type ReturnRequestReminderType,
} from 'src/module/shipment/return-request-reminder.util';
import { formatDateTimeLagos } from 'src/module/shipment/dispatch-window-format';
import { formatShopSaleNotifyEmailBodyHtml } from '../../module/shop-sale/shop-sale.util';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly devBypass = process.env.DEV_EMAIL_BYPASS === 'true';
  private readonly emailOutputDir = join(process.cwd(), 'dev-emails');

  constructor(
    private readonly mailerService: MailerService,
    private readonly resendService: ResendService,
  ) {
    if (this.devBypass && !existsSync(this.emailOutputDir)) {
      mkdir(this.emailOutputDir, { recursive: true });
    }

    // Register custom helpers
    Handlebars.registerHelper('eq', (v1, v2) => v1 === v2);
    Handlebars.registerHelper('gt', (a: unknown, b: unknown) => Number(a) > Number(b));
    Handlebars.registerHelper('formatDateTime', (isoString: string) =>
      formatDateTimeLagos(isoString),
    );
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

  private isSmtpConfigured(): boolean {
    return Boolean(process.env.MAIL_HOST?.trim());
  }

  /**
   * Prefer Resend when RESEND_API_KEY is set. On Resend failure, send the same HTML via
   * nodemailer when MAIL_HOST is set (e.g. Gmail smtp.gmail.com).
   */
  private async sendViaResendWithSmtpFallback(
    to: string,
    subject: string,
    html: string,
  ): Promise<void> {
    if (!this.resendService.isConfigured()) {
      await this.mailerService.sendMail({ to, subject, html });
      return;
    }

    try {
      await this.resendService.send({ to, subject, html });
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!this.isSmtpConfigured()) {
        this.logger.warn(
          `Resend failed and SMTP is not configured (set MAIL_HOST for fallback). ${message}`,
        );
        throw err;
      }
      this.logger.warn(
        `Resend failed, sending via SMTP fallback. ${message}`,
      );
      await this.mailerService.sendMail({ to, subject, html });
    }
  }

  /**
   * Sends via Resend when RESEND_API_KEY is set (with SMTP fallback on error); otherwise nodemailer (MAIL_HOST).
   */
  private async deliverMail(mail: {
    to: string;
    subject: string;
    template?: string;
    context?: Record<string, unknown>;
    html?: string;
  }): Promise<void> {
    if (mail.html) {
      await this.sendViaResendWithSmtpFallback(
        mail.to,
        mail.subject,
        mail.html,
      );
      return;
    }

    const templatePath = mail.template ?? '';
    const templateName = templatePath.replace(/^\.\//, '');

    if (this.resendService.isConfigured()) {
      const html = await this.renderTemplateToHtml(
        templateName,
        mail.context ?? {},
      );
      await this.sendViaResendWithSmtpFallback(
        mail.to,
        mail.subject,
        html,
      );
      return;
    }

    await this.mailerService.sendMail({
      to: mail.to,
      subject: mail.subject,
      template: templatePath,
      context: mail.context,
    });
  }

  async SendVerficationMail(dto: VerificationDto) {
    const { email, ...rest } = dto;
    const subject = rest.adminMfa
      ? Auth_Otp_Token_Subject.Admin_MFA
      : Auth_Otp_Token_Subject.Verify_Email;
    console.log(`[EMAIL] Sending verify-email to ${email}`);

    if (this.devBypass) {
      await this.handleDevBypass('verify-email', subject, rest, email);
      return;
    }

    await this.deliverMail({
      to: email,
      template: './verify-email',
      subject,
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

    await this.deliverMail({
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

    await this.deliverMail({
      to: email,
      template: './reset-password',
      subject: Auth_Otp_Token_Subject.RESET_PASSWORD,
      context: rest,
    });
  }

  async SendRentalRequestMail(dto: RentalRequestDto) {
    const { email, ...rest } = dto;
    const isPurchase = dto.requestType === 'purchase';
    const subject = dto.withdrawn
      ? isPurchase
        ? Auth_Otp_Token_Subject.PURCHASE_REQUEST_WITHDRAWN
        : Auth_Otp_Token_Subject.RENTAL_REQUEST_WITHDRAWN
      : isPurchase
        ? Auth_Otp_Token_Subject.PURCHASE_REQUEST
        : Auth_Otp_Token_Subject.RENTAL_REQUEST;
    console.log(
      `[EMAIL] Sending rental-request to ${email}, withdrawn: ${dto.withdrawn}`,
    );

    if (this.devBypass) {
      await this.handleDevBypass('rental-request', subject, rest, email);
      return;
    }

    await this.deliverMail({
      to: email,
      template: './rental-request',
      subject,
      context: rest,
    });
  }

  async SendRentalResponseMail(dto: RentalResponseDto) {
    const { email, ...rest } = dto;
    const responseSubject =
      dto.requestType === 'purchase'
        ? Auth_Otp_Token_Subject.PURCHASE_RESPONSE
        : Auth_Otp_Token_Subject.RENTAL_RESPONSE;
    console.log(
      `[EMAIL] Sending rental-response to ${email}, status: ${dto.status}`,
    );

    if (this.devBypass) {
      await this.handleDevBypass(
        'rental-response',
        responseSubject,
        rest,
        email,
      );
      return;
    }

    await this.deliverMail({
      to: email,
      template: './rental-response',
      subject: responseSubject,
      context: rest,
    });
  }

  async sendAvailabilityRequestReminderMail(
    dto: AvailabilityRequestReminderDto,
  ) {
    const { email, intent, requestType, ...rest } = dto;
    const subject =
      intent === 'rerequest'
        ? requestType === 'purchase'
          ? Auth_Otp_Token_Subject.AVAILABILITY_REMINDER_REREQUEST
          : Auth_Otp_Token_Subject.AVAILABILITY_REMINDER_REREQUEST
        : Auth_Otp_Token_Subject.AVAILABILITY_REMINDER_AVAILABLE;

    console.log(
      `[EMAIL] Sending availability-request-reminder to ${email}, intent: ${intent}`,
    );

    if (this.devBypass) {
      await this.handleDevBypass(
        'availability-request-reminder',
        subject,
        { intent, requestType, ...rest },
        email,
      );
      return;
    }

    await this.deliverMail({
      to: email,
      template: './availability-request-reminder',
      subject,
      context: { intent, requestType, ...rest },
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

    await this.deliverMail({
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

    await this.deliverMail({
      to: email,
      template: './shipping-update',
      subject,
      context: rest,
    });
  }

  async SendListerReturnInTransitMail(dto: ListerReturnInTransitDto) {
    const { email, ...rest } = dto;
    console.log(`[EMAIL] Sending lister-return-in-transit to ${email}`);
    if (this.devBypass) {
      await this.handleDevBypass(
        'lister-return-in-transit',
        'Return is on its way to you',
        rest,
        email,
      );
      return;
    }
    await this.deliverMail({
      to: email,
      template: './lister-return-in-transit',
      subject: 'Return on its way to you',
      context: rest,
    });
  }

  async SendListerReturnDeliveredConfirmMail(
    dto: ListerReturnDeliveredConfirmDto,
  ) {
    const { email, ...rest } = dto;
    console.log(`[EMAIL] Sending lister-return-delivered-confirm to ${email}`);
    if (this.devBypass) {
      await this.handleDevBypass(
        'lister-return-delivered-confirm',
        'Confirm return receipt. Order almost complete.',
        rest,
        email,
      );
      return;
    }
    await this.deliverMail({
      to: email,
      template: './lister-return-delivered-confirm',
      subject: 'Confirm return receipt. Finish this rental.',
      context: rest,
    });
  }

  async SendListerReturnWindowPassedMail(dto: ListerReturnWindowPassedDto) {
    const { email, ...rest } = dto;
    console.log(`[EMAIL] Sending lister-return-window-passed to ${email}`);
    if (this.devBypass) {
      await this.handleDevBypass(
        'lister-return-window-passed',
        'Return pickup window has ended',
        rest,
        email,
      );
      return;
    }
    await this.deliverMail({
      to: email,
      template: './lister-return-window-passed',
      subject: 'Return pickup window has ended',
      context: rest,
    });
  }

  async SendReturnInitiatedMail(dto: ReturnInitiatedDto) {
    const { email, ...rest } = dto;
    console.log(`[EMAIL] Sending return-initiated to ${email}`);

    if (this.devBypass) {
      await this.handleDevBypass(
        'return-initiated',
        `Return started. Order ${rest.orderId}.`,
        rest,
        email,
      );
      return;
    }

    await this.deliverMail({
      to: email,
      template: './return-initiated',
      subject: `Return started. Order ${rest.orderId}.`,
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

    await this.deliverMail({
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

    await this.deliverMail({
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

    await this.deliverMail({
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

    await this.deliverMail({
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

    await this.deliverMail({
      to,
      subject: `⚠️ Shipment Dispatch Failed - ${shipmentId}`,
      html,
    });
  }

  async sendAdminManualFulfillmentShipmentAlert(dto: {
    to: string;
    humanOrderId: string;
    shipments: Array<{
      shipmentId: string;
      legLabel: string;
      adminShipmentUrl: string;
    }>;
  }) {
    const { to, humanOrderId, shipments } = dto;
    console.log(
      `[EMAIL] Sending admin manual fulfillment alert to ${to} for order ${humanOrderId} (${shipments.length} leg(s))`,
    );

    const rows = shipments
      .map((s) => {
        const link = s.adminShipmentUrl
          ? `<a href="${s.adminShipmentUrl}" style="color:#1d4ed8;font-weight:600;">Open</a>`
          : '';
        return `<tr>
          <td style="padding:10px 12px;border-bottom:1px solid #eef0f5;vertical-align:top;">
            <div style="font-size:12px;color:#6b7280;">${s.legLabel}</div>
            <div style="font-weight:600;color:#111827;font-family:ui-monospace,monospace;font-size:13px;margin-top:4px;">${s.shipmentId}</div>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #eef0f5;text-align:right;vertical-align:middle;">${link}</td>
        </tr>`;
      })
      .join('');

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;overflow:hidden;">
    <div style="padding:18px 20px;background:#1d4ed8;color:#ffffff;">
      <div style="font-size:14px;opacity:0.9;">Relisted Admin</div>
      <div style="font-size:18px;font-weight:700;margin-top:6px;">Manual Relisted dispatch</div>
    </div>
    <div style="padding:20px;">
      <p style="margin:0 0 16px;color:#374151;line-height:1.5;">This order uses <strong>Relisted dispatch</strong>. No carrier is booked automatically for these legs. Arrange pickup or delivery yourself, then open each shipment below and click <strong>Mark dispatched</strong> when it is on the way.</p>
      <div style="border:1px solid #eef0f5;border-radius:10px;overflow:hidden;background:#fbfbfe;">
        <div style="padding:12px 16px;border-bottom:1px solid #eef0f5;background:#f3f4f6;">
          <div style="font-size:12px;color:#6b7280;">Order</div>
          <div style="font-weight:700;color:#111827;">${humanOrderId}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="background:#fafafa;">
              <th style="text-align:left;padding:8px 12px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">Leg</th>
              <th style="text-align:right;padding:8px 12px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.04em;">Admin</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  </div>
</div>`;

    if (this.devBypass) {
      await this.handleDevBypassHtml(
        `Manual Relisted dispatch: ${humanOrderId}`,
        html,
        to,
      );
      return;
    }

    await this.deliverMail({
      to,
      subject: `Manual Relisted dispatch: order ${humanOrderId}`,
      html,
    });
  }

  async sendAdminManualFulfillmentDueReminder(dto: {
    to: string;
    humanOrderId: string;
    shipmentId: string;
    legLabel: string;
    adminShipmentUrl: string;
    reminderKind: '24_hours' | 'morning_of';
    dueSummary: string;
  }) {
    const {
      to,
      humanOrderId,
      shipmentId,
      legLabel,
      adminShipmentUrl,
      reminderKind,
      dueSummary,
    } = dto;

    const headline =
      reminderKind === '24_hours'
        ? 'Due within 24 hours'
        : 'Due today (Lagos)';
    const subject =
      reminderKind === '24_hours'
        ? `Reminder: manual dispatch within 24h (${humanOrderId})`
        : `Reminder: manual dispatch due today (${humanOrderId})`;

    console.log(
      `[EMAIL] Admin manual dispatch reminder (${reminderKind}) to ${to} shipment ${shipmentId}`,
    );

    const linkBlock = adminShipmentUrl
      ? `<div style="margin-top:18px;">
        <a href="${adminShipmentUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:600;">
          Open shipment in admin
        </a>
        <div style="margin-top:10px;font-size:12px;color:#6b7280;">
          If the button does not work, open: <span style="color:#111827;">${adminShipmentUrl}</span>
        </div>
      </div>`
      : '';

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;overflow:hidden;">
    <div style="padding:18px 20px;background:#b45309;color:#ffffff;">
      <div style="font-size:14px;opacity:0.95;">Relisted Admin</div>
      <div style="font-size:18px;font-weight:700;margin-top:6px;">${headline}</div>
    </div>
    <div style="padding:20px;">
      <p style="margin:0 0 16px;color:#374151;line-height:1.5;">A <strong>Relisted dispatch</strong> leg is still <strong>pending</strong> and is coming up. Arrange pickup or delivery, then click <strong>Mark dispatched</strong> when it is on the way.</p>
      <div style="border:1px solid #eef0f5;border-radius:10px;padding:14px 16px;background:#fbfbfe;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;color:#111827;">
          <div style="min-width:200px;">
            <div style="font-size:12px;color:#6b7280;">Order</div>
            <div style="font-weight:600;">${humanOrderId}</div>
          </div>
          <div style="min-width:200px;">
            <div style="font-size:12px;color:#6b7280;">Leg</div>
            <div style="font-weight:600;">${legLabel}</div>
          </div>
        </div>
        <div style="margin-top:12px;">
          <div style="font-size:12px;color:#6b7280;">Shipment ID</div>
          <div style="font-weight:600;font-family:ui-monospace,monospace;font-size:13px;">${shipmentId}</div>
        </div>
        <div style="margin-top:12px;">
          <div style="font-size:12px;color:#6b7280;">Scheduled window</div>
          <div style="font-weight:600;">${dueSummary}</div>
        </div>
      </div>
      ${linkBlock}
    </div>
  </div>
</div>`;

    if (this.devBypass) {
      await this.handleDevBypassHtml(subject, html, to);
      return;
    }

    await this.deliverMail({
      to,
      subject,
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
    providerLabel?: string;
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
      providerLabel = 'carrier',
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
      <div style="font-size:18px;font-weight:700;margin-top:6px;">🚨 Shipment cancelled by ${providerLabel}</div>
    </div>
    <div style="padding:20px;">
      <p style="margin:0 0 16px;color:#374151;">${providerLabel} reported that this shipment has been cancelled. Please review and take action.</p>
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
            ? `<a href="${trackingUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:600;">${providerLabel} tracking</a>`
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

    await this.deliverMail({
      to,
      subject: `🚨 Shipment Cancelled - ${shipmentId}`,
      html,
    });
  }

  async sendProductAvailableNotifyEmail(dto: {
    email: string;
    userName: string;
    productName: string;
    productUrl: string;
  }) {
    const { email, userName, productName, productUrl } = dto;
    const subject = `${productName} is available to rent again`;
    const safeName = (userName || 'there').replace(/</g, '');
    const safeProduct = (productName || 'This item').replace(/</g, '');

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;overflow:hidden;">
    <div style="padding:18px 20px;background:#111827;color:#ffffff;">
      <div style="font-size:14px;opacity:0.9;">Relisted</div>
      <div style="font-size:18px;font-weight:700;margin-top:6px;">Back in stock</div>
    </div>
    <div style="padding:20px;">
      <p style="margin:0 0 12px;color:#374151;">Hi ${safeName},</p>
      <p style="margin:0 0 16px;color:#374151;">The item you asked us to watch, <strong>${safeProduct}</strong>, is available to rent again on Relisted.</p>
      <a href="${productUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;">View listing</a>
      <p style="margin:20px 0 0;font-size:12px;color:#6b7280;">You received this because you tapped &quot;Notify me when available&quot; while this piece was on rental.</p>
    </div>
  </div>
</div>`;

    if (this.devBypass) {
      await this.handleDevBypassHtml(subject, html, email);
      return;
    }

    await this.deliverMail({
      to: email,
      subject,
      html,
    });
  }

  async sendListingRejectedEmail(dto: {
    email: string;
    userName: string;
    productName: string;
    rejectionReason: string;
    editUrl: string;
  }) {
    const { email, userName, productName, rejectionReason, editUrl } = dto;
    const subject = `Your listing needs changes: ${productName}`;
    const safeName = (userName || 'there').replace(/</g, '');
    const safeProduct = (productName || 'Your item').replace(/</g, '');
    const safeReason = (rejectionReason || '').replace(/</g, '');

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;overflow:hidden;">
    <div style="padding:18px 20px;background:#111827;color:#ffffff;">
      <div style="font-size:14px;opacity:0.9;">Relisted</div>
      <div style="font-size:18px;font-weight:700;margin-top:6px;">Listing not approved</div>
    </div>
    <div style="padding:20px;">
      <p style="margin:0 0 12px;color:#374151;">Hi ${safeName},</p>
      <p style="margin:0 0 16px;color:#374151;">Your listing <strong>${safeProduct}</strong> was not approved.</p>
      <p style="margin:0 0 8px;color:#374151;font-weight:600;">Reason:</p>
      <p style="margin:0 0 16px;color:#374151;white-space:pre-wrap;">${safeReason}</p>
      <p style="margin:0 0 16px;color:#374151;">You can update the item and submit it again for review.</p>
      <a href="${editUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;">Edit listing</a>
    </div>
  </div>
</div>`;

    if (this.devBypass) {
      await this.handleDevBypassHtml(subject, html, email);
      return;
    }

    await this.deliverMail({
      to: email,
      subject,
      html,
    });
  }

  async sendListingApprovedEmail(dto: {
    email: string;
    userName: string;
    productName: string;
    listingUrl: string;
  }) {
    const { email, userName, productName, listingUrl } = dto;
    const subject = `Your listing is live: ${productName}`;
    const safeName = (userName || 'there').replace(/</g, '');
    const safeProduct = (productName || 'Your item').replace(/</g, '');

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;overflow:hidden;">
    <div style="padding:18px 20px;background:#111827;color:#ffffff;">
      <div style="font-size:14px;opacity:0.9;">Relisted</div>
      <div style="font-size:18px;font-weight:700;margin-top:6px;">Listing approved</div>
    </div>
    <div style="padding:20px;">
      <p style="margin:0 0 12px;color:#374151;">Hi ${safeName},</p>
      <p style="margin:0 0 16px;color:#374151;">Great news. Your listing <strong>${safeProduct}</strong> has been approved and is now live on Relisted.</p>
      <a href="${listingUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;">View listing</a>
    </div>
  </div>
</div>`;

    if (this.devBypass) {
      await this.handleDevBypassHtml(subject, html, email);
      return;
    }

    await this.deliverMail({
      to: email,
      subject,
      html,
    });
  }

  async sendAdminNewListingAlert(dto: {
    to: string;
    adminName: string;
    productName: string;
    listingType: string;
    listerName: string;
    listerEmail: string;
    adminLink: string;
  }) {
    const {
      to,
      adminName,
      productName,
      listingType,
      listerName,
      listerEmail,
      adminLink,
    } = dto;
    const safe = (s: string) => s.replace(/</g, '');
    const typeLabel =
      listingType === 'RESALE'
        ? 'Resale'
        : listingType === 'RENT_OR_RESALE'
          ? 'Rental & Resale'
          : 'Rental';
    const subject = `New listing pending review: ${productName}`;

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;overflow:hidden;">
    <div style="padding:18px 20px;background:#111827;color:#ffffff;">
      <div style="font-size:14px;opacity:0.9;">Relisted Admin</div>
      <div style="font-size:18px;font-weight:700;margin-top:6px;">New listing to review</div>
    </div>
    <div style="padding:20px;">
      <p style="margin:0 0 12px;color:#374151;">Hello ${safe(adminName || 'Admin')},</p>
      <p style="margin:0 0 16px;color:#374151;line-height:1.5;">A lister submitted a new item that needs approval before it goes live.</p>
      <div style="border:1px solid #eef0f5;border-radius:10px;padding:14px 16px;background:#fbfbfe;">
        <div style="font-size:12px;color:#6b7280;">Listing</div>
        <div style="font-weight:600;color:#111827;">${safe(productName)}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:12px;">Type</div>
        <div style="font-weight:600;color:#111827;">${typeLabel}</div>
        <div style="font-size:12px;color:#6b7280;margin-top:12px;">Submitted by</div>
        <div style="font-weight:600;color:#111827;">${safe(listerName)}</div>
        <div style="font-size:13px;color:#6b7280;margin-top:4px;">${safe(listerEmail)}</div>
      </div>
      <div style="margin-top:18px;">
        <a href="${adminLink}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:600;">Review pending listings</a>
      </div>
    </div>
  </div>
</div>`;

    if (this.devBypass) {
      await this.handleDevBypassHtml(subject, html, to);
      return;
    }

    await this.deliverMail({ to, subject, html });
  }

  async sendReturnDueReminderMail(dto: ReturnDueReminderDto) {
    const { email, userName, orderId, orderLink, dueDate, productName, reminderType } = dto;
    const is24Hour = reminderType === '24_hours';
    const subject = is24Hour
      ? 'Your rental return pickup is scheduled soon'
      : 'Your rental return pickup is today';
    const safeName = (userName || 'there').replace(/</g, '');
    const safeProduct = (productName || 'your rental item').replace(/</g, '');

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;overflow:hidden;">
    <div style="padding:18px 20px;background:#111827;color:#ffffff;">
      <div style="font-size:14px;opacity:0.9;">Relisted</div>
      <div style="font-size:18px;font-weight:700;margin-top:6px;">${is24Hour ? 'Return Pickup Soon' : 'Return Pickup Today'}</div>
    </div>
    <div style="padding:20px;">
      <p style="margin:0 0 12px;color:#374151;">Hi ${safeName},</p>
      <p style="margin:0 0 16px;color:#374151;">
        ${is24Hour
          ? `Your return pickup for <strong>${safeProduct}</strong> is scheduled within the next 24 hours.`
          : `Your return pickup for <strong>${safeProduct}</strong> is scheduled for today.`
        }
      </p>
      <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:12px;margin:16px 0;">
        <p style="margin:0;color:#9a3412;font-weight:600;">Important:</p>
        <p style="margin:8px 0 0;color:#7c2d12;">
          You must complete your return request in the app first. If the return request is not completed, your return pickup cannot be booked.
        </p>
      </div>
      <div style="border:1px solid #eef0f5;border-radius:10px;padding:14px 16px;background:#fbfbfe;margin:16px 0;">
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">Order ID</div>
        <div style="font-weight:600;color:#111827;">${orderId}</div>
        <div style="font-size:12px;color:#6b7280;margin:16px 0 4px;">Pickup Date</div>
        <div style="font-weight:600;color:#111827;">${dueDate}</div>
      </div>
      <div style="margin:20px 0;">
        <a href="${orderLink}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;">View Order</a>
        <div style="margin-top:10px;font-size:12px;color:#6b7280;">
          If the button doesn't work, open: <span style="color:#111827;">${orderLink}</span>
        </div>
      </div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:16px 0;">
        <p style="margin:0 0 8px;color:#374151;font-weight:600;">How to complete your return request:</p>
        <ol style="margin:0;padding-left:20px;color:#374151;font-size:14px;">
          <li style="margin-bottom:6px;">Open your order using the button above</li>
          <li style="margin-bottom:6px;">Go to the "Ready to Return?" section</li>
          <li style="margin-bottom:6px;">Tap <strong>"Start Return Process"</strong></li>
          <li>Upload current-condition photos and submit</li>
        </ol>
      </div>
      <p style="margin:16px 0 0;color:#374151;">Please ensure your item is ready for return pickup during the scheduled window to avoid any issues.</p>
    </div>
  </div>
</div>`;

    if (this.devBypass) {
      await this.handleDevBypassHtml(subject, html, email);
      return;
    }

    await this.deliverMail({
      to: email,
      subject,
      html,
    });
  }

  async sendReturnRequestReminderMail(dto: ReturnRequestReminderDto) {
    const {
      email,
      userName,
      orderId,
      orderLink,
      productName,
      reminderType,
      windowLabel,
      daysPastDue,
      collateralAtRisk,
      penaltyPercent = 5,
    } = dto;

    const safeName = (userName || 'there').replace(/</g, '');
    const safeProduct = (productName || 'your rental item').replace(/</g, '');
    const type = (reminderType ?? 'morning_of') as ReturnRequestReminderType;
    const isPastDue = type.startsWith('past_due');
    const isUrgent =
      type === '15_minutes' ||
      type === '5_minutes' ||
      type === 'past_due_afternoon' ||
      type === 'past_due_evening';
    const headerBg = isPastDue ? '#991b1b' : isUrgent ? '#b45309' : '#111827';
    const copy = returnRequestReminderEmailCopy(
      type,
      safeProduct,
      windowLabel,
      daysPastDue,
      collateralAtRisk,
      penaltyPercent,
    );

    const collateralBlock =
      isPastDue && collateralAtRisk && collateralAtRisk > 0
        ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin:16px 0;">
        <p style="margin:0 0 8px;color:#991b1b;font-weight:600;">Collateral at risk</p>
        <p style="margin:0;color:#7f1d1d;font-size:14px;">
          Each calendar day your return remains incomplete, up to <strong>${penaltyPercent}%</strong>
          of your collateral (NGN ${collateralAtRisk.toLocaleString()}) may be applied as a late-return penalty.
        </p>
      </div>`
        : '';

    const windowBlock = windowLabel
      ? `<div style="font-size:12px;color:#6b7280;margin:16px 0 4px;">Return window</div>
        <div style="font-weight:600;color:#111827;">${windowLabel}</div>`
      : '';

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;overflow:hidden;">
    <div style="padding:18px 20px;background:${headerBg};color:#ffffff;">
      <div style="font-size:14px;opacity:0.9;">Relisted</div>
      <div style="font-size:18px;font-weight:700;margin-top:6px;">${copy.heading}</div>
    </div>
    <div style="padding:20px;">
      <p style="margin:0 0 12px;color:#374151;">Hi ${safeName},</p>
      <p style="margin:0 0 16px;color:#374151;">${copy.body}</p>
      <div style="border:1px solid #eef0f5;border-radius:10px;padding:14px 16px;background:#fbfbfe;margin:16px 0;">
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">Order ID</div>
        <div style="font-weight:600;color:#111827;">${orderId}</div>
        ${windowBlock}
      </div>
      ${collateralBlock}
      <div style="background:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:12px;margin:16px 0;">
        <p style="margin:0;color:#9a3412;font-weight:600;">You must complete your return request</p>
        <p style="margin:8px 0 0;color:#7c2d12;font-size:14px;">
          A rider will not be sent automatically. Open your order, tap <strong>Start Return Process</strong>, upload photos, and submit. Only then can we book pickup with the carrier.
        </p>
      </div>
      <div style="margin:20px 0;">
        <a href="${orderLink}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;">View Order & Start Return</a>
        <div style="margin-top:10px;font-size:12px;color:#6b7280;">
          If the button doesn't work, open: <span style="color:#111827;">${orderLink}</span>
        </div>
      </div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin:16px 0;">
        <p style="margin:0 0 8px;color:#374151;font-weight:600;">How to complete your return:</p>
        <ol style="margin:0;padding-left:20px;color:#374151;font-size:14px;">
          <li style="margin-bottom:6px;">Open your order using the button above</li>
          <li style="margin-bottom:6px;">Go to the "Ready to Return?" section</li>
          <li style="margin-bottom:6px;">Tap <strong>"Start Return Process"</strong></li>
          <li>Upload current-condition photos and submit</li>
        </ol>
      </div>
      ${copy.footer ? `<p style="margin:16px 0 0;color:#dc2626;font-weight:600;">${copy.footer}</p>` : ''}
    </div>
  </div>
</div>`;

    if (this.devBypass) {
      await this.handleDevBypassHtml(copy.subject, html, email);
      return;
    }

    await this.deliverMail({
      to: email,
      subject: copy.subject,
      html,
    });
  }

  async sendAdminWithdrawalRequestAlert(dto: AdminWithdrawalRequestAlertDto) {
    const {
      email,
      adminName,
      reference,
      amount,
      requesterName,
      requesterEmail,
      requesterRole,
      bankName,
      accountNumber,
      accountName,
      adminLink,
    } = dto;

    const safe = (s: string) => s.replace(/</g, '');
    const amountStr = `NGN ${Number(amount).toLocaleString()}`;
    const subject = `New withdrawal request: ${reference}`;

    console.log(`[EMAIL] Sending admin withdrawal alert to ${email} (${reference})`);

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;overflow:hidden;">
    <div style="padding:18px 20px;background:#111827;color:#ffffff;">
      <div style="font-size:14px;opacity:0.9;">Relisted Admin</div>
      <div style="font-size:18px;font-weight:700;margin-top:6px;">New withdrawal request</div>
    </div>
    <div style="padding:20px;">
      <p style="margin:0 0 12px;color:#374151;">Hello ${safe(adminName || 'Admin')},</p>
      <p style="margin:0 0 16px;color:#374151;line-height:1.5;">A user submitted a withdrawal request that needs review. Open <strong>Payments & balances</strong>, then the <strong>Withdrawals</strong> tab to approve, reject, or mark as paid.</p>
      <div style="border:1px solid #eef0f5;border-radius:10px;padding:14px 16px;background:#fbfbfe;">
        <div style="display:flex;gap:12px;flex-wrap:wrap;color:#111827;">
          <div style="min-width:220px;">
            <div style="font-size:12px;color:#6b7280;">Reference</div>
            <div style="font-weight:600;">${safe(reference)}</div>
          </div>
          <div style="min-width:220px;">
            <div style="font-size:12px;color:#6b7280;">Amount</div>
            <div style="font-weight:600;">${amountStr}</div>
          </div>
          <div style="min-width:220px;">
            <div style="font-size:12px;color:#6b7280;">Requested by</div>
            <div style="font-weight:600;">${safe(requesterName)} (${safe(requesterRole)})</div>
            <div style="font-size:13px;color:#6b7280;margin-top:4px;">${safe(requesterEmail)}</div>
          </div>
          <div style="min-width:220px;">
            <div style="font-size:12px;color:#6b7280;">Bank account</div>
            <div style="font-weight:600;">${safe(bankName)}</div>
            <div style="font-size:13px;color:#111827;margin-top:4px;font-family:ui-monospace,monospace;">${safe(accountNumber)}</div>
            ${accountName ? `<div style="font-size:13px;color:#6b7280;margin-top:4px;">${safe(accountName)}</div>` : ''}
          </div>
        </div>
      </div>
      <div style="margin-top:18px;">
        <a href="${adminLink}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:600;">Review in admin</a>
        <div style="margin-top:10px;font-size:12px;color:#6b7280;">
          If the button does not work, open: <span style="color:#111827;">${adminLink}</span>
        </div>
      </div>
    </div>
  </div>
</div>`;

    if (this.devBypass) {
      await this.handleDevBypassHtml(subject, html, email);
      return;
    }

    await this.deliverMail({ to: email, subject, html });
  }

  async sendEscrowReleaseNotification(dto: EscrowReleaseNotificationDto) {
    const { email, userName, orderId, orderLink, amountReleased, userType, productName } = dto;
    const isRenter = userType === 'renter';
    const clientBase = (process.env.CLIENT_URL || 'https://relisted.com').replace(
      /\/$/,
      '',
    );
    const walletUrl =
      dto.walletUrl ||
      `${clientBase}/${isRenter ? 'renters' : 'listers'}/wallet`;
    const subject = isRenter
      ? 'Your collateral is now available'
      : 'Your rental payout is in your wallet';
    const safeName = (userName || 'there').replace(/</g, '');
    const safeProduct = (productName || 'your order').replace(/</g, '');
    const amountStr = amountReleased
      ? `NGN ${amountReleased.toLocaleString()}`
      : 'Your funds';

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;overflow:hidden;">
    <div style="padding:18px 20px;background:#111827;color:#ffffff;">
      <div style="font-size:14px;opacity:0.9;">Relisted</div>
      <div style="font-size:18px;font-weight:700;margin-top:6px;">${isRenter ? 'Collateral Available' : 'Payout Available'}</div>
    </div>
    <div style="padding:20px;">
      <p style="margin:0 0 12px;color:#374151;">Hi ${safeName},</p>
      <p style="margin:0 0 16px;color:#374151;">
        ${isRenter
          ? `Your collateral for <strong>${safeProduct}</strong> has been returned and is now available in your wallet.`
          : `The rental for <strong>${safeProduct}</strong> is complete. Your earnings (rental fee and cleaning fee, where applicable) have been credited to your wallet.`
        }
      </p>
      <div style="border:1px solid #eef0f5;border-radius:10px;padding:14px 16px;background:#fbfbfe;margin:16px 0;">
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">Order ID</div>
        <div style="font-weight:600;color:#111827;">${orderId}</div>
        <div style="font-size:12px;color:#6b7280;margin:16px 0 4px;">${isRenter ? 'Collateral Returned' : 'Amount Credited'}</div>
        <div style="font-weight:600;color:#111827;">${amountStr}</div>
      </div>
      <div style="margin:20px 0;">
        <a href="${walletUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;margin-right:8px;margin-bottom:8px;">Open wallet</a>
        <a href="${orderLink}" style="display:inline-block;background:#ffffff;color:#111827;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;border:1px solid #d1d5db;margin-bottom:8px;">View order</a>
        <div style="margin-top:10px;font-size:12px;color:#6b7280;">
          Wallet: <a href="${walletUrl}" style="color:#111827;">${walletUrl}</a><br/>
          Order: <span style="color:#111827;">${orderLink}</span>
        </div>
      </div>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin:16px 0;">
        <p style="margin:0 0 10px;color:#374151;font-weight:600;">How to withdraw your funds</p>
        <ul style="margin:0 0 14px;padding-left:20px;color:#374151;font-size:14px;">
          <li style="margin-bottom:6px;">Open your wallet in Relisted.</li>
          <li style="margin-bottom:6px;">Request a withdrawal to your bank account.</li>
          <li>Funds are sent after your withdrawal request is approved.</li>
        </ul>
        <a href="${walletUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:600;">Go to wallet</a>
      </div>
    </div>
  </div>
</div>`;

    if (this.devBypass) {
      await this.handleDevBypassHtml(subject, html, email);
      return;
    }

    await this.deliverMail({
      to: email,
      subject,
      html,
    });
  }

  async sendWalletFundedEmail(dto: {
    email: string;
    name: string;
    amountLabel: string;
    referenceId?: string;
  }) {
    const { email, name, amountLabel, referenceId } = dto;
    const safeName = (name || 'there').replace(/</g, '');
    const subject = 'Your Relisted wallet was funded';
    const refLine = referenceId
      ? `<p style="margin:12px 0 0;color:#374151;font-size:14px;">Reference: <strong>${String(referenceId).replace(/</g, '')}</strong></p>`
      : '';

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f6f7fb;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e6e8ef;border-radius:12px;padding:24px;">
    <p style="margin:0 0 12px;color:#374151;">Hi ${safeName},</p>
    <p style="margin:0 0 8px;color:#374151;">We received a deposit to your virtual account. Your wallet balance has been updated.</p>
    <p style="margin:16px 0 0;font-size:20px;font-weight:700;color:#111827;">${amountLabel}</p>
    ${refLine}
    <p style="margin:24px 0 0;font-size:13px;color:#6b7280;">If you did not expect this, contact support right away.</p>
  </div>
</div>`;

    console.log(`[EMAIL] Sending wallet-funded to ${email}`);

    if (this.devBypass) {
      await this.handleDevBypassHtml(subject, html, email);
      return;
    }

    await this.deliverMail({
      to: email,
      subject,
      html,
    });
  }

  private readonly vaultClosetSaleLiveSubject =
    'The Vault is officially OPEN ✨';

  /**
   * Sends the same Vault Closet sale live email to many addresses.
   * In dev bypass, writes one sample HTML file and opens it in the browser (same as other
   * dev emails; one preview for the whole batch).
   */
  async SendVaultClosetSaleLiveMailBatch(
    emails: string[],
    shopUrl: string,
  ): Promise<{ sent: number; failed: { email: string; error: string }[] }> {
    const context = { shopUrl };
    const failed: { email: string; error: string }[] = [];
    let sent = 0;

    if (this.devBypass) {
      const html = await this.renderTemplateToHtml(
        'vault-closet-sale-live',
        context,
      );
      const filepath = join(
        this.emailOutputDir,
        `vault-closet-sale-live-batch-${Date.now()}.html`,
      );
      await writeFile(filepath, html);
      console.log(
        `[DEV EMAIL BYPASS] Vault Closet sale live batch: ${emails.length} recipient(s). Sample HTML: ${filepath}`,
      );
      const { default: open } = await import('open');
      await open(filepath);
      console.log('[DEV EMAIL BYPASS] Opened in browser');
      return { sent: emails.length, failed: [] };
    }

    for (const email of emails) {
      try {
        await this.deliverMail({
          to: email,
          template: './vault-closet-sale-live',
          subject: this.vaultClosetSaleLiveSubject,
          context,
        });
        sent++;
      } catch (err) {
        failed.push({
          email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { sent, failed };
  }

  async sendShopSaleLiveMailBatch(
    emails: string[],
    shopUrl: string,
    options: { headline: string; subject: string; body?: string | null },
  ): Promise<{ sent: number; failed: { email: string; error: string }[] }> {
    const context = {
      shopUrl,
      headline: options.headline,
      emailBodyHtml: formatShopSaleNotifyEmailBodyHtml(options.body),
      currentYear: new Date().getFullYear(),
    };
    const failed: { email: string; error: string }[] = [];
    let sent = 0;

    if (this.devBypass) {
      const html = await this.renderTemplateToHtml('shop-sale-live', context);
      const filepath = join(
        this.emailOutputDir,
        `shop-sale-live-batch-${Date.now()}.html`,
      );
      await writeFile(filepath, html);
      console.log(
        `[DEV EMAIL BYPASS] Shop sale live batch: ${emails.length} recipient(s). Sample HTML: ${filepath}`,
      );
      const { default: open } = await import('open');
      await open(filepath);
      return { sent: emails.length, failed: [] };
    }

    for (const email of emails) {
      try {
        await this.deliverMail({
          to: email,
          template: './shop-sale-live',
          subject: options.subject,
          context,
        });
        sent++;
      } catch (err) {
        failed.push({
          email,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { sent, failed };
  }
}
