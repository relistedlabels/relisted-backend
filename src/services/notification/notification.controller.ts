import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiOkResponse,
} from '@nestjs/swagger';
import {
  NotificationService,
  NOTIFICATION_DEFAULT_DAYS,
  NOTIFICATION_LIST_DEFAULT_LIMIT,
  NOTIFICATION_LIST_MAX_LIMIT,
} from './notification.service';
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
    @Query('days', new DefaultValuePipe(NOTIFICATION_DEFAULT_DAYS), ParseIntPipe)
    days: number,
  ) {
    const count = await this.notificationService.getUnreadCount(user.id, days);
    return {
      success: true,
      data: { unreadCount: count, days },
    };
  }

  @Get()
  @ApiOperation({ summary: 'Get notifications for the current user' })
  @ApiOkResponse({ description: 'Paginated list of notifications' })
  async getMyNotifications(
    @AuthUser() user: userEntity,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(NOTIFICATION_LIST_DEFAULT_LIMIT), ParseIntPipe)
    limit: number,
    @Query('days', new DefaultValuePipe(NOTIFICATION_DEFAULT_DAYS), ParseIntPipe)
    days: number,
  ) {
    const data = await this.notificationService.getUserNotifications(user.id, {
      page,
      limit: Math.min(limit, NOTIFICATION_LIST_MAX_LIMIT),
      days,
    });
    return {
      success: true,
      data,
    };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all recent notifications as read' })
  @ApiOkResponse({ description: 'Notifications marked as read' })
  async markAllAsRead(
    @AuthUser() user: userEntity,
    @Query('days', new DefaultValuePipe(NOTIFICATION_DEFAULT_DAYS), ParseIntPipe)
    days: number,
  ) {
    const count = await this.notificationService.markAllAsRead(user.id, days);
    return {
      success: true,
      message: `${count} notification(s) marked as read`,
      data: { markedCount: count },
    };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ApiOkResponse({ description: 'Notification marked as read' })
  async markAsRead(@AuthUser() user: userEntity, @Param('id') id: string) {
    const notification = await this.notificationService.markAsRead(id, user.id);
    return {
      success: true,
      message: 'Notification marked as read',
      data: notification,
    };
  }
}
