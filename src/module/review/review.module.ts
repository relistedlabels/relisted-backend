import { Module } from '@nestjs/common';
import { ReviewService } from './review.service';
import { ReviewController } from './review.controller';
import { ReviewsPublicController } from './review.public.controller';
import { PrismaModule } from 'src/services/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from 'src/services/prisma/prisma.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ReviewController, ReviewsPublicController],
  providers: [ReviewService, PrismaService],
})
export class ReviewModule {}
