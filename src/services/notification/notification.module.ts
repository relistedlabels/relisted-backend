import { Global, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { MailModule } from '../mail/mail.module';
import { NotificationController } from './notification.controller';
import { PrismaService } from '../prisma/prisma.service';

@Global()
@Module({
  imports: [MailModule],
  controllers: [NotificationController],
  providers: [NotificationService, PrismaService],
  exports: [NotificationService],
})
export class NotificationModule {}
