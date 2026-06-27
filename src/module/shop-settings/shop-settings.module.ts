import { Module } from '@nestjs/common';
import { PrismaModule } from '../../services/prisma/prisma.module';
import { ShopSettingsService } from './shop-settings.service';
import { ShopSettingsAdminController } from './shop-settings.admin.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ShopSettingsAdminController],
  providers: [ShopSettingsService],
  exports: [ShopSettingsService],
})
export class ShopSettingsModule {}
