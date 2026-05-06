import { forwardRef, Module } from '@nestjs/common';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { ProductPublicController } from './product.public.controller';
import { PrismaModule } from 'src/services/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { RentalModule } from '../rental/rental.module';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { ClosetModule } from '../closet/closet.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    forwardRef(() => RentalModule),
    forwardRef(() => ClosetModule),
  ],
  controllers: [ProductController, ProductPublicController],
  providers: [ProductService, PrismaService],
  exports: [ProductService],
})
export class ProductModule {}
