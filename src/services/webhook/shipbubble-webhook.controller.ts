import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ShipbubbleWebhookService } from './shipbubble-webhook.service';

@Controller('webhook')
export class ShipbubbleWebhookController {
  constructor(private readonly shipbubbleWebhook: ShipbubbleWebhookService) {}

  /**
   * Shipbubble label / tracking events.
   * Register in Shipbubble dashboard: POST https://<api-host>/webhook/shipbubble
   * @see https://docs.shipbubble.com/api-reference/webhooks
   */
  @Post('shipbubble')
  @HttpCode(200)
  async receiveShipbubble(
    @Headers('x-ship-signature') signature: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody?.length) {
      throw new UnauthorizedException('Missing raw webhook body');
    }

    return this.shipbubbleWebhook.handlePayload(rawBody, signature);
  }
}
