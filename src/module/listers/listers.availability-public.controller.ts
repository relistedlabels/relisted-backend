import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
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

  private renderConfirmationPage(token: string, action: 'accept' | 'reject') {
    const safeToken = encodeURIComponent(token);
    const label = action === 'accept' ? 'Approve request' : 'Reject request';
    const heading =
      action === 'accept' ? 'Approve this request?' : 'Reject this request?';

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${label}</title>
  </head>
  <body>
    <main>
      <h1>${heading}</h1>
      <p>Review this request before confirming your response.</p>
      <form method="post" action="/api/public/lister-response/${safeToken}">
        <input type="hidden" name="action" value="${action}">
        <button type="submit">${label}</button>
      </form>
    </main>
  </body>
</html>`;
  }

  @Get(':token')
  @ApiOperation({
    summary: 'Show a confirmation page for a lister availability response link',
  })
  showConfirmation(
    @Param('token') token: string,
    @Query('action') action: 'accept' | 'reject',
    @Res() res: Response,
  ) {
    if (action !== 'accept' && action !== 'reject') {
      throw new BadRequestException('Action must be accept or reject');
    }

    res.setHeader('Cache-Control', 'no-store');
    return res
      .status(200)
      .type('html')
      .send(this.renderConfirmationPage(token, action));
  }

  @Post(':token')
  @ApiOperation({
    summary:
      'Confirm a lister availability response from the confirmation page',
  })
  async respond(
    @Param('token') token: string,
    @Body('action') action: string,
    @Query('format') format: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (action !== 'accept' && action !== 'reject') {
      throw new BadRequestException('Action must be accept or reject');
    }

    const jsonResponse = wantsJsonResponse(req, format);

    try {
      const result = await this.listersService.respondToAvailabilityViaToken(
        token,
        action,
      );

      if (jsonResponse) {
        return res.status(200).json(result);
      }

      const redirectUrl = buildListerAvailabilityResponsePageUrl({
        outcome: result.responseMeta
          .outcome as ListerAvailabilityResponseOutcome,
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
