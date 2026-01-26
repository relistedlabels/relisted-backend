import { Test, TestingModule } from '@nestjs/testing';
import { WemaServiceController } from './wema-service.controller';
import { WemaServiceService } from './wema-service.service';

describe('WemaServiceController', () => {
  let controller: WemaServiceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WemaServiceController],
      providers: [WemaServiceService],
    }).compile();

    controller = module.get<WemaServiceController>(WemaServiceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
