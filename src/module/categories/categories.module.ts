import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { CategoriesPublicController } from './categories.public.controller';

import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [UploadModule],
  controllers: [CategoriesController, CategoriesPublicController],
  providers: [CategoriesService],
})
export class CategoriesModule {}
