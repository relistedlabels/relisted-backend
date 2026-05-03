import { Module } from '@nestjs/common';
import { TopshipModule } from '../topship/topship.module';
import { TopshipProvider } from './providers/topship.provider';
import { DeliveryProviderService } from './delivery-provider.service';

@Module({
  imports: [TopshipModule],
  providers: [TopshipProvider, DeliveryProviderService],
  exports: [DeliveryProviderService],
})
export class DeliveryModule {}
