import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminAnalyticsController } from './admin.analytics.controller';
import { AdminUsersController } from './admin.users.controller';
import { AdminOrdersController } from './admin.orders.controller';
import { AdminSettingsController } from './admin.settings.controller';
import { AdminDisputesController } from './admin.disputes.controller';
import { AdminWalletsController } from './admin.wallets.controller';
import { AdminProductsController } from './admin.products.controller';
import { PrismaModule } from '../../services/prisma/prisma.module';
import { PrismaService } from 'src/services/prisma/prisma.service';

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
  ],
  providers: [AdminService, PrismaService],
  exports: [AdminService],
})
export class AdminModule {}
