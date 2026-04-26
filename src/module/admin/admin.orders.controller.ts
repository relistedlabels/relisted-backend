import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Body,
  Query,
  UseGuards,
  Put,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { AdminService } from './admin.service';

@ApiTags('Admin Orders')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.ADMIN)
@Controller('api/admin/orders')
export class AdminOrdersController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get orders statistics' })
  async getOrderStats() {
    return this.adminService.getOrderStats();
  }

  @Get()
  @ApiOperation({ summary: 'Get all orders' })
  async getAllOrders(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.adminService.getAllOrders(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 10,
      status,
    );
  }

  @Get('returns')
  @ApiOperation({ summary: 'Get all return requests' })
  async getReturnRequests(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getReturnRequests(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('export')
  @ApiOperation({ summary: 'Export orders to CSV' })
  async exportOrders() {
    return this.adminService.exportOrders();
  }

  @Get(':orderId')
  @ApiOperation({ summary: 'Get order details' })
  async getOrderDetails(@Param('orderId') orderId: string) {
    return this.adminService.getOrderDetails(orderId);
  }

  @Put(':orderId/status')
  @ApiOperation({ summary: 'Update order status' })
  async updateOrderStatus(
    @Param('orderId') orderId: string,
    @Body() data: { status: string; note: string },
  ) {
    return this.adminService.updateOrderStatus(orderId, data);
  }

  @Post(':orderId/cancel')
  @ApiOperation({ summary: 'Cancel an order' })
  async cancelOrder(
    @Param('orderId') orderId: string,
    @Body() data: { reason: string },
  ) {
    return this.adminService.cancelOrder(orderId, data);
  }

  @Get(':orderId/activity')
  @ApiOperation({ summary: 'Get order activity timeline' })
  async getOrderActivity(@Param('orderId') orderId: string) {
    return this.adminService.getOrderActivity(orderId);
  }
}
