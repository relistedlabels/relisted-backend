import { Module } from '@nestjs/common';
import { PrismaModule } from '../../services/prisma/prisma.module';
import { SiteFeaturesService } from './site-features.service';
import { SiteFeaturesPublicController } from './site-features.public.controller';
import { SiteFeaturesAdminController } from './site-features.admin.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SiteFeaturesPublicController, SiteFeaturesAdminController],
  providers: [SiteFeaturesService],
  exports: [SiteFeaturesService],
})
export class SiteFeaturesModule {}
