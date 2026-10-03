import {
  Controller,
  Get,
  HttpException,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  buildListerAvailabilityResponsePageUrl,
  type ListerAvailabilityResponseOutcome,
} from '../../config/app-urls';
import { ListersService } from './listers.service';

function wantsJsonResponse(req: Request, format?: string): boolean {
  if (format === 'json') return true;
  const accept = req.headers.accept ?? '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

function httpExceptionMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    if (response && typeof response === 'object' && 'message' in response) {
      const message = (response as { message?: string | string[] }).message;
      return Array.isArray(message) ? message.join(', ') : String(message);
    }
  }
  return 'This response link is no longer valid.';
}

@ApiTags('Public Lister Response')
@Controller('api/public/lister-response')
export class ListersAvailabilityPublicController {
  constructor(private readonly listersService: ListersService) {}

  @Get(':token')
  @ApiOperation({
    summary: 'One-tap lister YES/NO via email or WhatsApp magic link',
  })
  async respond(
    @Param('token') token: string,
    @Query('action') action: 'accept' | 'reject',
    @Query('format') format: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const jsonResponse = wantsJsonResponse(req, format);

    try {
      const result =
        await this.listersService.respondToAvailabilityViaToken(token, action);

      if (jsonResponse) {
        return res.status(200).json(result);
      }

      const redirectUrl = buildListerAvailabilityResponsePageUrl({
        outcome: result.responseMeta.outcome as ListerAvailabilityResponseOutcome,
        requestId: result.responseMeta.requestId,
        productName: result.responseMeta.productName,
        requestType: result.responseMeta.requestType,
      });

      if (!redirectUrl) {
        return res.status(200).json(result);
      }

      return res.redirect(302, redirectUrl);
    } catch (error) {
      if (jsonResponse) {
        throw error;
      }

      const redirectUrl = buildListerAvailabilityResponsePageUrl({
        outcome: 'error',
        message: httpExceptionMessage(error),
      });

      if (!redirectUrl) {
        throw error;
      }

      return res.redirect(302, redirectUrl);
    }
  }
}
