import { Module } from '@nestjs/common';
import { ListersService } from './listers.service';
import { ListersController } from './listers.controller';
import { IssueCategoriesController } from './issue-categories.controller';
import { PrismaModule } from 'src/services/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ProfileModule } from '../profile/profile.module';
import { UploadModule } from '../upload/upload.module';
import { ListersPublicController } from './listers.public.controller';
import { PrismaService } from 'src/services/prisma/prisma.service';

@Module({
  imports: [PrismaModule, AuthModule, ProfileModule, UploadModule],
  controllers: [
    ListersController,
    IssueCategoriesController,
    ListersPublicController,
  ],
  providers: [ListersService, PrismaService],
})
export class ListersModule {}
