import { Controller, Get, Post, Body, UseGuards, Request, Query, Param } from '@nestjs/common';
import { RentersService } from './renters.service';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Renters Orders')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.RENTER)
@Controller('api/renters/orders')
export class RentersOrdersController {
  constructor(private readonly rentersService: RentersService) {}

  @Get()
  @ApiOperation({ summary: 'Get rental orders' })
  async getOrders(@Request() req, @Query() query: any) {
    return this.rentersService.getOrders(req.user.id, query);
  }

  @Get(':orderId')
  @ApiOperation({ summary: 'Get rental order details' })
  async getOrder(@Request() req, @Param('orderId') orderId: string) {
    return this.rentersService.getOrder(req.user.id, orderId);
  }

  @Post(':orderId/tracking')
  @ApiOperation({ summary: 'Update order tracking (confirm receipt etc)' })
  async updateOrderTracking(@Request() req, @Param('orderId') orderId: string, @Body() data: any) {
      // Logic for confirming delivery, etc.
      return this.rentersService.updateOrderTracking(req.user.id, orderId, data);
  }
}
