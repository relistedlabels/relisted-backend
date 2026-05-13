import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminAnalyticsController } from './admin.analytics.controller';
import { AdminUsersController } from './admin.users.controller';
import { AdminOrdersController } from './admin.orders.controller';
import { AdminSettingsController } from './admin.settings.controller';
import { AdminDisputesController } from './admin.disputes.controller';
import { AdminWalletsController } from './admin.wallets.controller';
import { AdminProductsController } from './admin.products.controller';
import { AdminClosetsController } from './admin.closets.controller';
import { PrismaModule } from '../../services/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [
    AdminAnalyticsController,
    AdminUsersController,
    AdminOrdersController,
    AdminSettingsController,
    AdminDisputesController,
    AdminWalletsController,
    AdminProductsController,
    AdminClosetsController,
  ],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
