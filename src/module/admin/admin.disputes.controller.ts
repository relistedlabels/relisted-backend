import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';

@ApiTags('Admin Disputes')
@Controller('api/admin/disputes')
export class AdminDisputesController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get dispute statistics' })
  async getDisputeStats() {
    return this.adminService.getDisputeStats();
  }

  @Get()
  @ApiOperation({ summary: 'List disputes' })
  async getAllDisputes(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.adminService.getAllDisputes(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      status,
    );
  }

  @Get(':disputeId')
  @ApiOperation({ summary: 'Get dispute details' })
  async getDisputeDetails(@Param('disputeId') disputeId: string) {
    return this.adminService.getDisputeDetails(disputeId);
  }

  @Put(':disputeId/status')
  @ApiOperation({ summary: 'Update dispute status' })
  async updateDisputeStatus(
    @Param('disputeId') disputeId: string,
    @Body() data: { status: string; note: string },
  ) {
    return this.adminService.updateDisputeStatus(disputeId, data);
  }

  @Put(':disputeId/resolve')
  @ApiOperation({
    summary:
      'Resolve dispute and optionally withhold collateral to lister before releasing escrow',
  })
  async resolveDispute(
    @Param('disputeId') disputeId: string,
    @Body()
    data: {
      resolutionDetails: string;
      refundAmount?: number;
      collateralWithheldToLister?: number;
    },
  ) {
    return this.adminService.resolveDisputeAndSettle(disputeId, data);
  }
}
