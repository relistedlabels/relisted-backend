import './load-env';
import './instrument';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { isLocalFileUploadMode } from './config/upload-mode';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { inspect } from 'util';

import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './utils/all-exceptions.filter';
import { applySwaggerBasicAuth } from './swagger/apply-swagger-basic-auth';
import {
  chowdeckRelayQuotesAvailable,
  parseShippingFulfillmentProviders,
  shipbubbleQuotesAvailable,
  topshipFulfillmentEnabled,
} from './constants/shipping-fulfillment-providers';

function redactDatabaseUrl(url: string | undefined): string {
  if (!url) return '(not set)';
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(invalid DATABASE_URL)';
  }
}

/** Masked Shipbubble key for startup logs (verify sandbox vs prod without leaking the secret). */
function maskShipbubbleApiKey(key: string | undefined): string {
  if (!key?.trim()) return '(not set)';
  const k = key.trim();
  let mode = 'unknown';
  if (k.startsWith('sb_sandbox_')) mode = 'sandbox';
  else if (k.startsWith('sb_prod_')) mode = 'production';
  const head = k.slice(0, Math.min(20, k.length));
  const tail = k.length > 4 ? k.slice(-4) : '';
  return `${head}…${tail} (mode=${mode}, len=${k.length})`;
}

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

/** Compact logs on Render/prod; full bodies locally unless HTTP_LOG_VERBOSE=false. */
const httpLogProductionLike =
  process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
const HTTP_LOG_VERBOSE = httpLogProductionLike
  ? process.env.HTTP_LOG_VERBOSE === 'true'
  : process.env.HTTP_LOG_VERBOSE !== 'false';
const HTTP_LOG_MAX_JSON_CHARS = Number(
  process.env.HTTP_LOG_MAX_JSON_CHARS ?? 4096,
);

/** Compact JSON for logs (avoid multi-KiB indented blobs). */
function formatForLog(data: unknown): string {
  if (data === undefined || data === null) return String(data);
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(
      data,
      (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
    );
  } catch {
    return inspect(data, {
      depth: 4,
      colors: false,
      maxArrayLength: 20,
      breakLength: 120,
    });
  }
}

function truncateLogPayload(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)} …[truncated ${s.length - maxChars} chars]`;
}

function responseByteLength(data: unknown): number {
  if (data === undefined || data === null) return 0;
  if (Buffer.isBuffer(data)) return data.length;
  if (typeof data === 'string') return Buffer.byteLength(data, 'utf8');
  return 0;
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

  const inboundPayload = truncateLogPayload(
    formatForLog({
      query: query && Object.keys(query).length ? query : undefined,
      headers: {
        authorization: headers.authorization ? 'Bearer [HIDDEN]' : undefined,
        'content-type': contentType || undefined,
        'user-agent': headers['user-agent'],
      },
      body: logBody,
    }),
    HTTP_LOG_MAX_JSON_CHARS,
  );
  console.log(`📥 ${method} ${originalUrl} ${inboundPayload}`);

  const originalSend = res.send;
  res.send = function (data: any) {
    const duration = Date.now() - start;
    const bytes = responseByteLength(data);

    if (!HTTP_LOG_VERBOSE) {
      const sizePart = bytes > 0 ? ` ${bytes} bytes` : '';
      console.log(
        `📤 ${method} ${originalUrl} ${res.statusCode} (${duration}ms)${sizePart}`,
      );
      return originalSend.call(this, data);
    }

    let responseForLog: unknown;
    if (data === undefined || data === null) {
      responseForLog = data;
    } else if (Buffer.isBuffer(data)) {
      responseForLog = `[Buffer ${data.length} bytes]`;
    } else if (typeof data === 'string') {
      if (bytes > HTTP_LOG_MAX_JSON_CHARS) {
        responseForLog = `[JSON/string body ${bytes} bytes, omitting payload]`;
      } else {
        try {
          responseForLog = maskSensitiveFields(JSON.parse(data));
        } catch {
          responseForLog = `[non-JSON body, ${data.length} chars]`;
        }
      }
    } else if (typeof data === 'object') {
      responseForLog = maskSensitiveFields(data);
    } else {
      responseForLog = data;
    }

    const out = truncateLogPayload(
      formatForLog({ response: responseForLog }),
      HTTP_LOG_MAX_JSON_CHARS,
    );
    console.log(
      `📤 ${method} ${originalUrl} ${res.statusCode} (${duration}ms) ${out}`,
    );
    return originalSend.call(this, data);
  };

  next();
}

function logShippingFulfillmentConfig() {
  const raw = process.env.SHIPPING_FULFILLMENT_PROVIDERS;
  const active = [...parseShippingFulfillmentProviders()].join(', ');
  console.log(
    `[Shipping] SHIPPING_FULFILLMENT_PROVIDERS=${raw == null || raw === '' ? '(unset → default providers)' : JSON.stringify(raw)} → enabled: [${active}]`,
  );
  console.log(
    `[Shipping] Checkout quotes: city_rates=${topshipFulfillmentEnabled()} chowdeck_relay=${chowdeckRelayQuotesAvailable()} shipbubble=${shipbubbleQuotesAvailable()}`,
  );
  if (shipbubbleQuotesAvailable() || process.env.SHIPBUBBLE_API_KEY?.trim()) {
    const baseUrl =
      process.env.SHIPBUBBLE_API_BASE_URL?.trim() ||
      'https://api.shipbubble.com/v1';
    const key = process.env.SHIPBUBBLE_API_KEY?.trim() ?? '';
    const sandbox = key.startsWith('sb_sandbox_');
    console.log(
      `[Shipping] SHIPBUBBLE_API_KEY=${maskShipbubbleApiKey(key)} SHIPBUBBLE_API_BASE_URL=${baseUrl}${sandbox ? ' (sandbox: all pickup couriers allowed at checkout)' : ''}`,
    );
  }
}

async function bootstrap() {
  const leanLogs =
    process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  /** Render (and most hosts) already emit access logs; skip duplicate request/response console lines unless debugging. */
  const enableHttpAccessLog =
    !leanLogs || process.env.HTTP_ENABLE_ACCESS_LOG === 'true';
  logShippingFulfillmentConfig();
  if (!leanLogs) {
    console.log('Database:', redactDatabaseUrl(process.env.DATABASE_URL));
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: leanLogs
      ? ['error', 'warn', 'log']
      : ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  if (isLocalFileUploadMode()) {
    const localDir = join(process.cwd(), 'uploads', 'local');
    await mkdir(localDir, { recursive: true });
    app.useStaticAssets(localDir, { prefix: '/local-uploads/' });
    console.log(
      `📁 Local file uploads enabled: files under ./uploads/local, served at GET /local-uploads/`,
    );
    console.log(`   Public URLs use API_PUBLIC_URL=${process.env.API_PUBLIC_URL ?? '(default localhost:' + (process.env.PORT ?? '4000') + ')'}`);
  }

  if (enableHttpAccessLog) {
    app.use(loggingMiddleware);
  }

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

  const hasSwaggerCreds =
    process.env.SWAGGER_USERNAME && process.env.SWAGGER_PASSWORD;

  const swaggerPath = 'swagger';

  const isProduction = process.env.NODE_ENV === 'production';

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
