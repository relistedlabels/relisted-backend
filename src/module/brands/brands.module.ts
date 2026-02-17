import { Module } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { BrandsController } from './brands.controller';
import { BrandsPublicController } from './brands.public.controller';
import { PrismaService } from 'src/services/prisma/prisma.service';

@Module({
  controllers: [BrandsController, BrandsPublicController],
  providers: [BrandsService, PrismaService],
})
export class BrandsModule {}
