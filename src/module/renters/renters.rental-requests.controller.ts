import { Controller, Get, Post, Body, UseGuards, Request, Param, Query, Delete } from '@nestjs/common';
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
      return this.rentersService.createRentalRequest(req.user.id, data);
  }

  @Get()
  @ApiOperation({ summary: 'List rental requests (cart)' })
  async listRentalRequests(@Request() req, @Query() query: any) {
      return this.rentersService.getRentalRequests(req.user.id, query);
  }

  @Get(':requestId')
  @ApiOperation({ summary: 'Get single rental request' })
  async getRentalRequest(@Request() req, @Param('requestId') requestId: string) {
      return this.rentersService.getRentalRequest(req.user.id, requestId);
  }

  @Delete(':requestId')
  @ApiOperation({ summary: 'Remove rental request from cart' })
  async removeRentalRequest(@Request() req, @Param('requestId') requestId: string) {
      return this.rentersService.deleteRentalRequest(req.user.id, requestId);
  }

  @Post(':requestId/confirm')
  @ApiOperation({ summary: 'Confirm rental request after approval' })
  async confirmRentalRequest(
    @Request() req,
    @Param('requestId') requestId: string,
    @Body() body: any,
  ) {
      return this.rentersService.confirmRentalRequest(req.user.id, requestId, body);
  }
}
