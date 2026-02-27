import { Controller, Get, Put, Body, UseGuards, Request } from '@nestjs/common';
import { RentersService } from './renters.service';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Renters Notifications')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.RENTER)
@Controller('api/renters/notifications')
export class RentersNotificationsController {
  constructor(private readonly rentersService: RentersService) {}

  @Get('preferences')
  @ApiOperation({ summary: 'Get notification preferences' })
  async getPreferences(@Request() req) {
    return this.rentersService.getNotificationPreferences(req.user.id);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Update notification preferences' })
  async updatePreferences(@Request() req, @Body() data: any) {
    return this.rentersService.updateNotificationPreferences(req.user.id, data);
  }
}
