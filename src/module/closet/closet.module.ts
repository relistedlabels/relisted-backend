import { Module, forwardRef } from '@nestjs/common';
import { ClosetService } from './closet.service';
import { ClosetController } from './closet.controller';
import { ClosetPublicController } from './closet.public.controller';
import { PrismaModule } from 'src/services/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ProductModule } from '../product/product.module';
import { SiteFeaturesModule } from '../site-features/site-features.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    forwardRef(() => ProductModule),
    SiteFeaturesModule,
  ],
  controllers: [ClosetController, ClosetPublicController],
  providers: [ClosetService],
  exports: [ClosetService],
})
export class ClosetModule {}
