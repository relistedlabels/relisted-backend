import { Module } from '@nestjs/common';
import { ChatRoomService } from './chat-room.service';
import { ChatRoomGateway } from './chat-room.gateway';

@Module({
  providers: [ChatRoomGateway, ChatRoomService],
})
export class ChatRoomModule {}
