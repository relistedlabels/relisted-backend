import { Module } from '@nestjs/common';
import { ContactService } from './contact.service';
import { ContactController } from './contact.controller';
import { PrismaModule } from '../../services/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ContactController],
  providers: [ContactService],
})
export class ContactModule {}
