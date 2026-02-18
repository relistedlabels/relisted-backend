import { Controller, Get, Post, Body, UseGuards, Request, Query, Param } from '@nestjs/common';
import { RentersService } from './renters.service';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Renters Disputes')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.RENTER)
@Controller('api/renters/disputes')
export class RentersDisputesController {
  constructor(private readonly rentersService: RentersService) {}

  @Get()
  @ApiOperation({ summary: 'Get disputes' })
  async getDisputes(@Request() req, @Query() query: any) {
    // Implementation in service needed
    // return this.rentersService.getDisputes(req.user.id, query);
    return { success: true, data: { disputes: [] } }; // Placeholder
  }

  @Post()
  @ApiOperation({ summary: 'Create dispute' })
  async createDispute(@Request() req, @Body() data: any) {
     // return this.rentersService.createDispute(req.user.id, data);
     return { success: true, message: "Dispute created" }; // Placeholder
  }
}
