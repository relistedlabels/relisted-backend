import { Controller, Get, Patch, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiOkResponse,
} from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { Auth, AuthUser } from '../../module/auth/decorator/auth.decorator';
import { userEntity } from '../../module/auth/auth.types';

@ApiTags('Notifications')
@ApiBearerAuth('token')
@Auth()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count for the current user' })
  @ApiOkResponse({ description: 'Unread count' })
  async getUnreadCount(
    @AuthUser() user: userEntity,
    @Query('days') days?: string,
  ) {
    const resolvedDays = this.notificationService.resolveNotificationDays(days);
    const unreadCount =
      await this.notificationService.getUnreadCountForUser(
        user.id,
        resolvedDays,
      );

    return {
      success: true,
      data: {
        unreadCount,
        days: resolvedDays,
      },
    };
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated notifications for the current user' })
  @ApiOkResponse({ description: 'List of notifications' })
  async getMyNotifications(
    @AuthUser() user: userEntity,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('days') days?: string,
  ) {
    const resolvedDays = this.notificationService.resolveNotificationDays(days);
    const resolvedPage = page ? Math.max(1, parseInt(page, 10) || 1) : 1;
    const resolvedLimit = limit
      ? Math.min(100, Math.max(1, parseInt(limit, 10) || 30))
      : 30;

    const data = await this.notificationService.getUserNotificationsPage(
      user.id,
      {
        page: resolvedPage,
        limit: resolvedLimit,
        days: resolvedDays,
      },
    );

    return {
      success: true,
      data,
    };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ApiOkResponse({ description: 'Notifications marked as read' })
  async markAllAsRead(
    @AuthUser() user: userEntity,
    @Query('days') days?: string,
  ) {
    const resolvedDays = this.notificationService.resolveNotificationDays(days);
    const markedCount = await this.notificationService.markAllAsReadForUser(
      user.id,
      resolvedDays,
    );

    return {
      success: true,
      message: 'Notifications marked as read',
      data: { markedCount },
    };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiOkResponse({ description: 'Notification marked as read' })
  async markAsRead(@AuthUser() user: userEntity, @Param('id') id: string) {
    const notification = await this.notificationService.markAsReadForUser(
      user.id,
      id,
    );

    return {
      success: true,
      message: 'Notification marked as read',
      data: notification,
    };
  }
}
