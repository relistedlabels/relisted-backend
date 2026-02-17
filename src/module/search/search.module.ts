import { Module } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { PrismaModule } from '../../services/prisma/prisma.module';
import { PrismaService } from 'src/services/prisma/prisma.service';

@Module({
  imports: [PrismaModule],
  controllers: [SearchController],
  providers: [SearchService, PrismaService],
})
export class SearchModule {}
