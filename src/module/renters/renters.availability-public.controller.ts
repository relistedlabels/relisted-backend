import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RentersService } from './renters.service';
import { GuestAvailabilityRequestDto } from './dto/guest-availability-request.dto';

@ApiTags('Public Availability')
@Controller('api/public/availability-requests')
export class RentersAvailabilityPublicController {
  constructor(private readonly rentersService: RentersService) {}

  @Post()
  @ApiOperation({ summary: 'Guest availability check (name, email, phone only)' })
  createGuestRequest(@Body() dto: GuestAvailabilityRequestDto) {
    return this.rentersService.createGuestAvailabilityRequest(dto);
  }

  @Get(':requestId')
  @ApiOperation({ summary: 'Poll availability status with access token' })
  getStatus(
    @Param('requestId') requestId: string,
    @Query('token') token: string,
  ) {
    return this.rentersService.getPublicAvailabilityStatus(requestId, token);
  }
}
