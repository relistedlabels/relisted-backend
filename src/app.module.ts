import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './services/prisma/prisma.module';
import { AuthModule } from './module/auth/auth.module';
import { MailModule } from './services/mail/mail.module';
import { EventModule } from './services/event/event.module';
import { AuthOtpTokenModule } from './services/auth-otp-token/auth-otp-token.module';
import { UserModule } from './module/user/user.module';
import { UploadModule } from './module/upload/upload.module';
import { ProfileModule } from './module/profile/profile.module';

@Module({
  imports: [PrismaModule, AuthModule, MailModule, EventModule, AuthOtpTokenModule, UserModule, ProfileModule, UploadModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
