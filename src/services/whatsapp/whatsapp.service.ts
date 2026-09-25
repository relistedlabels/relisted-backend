import { Injectable, Logger } from '@nestjs/common';
import twilio from 'twilio';

export type ListerAvailabilityWhatsAppParams = {
  toPhone: string;
  listerName: string;
  productName: string;
  renterName: string;
  datesLabel: string;
  deliveryWindowLabel: string;
  returnWindowLabel: string;
  payoutLabel: string;
  acceptUrl?: string;
  rejectUrl?: string;
  viewUrl?: string;
  requestId: string;
};

export type ListerPurchaseWhatsAppParams = {
  toPhone: string;
  listerName: string;
  renterName: string;
  productName: string;
  deliveryWindowLabel: string;
  payoutLabel: string;
  viewUrl?: string;
  requestId: string;
};

export type RenterReturnReminderWhatsAppParams = {
  toPhone: string;
  renterName: string;
  productName: string;
  pickupLabel: string;
};

export type WhatsAppOutbound =
  | { kind: 'lister_availability'; params: ListerAvailabilityWhatsAppParams }
  | { kind: 'lister_purchase'; params: ListerPurchaseWhatsAppParams }
  | { kind: 'renter_return_reminder'; params: RenterReturnReminderWhatsAppParams };

/** Strip non-digits for phone comparison and E.164 assembly. */
export function normalizePhoneDigits(phone: string): string {
  return phone.replace(/^whatsapp:/i, '').replace(/\D/g, '');
}

/** Format a stored phone number for Twilio WhatsApp `to` / `from` addresses. */
export function toWhatsAppAddress(phone: string): string | null {
  let digits = normalizePhoneDigits(phone);
  if (!digits) {
    return null;
  }
  if (digits.startsWith('0') && digits.length >= 10) {
    digits = `234${digits.slice(1)}`;
  }
  return `whatsapp:+${digits}`;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private client: ReturnType<typeof twilio> | null = null;

  isConfigured(): boolean {
    return Boolean(
      process.env.TWILIO_ACCOUNT_SID?.trim() &&
        process.env.TWILIO_AUTH_TOKEN?.trim() &&
        process.env.TWILIO_WHATSAPP_FROM?.trim(),
    );
  }

  isEnabled(): boolean {
    return process.env.TWILIO_WHATSAPP_ENABLED !== '0';
  }

  private getClient(): ReturnType<typeof twilio> | null {
    if (!this.isConfigured()) {
      return null;
    }
    if (!this.client) {
      this.client = twilio(
        process.env.TWILIO_ACCOUNT_SID!.trim(),
        process.env.TWILIO_AUTH_TOKEN!.trim(),
      );
    }
    return this.client;
  }

  validateWebhookSignature(
    url: string,
    params: Record<string, string>,
    signature: string | undefined,
  ): boolean {
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (!authToken) {
      if (process.env.NODE_ENV === 'production') {
        return false;
      }
      if (process.env.TWILIO_WEBHOOK_SKIP_VERIFY === '1') {
        this.logger.warn(
          'Twilio webhook signature verification skipped (TWILIO_WEBHOOK_SKIP_VERIFY=1)',
        );
        return true;
      }
      return false;
    }
    if (!signature?.trim()) {
      return false;
    }
    return twilio.validateRequest(authToken, signature, url, params);
  }

  async sendListerAvailabilityRequest(
    params: ListerAvailabilityWhatsAppParams,
  ): Promise<boolean> {
    return this.deliver({
      toPhone: params.toPhone,
      contentSidEnvKey: 'TWILIO_CONTENT_SID_LISTER_AVAILABILITY',
      variables: {
        '1': params.listerName,
        '2': params.productName,
        '3': params.renterName,
        '4': params.datesLabel,
        '5': params.deliveryWindowLabel,
        '6': params.returnWindowLabel,
        '7': params.payoutLabel,
      },
      fallbackBody: [
        `Hi ${params.listerName}, someone wants to rent your ${params.productName} on Relisted!`,
        '',
        `${params.renterName} requested it for: ${params.datesLabel}`,
        '',
        `Delivery: ${params.deliveryWindowLabel}`,
        `Return: ${params.returnWindowLabel}`,
        '',
        `Your payout: NGN ${params.payoutLabel}`,
        '',
        'Reply YES to confirm or NO to decline.',
        params.viewUrl ? `View: ${params.viewUrl}` : '',
        params.acceptUrl ? `Confirm: ${params.acceptUrl}` : '',
        params.rejectUrl ? `Decline: ${params.rejectUrl}` : '',
      ]
        .filter((line) => line !== '')
        .join('\n'),
      logLabel: `lister availability request (request ${params.requestId})`,
    });
  }

  async sendListerPurchaseRequest(
    params: ListerPurchaseWhatsAppParams,
  ): Promise<boolean> {
    return this.deliver({
      toPhone: params.toPhone,
      contentSidEnvKey: 'TWILIO_CONTENT_SID_PURCHASE_REQUEST',
      variables: {
        '1': params.listerName,
        '2': params.renterName,
        '3': params.productName,
        '4': params.deliveryWindowLabel,
        '5': params.payoutLabel,
      },
      fallbackBody: [
        `Hi ${params.listerName}, ${params.renterName} wants to buy your ${params.productName} on Relisted!`,
        '',
        `Delivery: ${params.deliveryWindowLabel}`,
        '',
        `Your payout: NGN ${params.payoutLabel}`,
        '',
        'Reply YES to confirm or NO to decline.',
        params.viewUrl ? `View: ${params.viewUrl}` : '',
      ]
        .filter((line) => line !== '')
        .join('\n'),
      logLabel: `lister purchase request (request ${params.requestId})`,
    });
  }

  async sendRenterReturnReminder(
    params: RenterReturnReminderWhatsAppParams,
  ): Promise<boolean> {
    return this.deliver({
      toPhone: params.toPhone,
      contentSidEnvKey: 'TWILIO_CONTENT_SID_RETURN_REMINDER',
      variables: {
        '1': params.renterName,
        '2': params.productName,
        '3': params.pickupLabel,
      },
      fallbackBody: [
        `Hi ${params.renterName}, thanks for shopping with Relisted!`,
        '',
        `Pickup for your ${params.productName} rental is ${params.pickupLabel}.`,
        '',
        'Pack the item, snap clear photos, and have it ready.',
      ].join('\n'),
      logLabel: `renter return reminder (${params.productName})`,
    });
  }

  private async deliver(opts: {
    toPhone: string;
    contentSidEnvKey: string;
    variables: Record<string, string>;
    fallbackBody: string;
    logLabel: string;
  }): Promise<boolean> {
    if (!this.isEnabled()) {
      this.logger.debug('Twilio WhatsApp disabled (TWILIO_WHATSAPP_ENABLED=0)');
      return false;
    }
    if (!this.isConfigured()) {
      this.logger.warn(
        'Twilio WhatsApp not configured; recipient will receive email only',
      );
      return false;
    }

    const to = toWhatsAppAddress(opts.toPhone);
    if (!to) {
      this.logger.warn(`Invalid WhatsApp recipient phone: ${opts.toPhone}`);
      return false;
    }

    const from = process.env.TWILIO_WHATSAPP_FROM!.trim();
    const contentSid =
      process.env[opts.contentSidEnvKey]?.trim() || '';

    try {
      const client = this.getClient()!;
      const message = contentSid
        ? await client.messages.create({
            contentSid,
            contentVariables: JSON.stringify(opts.variables),
            from,
            to,
          })
        : await client.messages.create({ body: opts.fallbackBody, from, to });
      this.logger.log(
        `Twilio WhatsApp ${opts.logLabel} sent: ${message.sid}`,
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Twilio WhatsApp send failed: ${message}`);
      return false;
    }
  }
}