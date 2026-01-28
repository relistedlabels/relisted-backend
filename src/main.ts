import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './utils/all-exceptions.filter';
async function bootstrap() {
  console.log('DB URL:', process.env.DATABASE_URL);
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());

  app.useGlobalPipes(new ValidationPipe());
  
app.enableCors({
  origin: (origin, callback) => {
    // Allow Postman, server-to-server, Swagger (same-origin)
    if (!origin) return callback(null, true);

  
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://www.relistedlabels.com',
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
   
//    .addBearerAuth(
//   {
//     type: 'apiKey',
//     in: 'header',
//     name: 'Authorization',
//   },
//   'token',
// )

.addBearerAuth(
  {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  },
  'bearer',
)


    
    .build();
  const document = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);
  

// const document = SwaggerModule.createDocument(app, config);
// SwaggerModule.setup('api', app, document);

//  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
