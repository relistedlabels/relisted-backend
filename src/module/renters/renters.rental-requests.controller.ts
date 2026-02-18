import { Controller, Get, Post, Body, UseGuards, Request, Param } from '@nestjs/common';
import { RentersService } from './renters.service';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Renters Rental Requests')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.RENTER)
@Controller('api/renters/rental-requests')
export class RentersRentalRequestsController {
  constructor(private readonly rentersService: RentersService) {}

  @Post()
  @ApiOperation({ summary: 'Create rental request' })
  async createRentalRequest(@Request() req, @Body() data: any) {
      // return this.rentersService.createRentalRequest(req.user.id, data);
      return { success: true, message: "Request created" };
  }
}
