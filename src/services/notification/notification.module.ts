import { Global, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { MailModule } from '../mail/mail.module';
import { NotificationController } from './notification.controller';

@Global()
@Module({
  imports: [MailModule],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
