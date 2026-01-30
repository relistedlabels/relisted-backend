// utils/all-exceptions.filter.ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorResponse: any;

    
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const responseFromException = exception.getResponse();
      
      if (typeof responseFromException === 'string') {
        errorResponse = {
          success: false,
          statusCode: status,
          message: responseFromException,
          error: exception.name,
        };
      } else {
        
        errorResponse = {
          success: false,
          statusCode: status,
          ...(responseFromException as any),
        };
      }
      
     
      const logLevel = status >= 500 ? 'error' : 'warn';
      this.logger[logLevel](
        `${status} ${request.method} ${request.url} - ${message}`,
      );
      
    } 
    
    else if (exception instanceof Error) {
      errorResponse = {
        success: false,
        statusCode: status,
        message: exception.message,
        error: exception.name,
        ...(process.env.NODE_ENV === 'development' && {
          stack: exception.stack,
        }),
      };
      
    }}}