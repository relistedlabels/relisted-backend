import { Module } from '@nestjs/common';
import { NewsletterService } from './newsletter.service';
import { NewsletterController } from './newsletter.controller';
import { NewsletterAdminController } from './newsletter.admin.controller';
import { PrismaModule } from 'src/services/prisma/prisma.module';
import { PrismaService } from 'src/services/prisma/prisma.service';

@Module({
  imports: [PrismaModule],
  controllers: [NewsletterController, NewsletterAdminController],
  providers: [NewsletterService, PrismaService],
  exports: [NewsletterService],
})
export class NewsletterModule {}
