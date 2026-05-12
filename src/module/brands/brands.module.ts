import { Module } from '@nestjs/common';
import { BrandsService } from './brands.service';
import { BrandsController } from './brands.controller';
import { BrandsPublicController } from './brands.public.controller';

@Module({
  controllers: [BrandsController, BrandsPublicController],
  providers: [BrandsService],
})
export class BrandsModule {}
