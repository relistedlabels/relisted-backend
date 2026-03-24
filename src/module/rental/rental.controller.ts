import { Controller, Get, Param } from '@nestjs/common';
import { RentalService } from './rental.service';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { userEntity } from '../auth/auth.types';

@ApiTags('rental')
@ApiBearerAuth('bearer')
@Controller('rental')
export class RentalController {
  constructor(private readonly rentalService: RentalService) {}

  @Auth()
  @Get()
  @ApiResponse({ status: 200, description: 'Rentals retrieved successfully' })
  findAll(@AuthUser() user: userEntity) {
    return this.rentalService.findAll(user);
  }

  @Auth()
  @Get(':id')
  @ApiResponse({ status: 200, description: 'Rental retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Rental not found' })
  findOne(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.rentalService.findOne(id, user);
  }
}
