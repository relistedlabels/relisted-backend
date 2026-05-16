import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { TopshipService } from 'src/services/topship/topship.service';
import { ChowdeckRelayService } from 'src/services/chowdeck-relay/chowdeck-relay.service';
import { NotificationService } from 'src/services/notification/notification.service';
import { MailService } from 'src/services/mail/mail.service';
import { OrderService } from './order.service';

describe('OrderService', () => {
  let service: OrderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: PrismaService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: TopshipService, useValue: {} },
        { provide: ChowdeckRelayService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: MailService, useValue: {} },
        {
          provide: getQueueToken('shipment-dispatch'),
          useValue: { add: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('groups same-lister resale items on the same Lagos day into one bucket', () => {
    const lister = { id: 'lister-1' };
    const product = {
      listingType: 'RESALE',
      curatorId: lister.id,
      curator: lister,
    };
    const items = [
      {
        id: 'c1',
        days: 0,
        product,
        dispatchWindows: {
          RESALE: {
            start: new Date('2026-05-15T09:09:00+01:00'),
            end: new Date('2026-05-15T10:09:00+01:00'),
          },
        },
      },
      {
        id: 'c2',
        days: 0,
        product,
        dispatchWindows: {
          RESALE: {
            start: new Date('2026-05-15T09:10:00+01:00'),
            end: new Date('2026-05-15T10:10:00+01:00'),
          },
        },
      },
    ];

    const buckets = (service as any).buildShipmentBucketsForLister(items);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].bucketMode).toBe('RESALE');
    expect(buckets[0].items).toHaveLength(2);
    expect(buckets[0].resaleWindow.start.getTime()).toBe(
      new Date('2026-05-15T09:09:00+01:00').getTime(),
    );
    expect(buckets[0].resaleWindow.end.getTime()).toBe(
      new Date('2026-05-15T10:10:00+01:00').getTime(),
    );
  });
});
