import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Query,
  Param,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { RentersService } from './renters.service';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';

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

  @Get(':orderId/progress')
  @ApiOperation({ summary: 'Get order progress timeline' })
  async getProgress(@Request() req, @Param('orderId') orderId: string) {
    return this.rentersService.getOrderProgress(req.user.id, orderId);
  }

  @Post(':orderId/return')
  @ApiOperation({ summary: 'Initiate item return' })
  async initiateReturn(
    @Request() req,
    @Param('orderId') orderId: string,
    @Body() data: any,
  ) {
    return this.rentersService.initiateReturn(req.user.id, orderId, data);
  }

  @Post(':orderId/tracking')
  @ApiOperation({ summary: 'Update order tracking (confirm receipt etc)' })
  async updateOrderTracking(
    @Request() req,
    @Param('orderId') orderId: string,
    @Body() data: any,
  ) {
    return this.rentersService.updateOrderTracking(req.user.id, orderId, data);
  }

  @Post(':orderId/ready-to-return')
  @UseInterceptors(FilesInterceptor('images'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
        itemCondition: { type: 'string', enum: ['good', 'fair', 'poor'] },
        damageNotes: { type: 'string' },
      },
    },
  })
  @ApiOperation({ summary: 'Mark order as ready to return with condition report and images' })
  async readyToReturn(
    @Request() req,
    @Param('orderId') orderId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: any,
  ) {
    return this.rentersService.readyToReturn(req.user.id, orderId, files, body);
  }

  @Get(':orderId/return')
  @ApiOperation({ summary: 'Get return request details' })
  async getReturn(@Request() req, @Param('orderId') orderId: string) {
    return this.rentersService.getReturnRequest(req.user.id, orderId);
  }
}
