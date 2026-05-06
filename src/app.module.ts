import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './module/auth/auth.module';
import { CartItemsModule } from './module/cart-items/cart-items.module';
import { DisputeModule } from './module/dispute/dispute.module';
import { OrderModule } from './module/order/order.module';
import { ProductModule } from './module/product/product.module';
import { ProfileModule } from './module/profile/profile.module';
import { RentalModule } from './module/rental/rental.module';
import { ReviewModule } from './module/review/review.module';
import { UploadModule } from './module/upload/upload.module';
import { UserModule } from './module/user/user.module';
import { WaitlistModule } from './module/waitlist/waitlist.module';
import { AuthOtpTokenModule } from './services/auth-otp-token/auth-otp-token.module';
import { EventModule } from './services/event/event.module';
import { MailModule } from './services/mail/mail.module';
import { PrismaModule } from './services/prisma/prisma.module';
import { NotificationModule } from './services/notification/notification.module';
import { ChatRoomModule } from './module/chat-room/chat-room.module';
import { WemaServiceModule } from './services/wema-service/wema-service.module';
import { BrandsModule } from './module/brands/brands.module';
import { CategoriesModule } from './module/categories/categories.module';
import { WebhookModule } from './services/webhook/webhook.module';
import { TagsModule } from './module/tags/tags.module';
import { ListersModule } from './module/listers/listers.module';
import { ContactModule } from './module/contact/contact.module';
import { SearchModule } from './module/search/search.module';
import { RentersModule } from './module/renters/renters.module';
import { AdminModule } from './module/admin/admin.module';
import { TopshipModule } from './services/topship/topship.module';
import { NewsletterModule } from './module/newsletter/newsletter.module';
import { DeliveryModule } from './services/delivery/delivery.module';
import { ShipmentModule } from './module/shipment/shipment.module';
import { ClosetModule } from './module/closet/closet.module';

/** Bull / ioredis: Render and other hosts often require password or `rediss://` — host+port alone causes NOAUTH. */
function bullRedisConnection(): string | { host: string; port: number; password?: string; tls?: object } {
  const url = process.env.REDIS_URL?.trim();
  if (url) {
    return url;
  }
  const password = process.env.REDIS_PASSWORD?.trim();
  const tls =
    process.env.REDIS_TLS === 'true' || process.env.REDIS_TLS === '1' ? {} : undefined;
  return {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    ...(password ? { password } : {}),
    ...(tls ? { tls } : {}),
  };
}

@Module({
  imports: [
    // Redis / Bull — global queue configuration
    BullModule.forRoot({
      redis: bullRedisConnection(),
    }),
    PrismaModule,
    AuthModule,
    MailModule,
    NotificationModule,
    EventModule,
    AuthOtpTokenModule,
    UserModule,
    ProfileModule,
    UploadModule,
    ProductModule,
    ReviewModule,
    DisputeModule,
    OrderModule,
    CartItemsModule,
    RentalModule,
    WaitlistModule,
    ChatRoomModule,
    WemaServiceModule,
    BrandsModule,
    CategoriesModule,
    WebhookModule,
    TagsModule,
    ListersModule,
    ContactModule,
    SearchModule,
    RentersModule,
    AdminModule,
    TopshipModule,
    NewsletterModule,
    DeliveryModule,
    ShipmentModule,
    ClosetModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
