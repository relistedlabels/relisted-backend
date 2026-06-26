import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../services/prisma/prisma.module';
import { MailModule } from '../../services/mail/mail.module';
import { ShopSaleService } from './shop-sale.service';
import { ShopSaleAdminController } from './shop-sale.admin.controller';
import { ShopSalePublicController } from './shop-sale.public.controller';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [ShopSaleAdminController, ShopSalePublicController],
  providers: [ShopSaleService],
  exports: [ShopSaleService],
})
export class ShopSaleModule {}
