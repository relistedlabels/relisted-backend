import { Module } from '@nestjs/common';
import { RentersService } from './renters.service';
import { PrismaModule } from '../../services/prisma/prisma.module';
import { UploadModule } from '../upload/upload.module';
import { RentersDashboardController } from './renters.dashboard.controller';
import { RentersProfileController } from './renters.profile.controller';
import { RentersWalletController } from './renters.wallet.controller';
import { RentersOrdersController } from './renters.orders.controller';
import { RentersDisputesController } from './renters.disputes.controller';
import { RentersRentalRequestsController } from './renters.rental-requests.controller';
import { RentersFavoritesController } from './renters.favorites.controller';
import { RentersSecurityController } from './renters.security.controller';
import { RentersNotificationsController } from './renters.notifications.controller';
import { PrismaService } from '../../services/prisma/prisma.service';

@Module({
  imports: [PrismaModule, UploadModule],
  controllers: [
    RentersDashboardController,
    RentersProfileController,
    RentersWalletController,
    RentersOrdersController,
    RentersDisputesController,
    RentersRentalRequestsController,
    RentersFavoritesController,
    RentersSecurityController,
    RentersNotificationsController,
  ],
  providers: [RentersService, PrismaService],
  exports: [RentersService],
})
export class RentersModule {}
