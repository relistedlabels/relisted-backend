import { Test, TestingModule } from '@nestjs/testing';
import { ChatRoomGateway } from './chat-room.gateway';
import { ChatRoomService } from './chat-room.service';

describe('ChatRoomGateway', () => {
  let gateway: ChatRoomGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ChatRoomGateway, ChatRoomService],
    }).compile();

    gateway = module.get<ChatRoomGateway>(ChatRoomGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
