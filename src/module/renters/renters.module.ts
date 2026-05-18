import { Module } from '@nestjs/common';
import { RentersService } from './renters.service';
import { PrismaModule } from '../../services/prisma/prisma.module';
import { UploadModule } from '../upload/upload.module';
import { ShipbubbleModule } from '../../services/shipbubble/shipbubble.module';
import { TopshipModule } from '../../services/topship/topship.module';
import { RentersDashboardController } from './renters.dashboard.controller';
import { RentersProfileController } from './renters.profile.controller';
import { RentersWalletController } from './renters.wallet.controller';
import { RentersOrdersController } from './renters.orders.controller';
import { RentersDisputesController } from './renters.disputes.controller';
import { RentersRentalRequestsController } from './renters.rental-requests.controller';
import { RentersFavoritesController } from './renters.favorites.controller';
import { RentersSecurityController } from './renters.security.controller';
import { RentersNotificationsController } from './renters.notifications.controller';
import { RentersProductNotifyController } from './renters.product-notify.controller';
import { WemaServiceService } from '../../services/wema-service/wema-service.service';
import { ProductAvailabilityNotifyModule } from '../../services/product-availability-notify/product-availability-notify.module';

@Module({
  imports: [
    PrismaModule,
    UploadModule,
    TopshipModule,
    ShipbubbleModule,
    ProductAvailabilityNotifyModule,
  ],
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
    RentersProductNotifyController,
  ],
  providers: [RentersService, WemaServiceService],
  exports: [RentersService],
})
export class RentersModule {}
