import { Module } from '@nestjs/common';
import { ContactService } from './contact.service';
import { ContactController } from './contact.controller';
import { PrismaModule } from '../../services/prisma/prisma.module';
import { PrismaService } from 'src/services/prisma/prisma.service';

@Module({
  imports: [PrismaModule],
  controllers: [ContactController],
  providers: [ContactService, PrismaService],
})
export class ContactModule {}
