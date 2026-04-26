import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { AdminService } from './admin.service';

@ApiTags('Admin Analytics')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('api/admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get overall analytics stats' })
  async getStats(
    @Query('timeframe') timeframe: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.adminService.getAnalyticsStats(timeframe, year, month);
  }

  @Get('rentals-revenue-trend')
  @ApiOperation({ summary: 'Get rentals and revenue trend over time' })
  async getRentalsRevenueTrend(
    @Query('timeframe') timeframe: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.adminService.getRentalsRevenueTrend(timeframe, year, month);
  }

  @Get('category-breakdown')
  @ApiOperation({ summary: 'Get product category breakdown' })
  async getCategoryBreakdown(
    @Query('timeframe') timeframe: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.adminService.getCategoryBreakdown(timeframe, year, month);
  }

  @Get('revenue-by-category')
  @ApiOperation({ summary: 'Get revenue distributed by category' })
  async getRevenueByCategory(
    @Query('timeframe') timeframe: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.adminService.getRevenueByCategory(timeframe, year, month);
  }

  @Get('top-curators')
  @ApiOperation({ summary: 'Get top curators' })
  async getTopCurators(@Query('limit') limit?: string) {
    return this.adminService.getTopCurators(limit ? parseInt(limit, 10) : 5);
  }

  @Get('top-items')
  @ApiOperation({ summary: 'Get top rented items' })
  async getTopItems(@Query('limit') limit?: string) {
    return this.adminService.getTopItems(limit ? parseInt(limit, 10) : 5);
  }
}
