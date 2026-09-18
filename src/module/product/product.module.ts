import { forwardRef, Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { ProductPublicController } from './product.public.controller';
import { PrismaModule } from 'src/services/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { RentalModule } from '../rental/rental.module';
import { ClosetModule } from '../closet/closet.module';
import { ShopSettingsModule } from '../shop-settings/shop-settings.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    forwardRef(() => RentalModule),
    forwardRef(() => ClosetModule),
    ShopSettingsModule,
  ],
  controllers: [ProductController, ProductPublicController],
  providers: [ProductService],
  exports: [ProductService],
})
export class ProductModule {}
