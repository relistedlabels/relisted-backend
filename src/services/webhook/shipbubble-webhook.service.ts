import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ShipmentTrackingSyncService } from 'src/module/shipment/shipment-tracking-sync.service';
import { shipbubbleWebhookEventImpliesCancellation } from 'src/module/shipment/shipment-provider-status';
import { verifyShipbubbleWebhookSignature } from './shipbubble-webhook.signature';

export type ShipbubbleWebhookPayload = {
  event?: string;
  order_id?: string;
  status?: string;
  courier?: {
    tracking_code?: string;
    tracking_message?: string;
  };
  tracking_url?: string;
};

@Injectable()
export class ShipbubbleWebhookService {
  private readonly logger = new Logger(ShipbubbleWebhookService.name);

  constructor(
    private readonly trackingSync: ShipmentTrackingSyncService,
  ) {}

  isEnabled(): boolean {
    return process.env.SHIPBUBBLE_WEBHOOK_ENABLED !== '0';
  }

  private webhookSecret(): string {
    return (
      process.env.SHIPBUBBLE_WEBHOOK_SECRET?.trim() ||
      process.env.SHIPBUBBLE_WEBHOOK_SECRET_KEY?.trim() ||
      ''
    );
  }

  assertValidSignature(rawBody: Buffer, signatureHeader: string | undefined): void {
    const secret = this.webhookSecret();
    if (!secret) {
      if (process.env.NODE_ENV === 'production') {
        throw new UnauthorizedException(
          'SHIPBUBBLE_WEBHOOK_SECRET is not configured',
        );
      }
      if (process.env.SHIPBUBBLE_WEBHOOK_SKIP_VERIFY !== '1') {
        throw new UnauthorizedException(
          'SHIPBUBBLE_WEBHOOK_SECRET is not configured (set SHIPBUBBLE_WEBHOOK_SKIP_VERIFY=1 for local testing only)',
        );
      }
      this.logger.warn(
        'Shipbubble webhook signature verification skipped (SHIPBUBBLE_WEBHOOK_SKIP_VERIFY=1)',
      );
      return;
    }

    if (!verifyShipbubbleWebhookSignature(rawBody, signatureHeader, secret)) {
      throw new UnauthorizedException('Invalid Shipbubble webhook signature');
    }
  }

  async handlePayload(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): Promise<{ ok: true; updated: boolean; orderId?: string }> {
    if (!this.isEnabled()) {
      this.logger.debug('Shipbubble webhooks disabled (SHIPBUBBLE_WEBHOOK_ENABLED=0)');
      return { ok: true, updated: false };
    }

    this.assertValidSignature(rawBody, signatureHeader);

    let payload: ShipbubbleWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as ShipbubbleWebhookPayload;
    } catch {
      this.logger.warn('Shipbubble webhook body is not valid JSON');
      return { ok: true, updated: false };
    }

    const orderId = String(payload.order_id ?? '').trim();
    if (!orderId) {
      this.logger.warn('Shipbubble webhook missing order_id');
      return { ok: true, updated: false };
    }

    const shipment =
      await this.trackingSync.findShipbubbleShipmentByProviderOrderId(orderId);
    if (!shipment) {
      this.logger.debug(
        `Shipbubble webhook for unknown or non-Shipbubble order_id=${orderId} (ignored)`,
      );
      return { ok: true, updated: false, orderId };
    }

    const event = String(payload.event ?? '').trim();
    const providerStatus = String(payload.status ?? '').trim();
    const forceCancelled =
      shipbubbleWebhookEventImpliesCancellation(event) ||
      providerStatus.toLowerCase() === 'cancelled';

    const trackingCode =
      payload.courier?.tracking_code != null
        ? String(payload.courier.tracking_code)
        : null;
    const trackingUrl =
      payload.tracking_url != null ? String(payload.tracking_url) : null;

    const result = await this.trackingSync.applyProviderTrackingUpdate({
      shipment,
      providerStatus: forceCancelled ? 'cancelled' : providerStatus || 'pending',
      source: 'webhook',
      tracking: {
        status: providerStatus,
        message: payload.courier?.tracking_message,
      },
      trackingId: trackingCode || shipment.trackingId,
      providerTrackingUrl: trackingUrl || shipment.providerTrackingUrl,
      forceCancelled,
    });

    return { ok: true, updated: result.updated, orderId };
  }
}
