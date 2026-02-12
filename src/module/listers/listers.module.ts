import { Module } from '@nestjs/common';
import { ListersController } from './listers.controller';
import { ListersService } from './listers.service';
import { PrismaModule } from 'src/services/prisma/prisma.module';
import { IssueCategoriesController } from './issue-categories.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ListersController, IssueCategoriesController],
  providers: [ListersService],
  exports: [ListersService],
})
export class ListersModule {}
