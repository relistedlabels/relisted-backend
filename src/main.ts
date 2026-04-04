import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { inspect } from 'util';

import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './utils/all-exceptions.filter';
import { applySwaggerBasicAuth } from './swagger/apply-swagger-basic-auth';

function maskSensitiveFields(obj: any): any {
  if (obj == null || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => maskSensitiveFields(item));
  }

  const sensitiveFields = [
    'password',
    'token',
    'accessToken',
    'refreshToken',
    'authorization',
    'secret',
    'apiKey',
    'bearerToken',
  ];
  const masked = { ...obj };

  for (const key of Object.keys(masked)) {
    if (sensitiveFields.some((field) => key.toLowerCase().includes(field))) {
      masked[key] = '[HIDDEN]';
    } else if (typeof masked[key] === 'object' && masked[key] !== null) {
      masked[key] = maskSensitiveFields(masked[key]);
    }
  }
  return masked;
}

/** Single-line-safe logging for hosts that truncate multi-arg console.inspect depth (e.g. [Object]). */
function formatForLog(data: unknown): string {
  if (data === undefined || data === null) return String(data);
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(
      data,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    );
  } catch {
    return inspect(data, {
      depth: null,
      colors: false,
      maxArrayLength: 200,
      breakLength: 120,
    });
  }
}

function loggingMiddleware(req: any, res: any, next: () => void) {
  const start = Date.now();
  const { method, originalUrl, headers, body, query } = req;

  const contentType = headers['content-type'] || '';
  const isMultipart = contentType.includes('multipart/form-data');

  let logBody = undefined;
  if (body && Object.keys(body).length) {
    logBody = maskSensitiveFields({ ...body });
  } else if (isMultipart) {
    const formData: any = {};
    if (req.body) {
      Object.assign(formData, maskSensitiveFields({ ...req.body }));
    }
    if (req.file) {
      formData.file = {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        fieldname: req.file.fieldname,
      };
    }
    if (req.files) {
      formData.files = Array.isArray(req.files)
        ? req.files.map((f: any) => ({
            originalname: f.originalname,
            mimetype: f.mimetype,
            size: f.size,
          }))
        : '[files]';
    }
    logBody = formData;
  }

  console.log(
    `📥 ${method} ${originalUrl} ${formatForLog({
      query: query && Object.keys(query).length ? query : undefined,
      headers: {
        authorization: headers.authorization ? 'Bearer [HIDDEN]' : undefined,
        'content-type': contentType || undefined,
        'user-agent': headers['user-agent'],
      },
      body: logBody,
    })}`,
  );

  const originalSend = res.send;
  res.send = function (data: any) {
    const duration = Date.now() - start;
    let responseForLog: unknown;
    if (data === undefined || data === null) {
      responseForLog = data;
    } else if (Buffer.isBuffer(data)) {
      responseForLog = `[Buffer ${data.length} bytes]`;
    } else if (typeof data === 'string') {
      try {
        responseForLog = maskSensitiveFields(JSON.parse(data));
      } catch {
        responseForLog = `[non-JSON body, ${data.length} chars]`;
      }
    } else if (typeof data === 'object') {
      responseForLog = maskSensitiveFields(data);
    } else {
      responseForLog = data;
    }
    console.log(
      `📤 ${method} ${originalUrl} ${res.statusCode} (${duration}ms) ${formatForLog({
        response: responseForLog,
      })}`,
    );
    return originalSend.call(this, data);
  };

  next();
}

async function bootstrap() {
  console.log('DB URL:', process.env.DATABASE_URL);
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  app.use(loggingMiddleware);

  app.enableCors({
    origin: (origin, callback) => {
      // Allow Postman, server-to-server, Swagger (same-origin)
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'http://localhost:4000',
        'https://www.relistedlabels.com',
        'https://relisted-backend.onrender.com',
        'https://dev.relistedlabels.com',
      ];

      if (
        allowedOrigins.includes(origin) ||
        origin.startsWith('http://localhost') ||
        origin.endsWith('.vercel.app')
      ) {
        return callback(null, true);
      }

      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle('Relisted Ecommerce Api')
    .setDescription('Api documentation for ecommerce application')
    .setVersion('1.0')

    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      'bearer',
    )

    .build();

  const isProduction = process.env.NODE_ENV === 'production';
  const hasSwaggerCreds =
    process.env.SWAGGER_USERNAME && process.env.SWAGGER_PASSWORD;

  const swaggerPath = 'swagger';

  // Only mount Swagger in dev OR if credentials are provided
  if (!isProduction || hasSwaggerCreds) {
    // Basic auth on /swagger whenever creds are set (dev or prod) so local testing matches prod
    if (hasSwaggerCreds) {
      applySwaggerBasicAuth(
        app,
        swaggerPath,
        process.env.SWAGGER_USERNAME!,
        process.env.SWAGGER_PASSWORD!,
      );
    }

    const document = () => SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(swaggerPath, app, document);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
