import { Module } from '@nestjs/common';
import { PrismaModule } from '../../services/prisma/prisma.module';
import { SiteFeaturesService } from './site-features.service';
import { SiteFeaturesPublicController } from './site-features.public.controller';
import { SiteFeaturesAdminController } from './site-features.admin.controller';
import { OperationsPauseGuard } from './operations-pause.guard';

@Module({
  imports: [PrismaModule],
  controllers: [SiteFeaturesPublicController, SiteFeaturesAdminController],
  providers: [SiteFeaturesService, OperationsPauseGuard],
  exports: [SiteFeaturesService, OperationsPauseGuard],
})
export class SiteFeaturesModule {}
