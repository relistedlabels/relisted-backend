import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './module/auth/auth.module';
import { CartItemsModule } from './module/cart-items/cart-items.module';
import { ChatModule } from './module/chat/chat.module';
import { DisputeModule } from './module/dispute/dispute.module';
import { OrderModule } from './module/order/order.module';
import { ProductModule } from './module/product/product.module';
import { ProfileModule } from './module/profile/profile.module';
import { RentalModule } from './module/rental/rental.module';
import { ReviewModule } from './module/review/review.module';
import { UploadModule } from './module/upload/upload.module';
import { UserModule } from './module/user/user.module';
import { AuthOtpTokenModule } from './services/auth-otp-token/auth-otp-token.module';
import { EventModule } from './services/event/event.module';
import { MailModule } from './services/mail/mail.module';
import { PrismaModule } from './services/prisma/prisma.module';

@Module({
  imports: [PrismaModule, AuthModule, MailModule, EventModule, AuthOtpTokenModule, UserModule, ProfileModule, UploadModule, ProductModule, ReviewModule, DisputeModule, OrderModule, ChatModule, CartItemsModule, RentalModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
