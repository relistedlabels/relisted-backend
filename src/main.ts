import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './utils/all-exceptions.filter';

function loggingMiddleware(req: any, res: any, next: () => void) {
  const start = Date.now();
  const { method, originalUrl, headers, body, query } = req;

  console.log(`📥 ${method} ${originalUrl}`, {
    query: query && Object.keys(query).length ? query : undefined,
    headers: {
      authorization: headers.authorization ? 'Bearer [HIDDEN]' : undefined,
      'content-type': headers['content-type'],
      'user-agent': headers['user-agent'],
    },
    body: body && Object.keys(body).length ? body : undefined,
  });

  const originalSend = res.send;
  res.send = function (data: any) {
    const duration = Date.now() - start;
    console.log(
      `📤 ${method} ${originalUrl} ${res.statusCode} (${duration}ms)`,
      {
        response: typeof data === 'string' ? data.substring(0, 500) : data,
      },
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

  // Only mount Swagger in dev OR if credentials are provided
  if (!isProduction || hasSwaggerCreds) {
    // Add basic auth middleware in production only (before Swagger setup)
    if (isProduction && hasSwaggerCreds) {
      const swaggerAuthMiddleware = (req: any, res: any, next: () => void) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
          res.setHeader('WWW-Authenticate', 'Basic realm="Swagger API"');
          return res.status(401).send('Unauthorized');
        }

        const base64Credentials = authHeader.split(' ')[1];
        const credentials = Buffer.from(base64Credentials, 'base64').toString(
          'utf-8',
        );
        const [username, password] = credentials.split(':');

        if (
          username === process.env.SWAGGER_USERNAME &&
          password === process.env.SWAGGER_PASSWORD
        ) {
          next();
        } else {
          res.setHeader('WWW-Authenticate', 'Basic realm="Swagger API"');
          return res.status(401).send('Unauthorized');
        }
      };
      app.use('/api', swaggerAuthMiddleware);
    }

    const document = () => SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api', app, document);
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
