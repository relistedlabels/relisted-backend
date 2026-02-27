import { Test, TestingModule } from '@nestjs/testing';
import { RentersRentalRequestsController } from './renters.rental-requests.controller';
import { RentersService } from './renters.service';

describe('RentersRentalRequestsController', () => {
  let controller: RentersRentalRequestsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RentersRentalRequestsController],
      providers: [RentersService],
    }).compile();

    controller = module.get<RentersRentalRequestsController>(
      RentersRentalRequestsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
