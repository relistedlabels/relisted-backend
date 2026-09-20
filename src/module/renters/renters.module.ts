import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { RentersService } from './renters.service';
import { PrismaModule } from '../../services/prisma/prisma.module';
import { UploadModule } from '../upload/upload.module';
import { ShipbubbleModule } from '../../services/shipbubble/shipbubble.module';
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
import { CartItemsModule } from '../cart-items/cart-items.module';
import { AuthOtpTokenModule } from '../../services/auth-otp-token/auth-otp-token.module';
import { AuthModule } from '../auth/auth.module';
import { RentersAvailabilityPublicController } from './renters.availability-public.controller';
import { WhatsAppModule } from '../../services/whatsapp/whatsapp.module';

@Module({
  imports: [
    PrismaModule,
    UploadModule,
    BullModule.registerQueue({ name: 'shipment-dispatch' }),
    ShipbubbleModule,
    ProductAvailabilityNotifyModule,
    CartItemsModule,
    AuthOtpTokenModule,
    AuthModule,
    WhatsAppModule,
  ],
  controllers: [
    RentersAvailabilityPublicController,
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
