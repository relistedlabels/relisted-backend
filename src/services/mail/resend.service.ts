import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export interface ResendSendParams {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class ResendService {
  private readonly logger = new Logger(ResendService.name);
  private readonly client: Resend | null;
  private readonly from: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    this.client = apiKey ? new Resend(apiKey) : null;
    this.from =
      process.env.MAIL_DEFAULT?.trim() || 'Relisted <onboarding@resend.dev>';

    if (this.client) {
      this.logger.log('Resend email transport enabled');
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async send(params: ResendSendParams): Promise<void> {
    if (!this.client) {
      throw new Error(
        'Resend is not configured. Set RESEND_API_KEY in the environment.',
      );
    }

    const { data, error } = await this.client.emails.send({
      from: this.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });

    if (error) {
      throw new Error(error.message);
    }

    this.logger.debug(`Resend email queued: id=${data?.id ?? 'unknown'}`);
  }
}
