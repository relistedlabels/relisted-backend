import { Module } from '@nestjs/common';
import { TshipService } from './tship.service';

@Module({
  providers: [TshipService],
  exports: [TshipService],
})
export class TshipModule {}
