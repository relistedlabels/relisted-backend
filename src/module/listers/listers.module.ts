import { Module } from '@nestjs/common';
import { ListersService } from './listers.service';
import { ListersController } from './listers.controller';
import { IssueCategoriesController } from './issue-categories.controller';
import { PrismaModule } from 'src/services/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ProfileModule } from '../profile/profile.module';
import { UploadModule } from '../upload/upload.module';
import { ListersPublicController } from './listers.public.controller';
import { ListersWalletController } from './listers.wallet.controller';
import { WemaServiceService } from 'src/services/wema-service/wema-service.service';
import { ProductAvailabilityNotifyModule } from 'src/services/product-availability-notify/product-availability-notify.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ProfileModule,
    UploadModule,
    ProductAvailabilityNotifyModule,
  ],
  controllers: [
    ListersController,
    IssueCategoriesController,
    ListersPublicController,
    ListersWalletController,
  ],
  providers: [ListersService, WemaServiceService],
})
export class ListersModule {}
