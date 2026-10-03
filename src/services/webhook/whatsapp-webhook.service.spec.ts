import { AvailabilityStatus } from '@prisma/client';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

describe('WhatsAppWebhookService', () => {
  const prisma = {
    profile: { findMany: jest.fn() },
    returnRequest: { findMany: jest.fn() },
    availabilityRequest: { findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
    notificationSettings: { upsert: jest.fn() },
  };
  const listersService = {
    approveOrder: jest.fn(),
    rejectOrder: jest.fn(),
  };
  const whatsappService = {
    isEnabled: jest.fn(),
    validateWebhookSignature: jest.fn(),
    sendRenterReturnReminder: jest.fn(),
  };
  let service: WhatsAppWebhookService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CLIENT_URL = 'https://relisted.example';
    whatsappService.isEnabled.mockReturnValue(true);
    service = new WhatsAppWebhookService(
      prisma as never,
      listersService as never,
      whatsappService as never,
    );
  });

  afterEach(() => {
    process.env.CLIENT_URL = 'https://relisted.example';
  });

  it('sends the renter an exact pending-return link when the CTA is clicked', async () => {
    prisma.profile.findMany.mockResolvedValue([
      { userId: 'renter-1', phoneNumber: '+2348012345678' },
    ]);
    prisma.returnRequest.findMany.mockResolvedValue([
      {
        order: { orderId: 'ORDER-1' },
        shipmentId: 'shipment-1',
      },
    ]);
    whatsappService.sendRenterReturnReminder.mockResolvedValue(true);

    await service.handleInbound({
      From: 'whatsapp:+2348012345678',
      ButtonText: 'Start return',
    });

    expect(prisma.returnRequest.findMany).toHaveBeenCalledWith({
      where: { order: { userId: 'renter-1' }, status: 'PENDING_PICKUP' },
      orderBy: { createdAt: 'desc' },
      select: { order: { select: { orderId: true } }, shipmentId: true },
    });
    const outbound = whatsappService.sendRenterReturnReminder.mock.calls[0][0];
    const url = new URL(outbound.startReturnUrl);
    expect(url.origin).toBe('https://relisted.example');
    expect(url.pathname).toBe('/renters/orders');
    expect(url.searchParams.get('orderId')).toBe('ORDER-1');
    expect(url.searchParams.get('startReturn')).toBe('1');
    expect(url.searchParams.get('shipmentId')).toBe('shipment-1');
  });

  it('does not send an action link when a phone number matches multiple profiles', async () => {
    prisma.profile.findMany.mockReset();
    prisma.profile.findMany.mockResolvedValue([
      { userId: 'renter-1', phoneNumber: '+2348012345678' },
      { userId: 'renter-2', phoneNumber: '08012345678' },
    ]);
    prisma.returnRequest.findMany.mockResolvedValue([]);

    await service.handleInbound({
      From: 'whatsapp:+2348012345678',
      ButtonPayload: 'Start return',
    });

    expect(prisma.profile.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.returnRequest.findMany).toHaveBeenCalledWith({
      where: { order: { userId: 'renter-1' }, status: 'PENDING_PICKUP' },
      orderBy: { createdAt: 'desc' },
      select: { order: { select: { orderId: true } }, shipmentId: true },
    });
    expect(whatsappService.sendRenterReturnReminder).not.toHaveBeenCalled();
  });

  it('does not expose a return link when no pending return exists', async () => {
    prisma.profile.findMany.mockResolvedValue([
      { userId: 'renter-1', phoneNumber: '+2348012345678' },
    ]);
    prisma.returnRequest.findMany.mockResolvedValue([]);

    await service.handleInbound({
      From: 'whatsapp:+2348012345678',
      Body: 'Start return',
    });

    expect(whatsappService.sendRenterReturnReminder).not.toHaveBeenCalled();
  });

  it('still routes lister replies through availability handling', async () => {
    prisma.profile.findMany.mockResolvedValue([
      { userId: 'lister-1', phoneNumber: '+2348012345678' },
    ]);
    prisma.availabilityRequest.findFirst.mockResolvedValue({ id: 'request-1' });
    prisma.user.findUnique.mockResolvedValue({
      id: 'lister-1',
      role: 'LISTER',
    });

    await service.handleInbound({
      From: 'whatsapp:+2348012345678',
      ButtonPayload: 'yes_available',
    });

    expect(prisma.availabilityRequest.findFirst).toHaveBeenCalledWith({
      where: { listerId: 'lister-1', status: AvailabilityStatus.PENDING },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    expect(listersService.approveOrder).toHaveBeenCalled();
  });
});
