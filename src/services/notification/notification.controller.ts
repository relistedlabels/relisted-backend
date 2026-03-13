import { Controller, Get, Patch, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiOkResponse } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { Auth, AuthUser } from '../../module/auth/decorator/auth.decorator';
import { userEntity } from '../../module/auth/auth.types';

@ApiTags('Notifications')
@ApiBearerAuth('token')
@Auth()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'Get all notifications for the current user' })
  @ApiOkResponse({ description: 'List of notifications' })
  async getMyNotifications(@AuthUser() user: userEntity) {
    return {
      success: true,
      data: await this.notificationService.getUserNotifications(user.id),
    };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiOkResponse({ description: 'Notification marked as read' })
  async markAsRead(@Param('id') id: string) {
    await this.notificationService.markAsRead(id);
    return {
      success: true,
      message: 'Notification marked as read',
    };
  }
}
