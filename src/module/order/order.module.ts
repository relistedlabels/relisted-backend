import { Global, Module } from '@nestjs/common';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { PrismaService } from 'src/services/prisma/prisma.service';
import { TopshipModule } from 'src/services/topship/topship.module';

@Global()
@Module({
  imports: [TopshipModule],
  controllers: [OrderController],
  providers: [OrderService,PrismaService],
  exports:[OrderModule]
})
export class OrderModule {}
