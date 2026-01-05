import { Module } from '@nestjs/common';
import { EventService } from './event.service';
import { EventController } from './event.controller';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports:[EventEmitterModule.forRoot()],
  controllers: [EventController],
  providers: [EventService],
})
export class EventModule {}
