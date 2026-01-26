import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

import cookieParser from 'cookie-parser';
async function bootstrap() {
  console.log('DB URL:', process.env.DATABASE_URL);
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe());
      app.enableCors({
    origin: [
    'http://localhost:3000',"http://localhost:3001",
    'https://www.relistedlabels.com',
  ],
    credentials: true,
  })
  
  

  app.useGlobalPipes(new ValidationPipe())
    app.enableCors({
    origin: [
    'http://localhost:3000',
    'https://www.relistedlabels.com',
  ],
    credentials: true,
  })
  const config = new DocumentBuilder()
    .setTitle('Relisted Ecommerce Api')
    .setDescription('Api documentation for ecommerce application')
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .build();
  const document = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);
  
  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
