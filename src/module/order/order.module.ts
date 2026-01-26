import { Global, Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { PrismaService } from 'src/services/prisma/prisma.service';
@Global()
@Module({
  controllers: [OrderController],
  providers: [OrderService,PrismaService],
  exports:[OrderModule]
})
export class OrderModule {}
