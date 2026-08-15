import {
  ExceptionFilter,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  @SentryExceptionCaptured()
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let errorResponse: any;

    // ✅ Handle HttpExceptions (401, 403, 404, etc.)
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        errorResponse = {
          success: false,
          statusCode: status,
          message,
          error: exception.name,
        };
      } else {
        const res = exceptionResponse as any;
        message = res.message || exception.message;

        errorResponse = {
          success: false,
          statusCode: status,
          message,
          error: res.error || exception.name,
        };
      }

      const logLevel = status >= 500 ? 'error' : 'warn';

      this.logger[logLevel](
        `${status} ${request.method} ${request.url} - ${Array.isArray(message) ? message.join(', ') : message}`,
      );
    }

    else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2003'
    ) {
      status = HttpStatus.CONFLICT;
      message =
        'This record cannot be deleted because other data still depends on it. Remove related items first or contact support.';
      errorResponse = {
        success: false,
        statusCode: status,
        message,
        error: 'ForeignKeyConstraint',
      };
      this.logger.warn(
        `${status} ${request.method} ${request.url} - FK constraint (${exception.meta?.field_name ?? 'unknown'})`,
      );
    } else if (exception instanceof Error) {
      message = exception.message;

      errorResponse = {
        success: false,
        statusCode: status,
        message,
        error: exception.name,
        ...(process.env.NODE_ENV === 'development' && {
          stack: exception.stack,
        }),
      };

      this.logger.error(
        `${status} ${request.method} ${request.url} - ${message}`,
        exception.stack,
      );
    }


    else {
      errorResponse = {
        success: false,
        statusCode: status,
        message,
      };

      this.logger.error(
        `${status} ${request.method} ${request.url} - Unknown error`,
      );
    }

    response.status(status).json(errorResponse);
  }
}
