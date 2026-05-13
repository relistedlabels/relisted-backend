import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from 'src/services/prisma/prisma.module';
import { VaultClosetSaleInterestController } from './vault-closet-sale-interest.controller';
import { VaultClosetSaleInterestService } from './vault-closet-sale-interest.service';

@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1d' },
    }),
  ],
  controllers: [VaultClosetSaleInterestController],
  providers: [VaultClosetSaleInterestService],
})
export class VaultClosetSaleInterestModule {}
