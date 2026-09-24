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
import { AdminAvailabilityRequestsController } from './admin.availability-requests.controller';
import { PrismaModule } from '../../services/prisma/prisma.module';
import { ProductAvailabilityNotifyModule } from '../../services/product-availability-notify/product-availability-notify.module';
import { ReviewModule } from '../review/review.module';
import { AdminReviewsController } from './admin.reviews.controller';

@Module({
  imports: [PrismaModule, ProductAvailabilityNotifyModule, ReviewModule],
  controllers: [
    AdminAnalyticsController,
    AdminUsersController,
    AdminOrdersController,
    AdminSettingsController,
    AdminDisputesController,
    AdminWalletsController,
    AdminProductsController,
    AdminClosetsController,
    AdminAvailabilityRequestsController,
    AdminReviewsController,
  ],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
