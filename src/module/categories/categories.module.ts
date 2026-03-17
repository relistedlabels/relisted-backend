import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { CategoriesPublicController } from './categories.public.controller';
import { PrismaService } from 'src/services/prisma/prisma.service';

import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [UploadModule],
  controllers: [CategoriesController, CategoriesPublicController],
  providers: [CategoriesService, PrismaService],
})
export class CategoriesModule {}
