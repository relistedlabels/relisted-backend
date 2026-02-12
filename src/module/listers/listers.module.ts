import { Module } from '@nestjs/common';
import { ListersController } from './listers.controller';
import { ListersService } from './listers.service';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { IssueCategoriesController } from './issue-categories.controller';

@Module({
  controllers: [ListersController, IssueCategoriesController],
  providers: [ListersService, PrismaService],
  exports: [ListersService],
})
export class ListersModule {}
