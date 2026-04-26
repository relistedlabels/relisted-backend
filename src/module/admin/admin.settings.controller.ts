import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Body,
  Query,
  Put,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { AdminService } from './admin.service';

@ApiTags('Admin Settings')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('api/admin/settings')
export class AdminSettingsController {
  constructor(private readonly adminService: AdminService) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get admin profile' })
  async getProfile(@Request() req) {
    return this.adminService.getAdminProfile(req.user.id);
  }

  @Put('profile')
  @ApiOperation({ summary: 'Update admin profile' })
  async updateProfile(@Request() req, @Body() data: any) {
    return this.adminService.updateAdminProfile(req.user.id, data);
  }

  @Put('profile/photo')
  @ApiOperation({ summary: 'Update profile photo' })
  async updateProfilePhoto(@Request() req, @Body() data: any) {
    return this.adminService.updateAdminProfilePhoto(req.user.id, data);
  }

  @Put('profile/password')
  @ApiOperation({ summary: 'Update password' })
  async updatePassword(@Request() req, @Body() data: any) {
    return this.adminService.updateAdminPassword(req.user.id, data);
  }

  @Put('profile/2fa')
  @ApiOperation({ summary: 'Toggle 2FA' })
  async toggle2FA(@Request() req, @Body() data: any) {
    return this.adminService.toggleAdmin2FA(req.user.id, data);
  }

  @Get('profile/devices')
  @ApiOperation({ summary: 'Get connected devices' })
  async getDevices(@Request() req) {
    return this.adminService.getAdminDevices(req.user.id);
  }

  @Post('profile/logout-all-devices')
  @ApiOperation({ summary: 'Logout from all other devices' })
  async logoutAllDevices(@Request() req) {
    return this.adminService.logoutAllOtherDevices(req.user.id);
  }

  @Get('platform-controls')
  @ApiOperation({ summary: 'Get platform controls' })
  async getPlatformControls() {
    return this.adminService.getPlatformControls();
  }

  @Put('platform-controls')
  @ApiOperation({ summary: 'Update platform controls' })
  async updatePlatformControls(@Body() data: any) {
    return this.adminService.updatePlatformControls(data);
  }

  @Get('roles')
  @ApiOperation({ summary: 'Get admin roles' })
  async getRoles() {
    return this.adminService.getAdminRoles();
  }

  @Post('roles')
  @ApiOperation({ summary: 'Create admin role' })
  async createRole(@Body() data: any) {
    return this.adminService.createAdminRole(data);
  }

  @Put('roles/:roleId/permissions')
  @ApiOperation({ summary: 'Update role permissions' })
  async updateRolePermissions(
    @Param('roleId') roleId: string,
    @Body() data: any,
  ) {
    return this.adminService.updateRolePermissions(roleId, data);
  }

  @Get('admins')
  @ApiOperation({ summary: 'Get all admins' })
  async getAdmins() {
    return this.adminService.getAdmins();
  }

  @Post('admins')
  @ApiOperation({ summary: 'Add a new admin' })
  async addAdmin(@Body() data: any) {
    return this.adminService.addAdmin(data);
  }

  @Put('admins/:adminId')
  @ApiOperation({ summary: 'Update an admin' })
  async updateAdminList(
    @Param('adminId') targetAdminId: string,
    @Body() data: any,
  ) {
    return this.adminService.updateAdminSettings(targetAdminId, data);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Get audit logs' })
  async getAuditLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('admin') admin?: string,
    @Query('dateRange') dateRange?: string,
  ) {
    return this.adminService.getAuditLogs(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 10,
      action,
      admin,
      dateRange,
    );
  }

  @Post('audit-logs/export')
  @ApiOperation({ summary: 'Export audit logs' })
  async exportAuditLogs() {
    return this.adminService.exportAuditLogs();
  }
}
