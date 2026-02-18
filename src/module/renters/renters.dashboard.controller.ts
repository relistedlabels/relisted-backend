import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { RentersService } from './renters.service';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Renters Dashboard')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.RENTER)
@Controller('api/renters/dashboard')
export class RentersDashboardController {
  constructor(private readonly rentersService: RentersService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Get renter dashboard summary' })
  async getDashboardSummary(@Request() req, @Query('timeframe') timeframe?: string) {
    return this.rentersService.getDashboardSummary(req.user.id, timeframe);
  }
}
