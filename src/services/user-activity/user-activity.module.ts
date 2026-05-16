import { Global, Module } from '@nestjs/common';
import { UserActivityService } from './user-activity.service';

@Global()
@Module({
  providers: [UserActivityService],
  exports: [UserActivityService],
})
export class UserActivityModule {}
