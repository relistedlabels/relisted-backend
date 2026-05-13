import { Module } from '@nestjs/common';
import { DisputeService } from './dispute.service';
import { DisputeController } from './dispute.controller';

@Module({
  controllers: [DisputeController],
  providers: [DisputeService],
})
export class DisputeModule {}
