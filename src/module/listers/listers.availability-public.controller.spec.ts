import { BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ListersAvailabilityPublicController } from './listers.availability-public.controller';
import { ListersService } from './listers.service';

describe('ListersAvailabilityPublicController', () => {
  let controller: ListersAvailabilityPublicController;
  let listersService: jest.Mocked<
    Pick<ListersService, 'respondToAvailabilityViaToken'>
  >;

  beforeEach(() => {
    listersService = {
      respondToAvailabilityViaToken: jest.fn(),
    };
    controller = new ListersAvailabilityPublicController(
      listersService as unknown as ListersService,
    );
  });

  it('does not approve or reject when an email link is fetched', () => {
    const res = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as Response;

    controller.showConfirmation('signed-token', 'accept', res);

    expect(listersService.respondToAvailabilityViaToken).not.toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.send).toHaveBeenCalledWith(
      expect.stringContaining('method="post"'),
    );
  });

  it('requires an explicit POST to record the lister response', async () => {
    const result = {
      responseMeta: {
        outcome: 'accepted',
        requestId: 'request-1',
        productName: 'Dress',
        requestType: 'rental',
      },
    };
    listersService.respondToAvailabilityViaToken.mockResolvedValue(
      result as Awaited<
        ReturnType<ListersService['respondToAvailabilityViaToken']>
      >,
    );
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      redirect: jest.fn().mockReturnThis(),
    } as unknown as Response;

    await controller.respond(
      'signed-token',
      'accept',
      'json',
      { headers: {} } as Request,
      res,
    );

    expect(listersService.respondToAvailabilityViaToken).toHaveBeenCalledWith(
      'signed-token',
      'accept',
    );
    expect(res.json).toHaveBeenCalledWith(result);
  });

  it('rejects invalid response actions without consuming the token', async () => {
    await expect(
      controller.respond(
        'signed-token',
        'anything-else',
        'json',
        { headers: {} } as Request,
        {} as Response,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(listersService.respondToAvailabilityViaToken).not.toHaveBeenCalled();
  });
});
