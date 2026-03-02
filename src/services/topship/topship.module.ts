import { Module } from '@nestjs/common';
import { TopshipService } from './topship.service';

@Module({
  providers: [TopshipService],
  exports: [TopshipService],
})
export class TopshipModule {}
