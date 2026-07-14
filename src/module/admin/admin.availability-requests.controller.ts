import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorator/roles.decorator';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { AdminService } from './admin.service';

@ApiTags('Admin Availability Requests')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('api/admin/availability-requests')
export class AdminAvailabilityRequestsController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get purchase/rental request statistics' })
  async getStats() {
    return this.adminService.getAvailabilityRequestStats();
  }

  @Get()
  @ApiOperation({ summary: 'List purchase and rental availability requests' })
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminService.getAllAvailabilityRequests(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      status,
      type,
      search,
      dateFrom,
      dateTo,
    );
  }

  @Get(':requestId')
  @ApiOperation({ summary: 'Get availability request details' })
  async getOne(@Param('requestId') requestId: string) {
    return this.adminService.getAvailabilityRequestDetails(requestId);
  }

  @Post(':requestId/nudge-renter')
  @ApiOperation({
    summary:
      'Email the renter that the lister is available, or ask them to re-request',
  })
  async nudgeRenter(
    @Param('requestId') requestId: string,
    @Body() body: { intent?: 'rerequest' | 'now_available' },
  ) {
    return this.adminService.adminNudgeRenterForAvailabilityRequest(
      requestId,
      body?.intent ?? 'now_available',
    );
  }

  @Post(':requestId/resend-to-lister')
  @ApiOperation({
    summary:
      'Resend the purchase/rental request to the lister on the renter\'s behalf',
  })
  async resendToLister(@Param('requestId') requestId: string) {
    return this.adminService.adminResendAvailabilityRequestToLister(requestId);
  }
}
