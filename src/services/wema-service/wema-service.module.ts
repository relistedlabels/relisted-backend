import { Module } from '@nestjs/common';
import { WemaServiceService } from './wema-service.service';
import { WemaServiceController } from './wema-service.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [WemaServiceController],
  providers: [WemaServiceService,PrismaService],
})
export class WemaServiceModule {}
