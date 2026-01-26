import { Test, TestingModule } from '@nestjs/testing';
import { WemaServiceService } from './wema-service.service';

describe('WemaServiceService', () => {
  let service: WemaServiceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WemaServiceService],
    }).compile();

    service = module.get<WemaServiceService>(WemaServiceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
