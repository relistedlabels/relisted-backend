import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

@Controller('webhook')
export class WhatsAppWebhookController {
  constructor(private readonly whatsappWebhook: WhatsAppWebhookService) {}

  /**
   * Twilio WhatsApp inbound messages (lister YES/NO replies).
   * Register in Twilio console: POST https://<api-host>/webhook/whatsapp
   */
  @Post('whatsapp')
  @HttpCode(200)
  async receiveWhatsApp(
    @Body() body: Record<string, string>,
    @Headers('x-twilio-signature') signature: string | undefined,
    @Req() req: Request,
  ) {
    const webhookUrl = this.whatsappWebhook.resolveWebhookUrl(req);
    if (
      !this.whatsappWebhook.assertValidSignature(webhookUrl, body, signature)
    ) {
      throw new UnauthorizedException('Invalid Twilio webhook signature');
    }

    await this.whatsappWebhook.handleInbound(body);
    return '';
  }
}
