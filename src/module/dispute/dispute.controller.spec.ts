import { Test, TestingModule } from '@nestjs/testing';
import { DisputeController } from './dispute.controller';
import { DisputeService } from './dispute.service';

describe('DisputeController', () => {
  let controller: DisputeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DisputeController],
      providers: [DisputeService],
    }).compile();

    controller = module.get<DisputeController>(DisputeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
