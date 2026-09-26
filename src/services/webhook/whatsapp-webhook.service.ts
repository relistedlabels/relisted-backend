import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { AvailabilityStatus } from '@prisma/client';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { ListersService } from 'src/module/listers/listers.service';
import { userEntity } from 'src/module/auth/auth.types';
import {
  normalizePhoneDigits,
  WhatsAppService,
} from 'src/services/whatsapp/whatsapp.service';
import { resolveApiPublicUrl } from 'src/config/app-urls';

export type TwilioWhatsAppInbound = {
  From?: string;
  To?: string;
  Body?: string;
  ButtonPayload?: string;
  ButtonText?: string;
  MessageSid?: string;
};

function parseListerReply(payload: TwilioWhatsAppInbound): 'accept' | 'reject' | null {
  const raw =
    payload.ButtonPayload?.trim() ||
    payload.ButtonText?.trim() ||
    payload.Body?.trim() ||
    '';
  const normalized = raw.toLowerCase();

  if (
    ['yes_available', 'yes', 'y', 'c', 'confirm', 'available', 'yes, available'].includes(
      normalized,
    )
  ) {
    return 'accept';
  }
  if (
    [
      'no_not_available',
      'no',
      'n',
      'r',
      'reschedule',
      'not available',
      'no, not available',
    ].includes(normalized)
  ) {
    return 'reject';
  }
  return null;
}

const STOP_WORDS = new Set([
  'stop',
  'unsubscribe',
  'cancel',
  'opt out',
  'optout',
  'quit',
  'end',
]);

@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly listersService: ListersService,
    private readonly whatsappService: WhatsAppService,
  ) {}

  resolveWebhookUrl(req: Request): string {
    const configured = process.env.TWILIO_WEBHOOK_URL?.trim();
    if (configured) {
      return configured;
    }
    const base = resolveApiPublicUrl().replace(/\/$/, '');
    const path = req.originalUrl || '/webhook/whatsapp';
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  assertValidSignature(
    url: string,
    params: Record<string, string>,
    signature: string | undefined,
  ): boolean {
    if (!this.whatsappService.isEnabled()) {
      this.logger.debug('Twilio WhatsApp disabled; ignoring webhook');
      return true;
    }
    return this.whatsappService.validateWebhookSignature(url, params, signature);
  }

  async handleInbound(payload: TwilioWhatsAppInbound): Promise<void> {
    if (!this.whatsappService.isEnabled()) {
      return;
    }

    const fromDigits = normalizePhoneDigits(payload.From ?? '');
    if (!fromDigits) {
      this.logger.warn('WhatsApp webhook missing From phone');
      return;
    }

    const rawMessage =
      payload.ButtonPayload?.trim() ||
      payload.ButtonText?.trim() ||
      payload.Body?.trim() ||
      '';
    if (STOP_WORDS.has(rawMessage.toLowerCase())) {
      const profiles = await this.prisma.profile.findMany({
        where: { phoneNumber: { not: '' } },
        select: { userId: true, phoneNumber: true },
      });
      const profile = profiles.find(
        (row) => normalizePhoneDigits(row.phoneNumber) === fromDigits,
      );
      if (profile) {
        await this.prisma.notificationSettings.upsert({
          where: { userId: profile.userId },
          update: { whatsappOptIn: false },
          create: { userId: profile.userId },
        });
        this.logger.log(
          `WhatsApp opt-out recorded for user ${profile.userId}`,
        );
      } else {
        this.logger.warn(
          `No profile matched WhatsApp opt-out sender ${payload.From}`,
        );
      }
      return;
    }

    const action = parseListerReply(payload);
    if (!action) {
      this.logger.debug(
        `Ignoring WhatsApp message without accept/reject intent: ${payload.Body ?? payload.ButtonPayload ?? ''}`,
      );
      return;
    }

    const profiles = await this.prisma.profile.findMany({
      where: { phoneNumber: { not: '' } },
      select: { userId: true, phoneNumber: true },
    });
    const listerProfile = profiles.find(
      (row) => normalizePhoneDigits(row.phoneNumber) === fromDigits,
    );
    if (!listerProfile) {
      this.logger.warn(
        `No lister profile matched WhatsApp sender ${payload.From}`,
      );
      return;
    }

    const pending = await this.prisma.availabilityRequest.findFirst({
      where: {
        listerId: listerProfile.userId,
        status: AvailabilityStatus.PENDING,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!pending) {
      this.logger.warn(
        `No pending availability request for lister ${listerProfile.userId}`,
      );
      return;
    }

    const lister = await this.prisma.user.findUnique({
      where: { id: listerProfile.userId },
    });
    if (!lister) {
      return;
    }

    const listerUser = { ...lister, sub: lister.id } as userEntity;
    if (action === 'accept') {
      await this.listersService.approveOrder(listerUser, pending.id);
      this.logger.log(
        `WhatsApp accept processed for request ${pending.id} (${payload.MessageSid ?? 'no sid'})`,
      );
      return;
    }

    await this.listersService.rejectOrder(listerUser, pending.id, {
      reason: 'Not available for these dates',
    });
    this.logger.log(
      `WhatsApp reject processed for request ${pending.id} (${payload.MessageSid ?? 'no sid'})`,
    );
  }
}
