import { Injectable, Logger } from '@nestjs/common';
import twilio from 'twilio';

export type ListerAvailabilityWhatsAppParams = {
  toPhone: string;
  productName: string;
  datesLabel: string;
  renterName: string;
  acceptUrl: string;
  rejectUrl: string;
  requestId: string;
};

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
    if (!this.isEnabled()) {
      this.logger.debug('Twilio WhatsApp disabled (TWILIO_WHATSAPP_ENABLED=0)');
      return false;
    }
    if (!this.isConfigured()) {
      this.logger.warn(
        'Twilio WhatsApp not configured; lister will receive email only',
      );
      return false;
    }

    const to = toWhatsAppAddress(params.toPhone);
    if (!to) {
      this.logger.warn(`Invalid lister phone for WhatsApp: ${params.toPhone}`);
      return false;
    }

    const from = process.env.TWILIO_WHATSAPP_FROM!.trim();
    const contentSid =
      process.env.TWILIO_CONTENT_SID_LISTER_AVAILABILITY?.trim() || '';

    try {
      const client = this.getClient()!;
      if (contentSid) {
        const contentVariables = JSON.stringify({
          '1': params.productName,
          '2': params.datesLabel,
          '3': params.renterName,
        });
        const message = await client.messages.create({
          contentSid,
          contentVariables,
          from,
          to,
        });
        this.logger.log(
          `Twilio WhatsApp sent to lister (request ${params.requestId}): ${message.sid}`,
        );
      } else {
        const body = [
          `New rental request: ${params.productName}`,
          `Requested: ${params.datesLabel}`,
          `Renter: ${params.renterName}`,
          '',
          'Reply YES to confirm or NO to decline.',
          `Confirm: ${params.acceptUrl}`,
          `Decline: ${params.rejectUrl}`,
        ].join('\n');
        const message = await client.messages.create({ body, from, to });
        this.logger.log(
          `Twilio WhatsApp sent to lister (request ${params.requestId}): ${message.sid}`,
        );
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Twilio WhatsApp send failed: ${message}`);
      return false;
    }
  }
}
