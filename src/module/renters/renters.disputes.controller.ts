import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Query,
  Param,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RentersService } from './renters.service';
import { UploadService } from '../upload/upload.service';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';

@ApiTags('Renters Disputes')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.RENTER)
@Controller('api/renters/disputes')
export class RentersDisputesController {
  constructor(
    private readonly rentersService: RentersService,
    private readonly uploadService: UploadService,
  ) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get dispute statistics' })
  async getStats(@Request() req) {
    return this.rentersService.getDisputeStats(req.user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List disputes' })
  async getDisputes(@Request() req, @Query() query: any) {
    return this.rentersService.getDisputes(req.user.id, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create dispute' })
  async createDispute(@Request() req, @Body() data: any) {
    return this.rentersService.createDispute(req.user.id, data);
  }

  @Get(':disputeId')
  @ApiOperation({ summary: 'Get dispute details' })
  async getDisputeById(@Request() req, @Param('disputeId') disputeId: string) {
    return this.rentersService.getDisputeById(req.user.id, disputeId);
  }

  @Get(':disputeId/overview')
  @ApiOperation({ summary: 'Get dispute overview' })
  async getOverview(@Request() req, @Param('disputeId') disputeId: string) {
    return this.rentersService.getDisputeOverview(req.user.id, disputeId);
  }

  @Get(':disputeId/evidence')
  @ApiOperation({ summary: 'Get dispute evidence files' })
  async getEvidence(@Request() req, @Param('disputeId') disputeId: string) {
    return this.rentersService.getDisputeEvidence(req.user.id, disputeId);
  }

  @Get(':disputeId/timeline')
  @ApiOperation({ summary: 'Get dispute timeline' })
  async getTimeline(@Request() req, @Param('disputeId') disputeId: string) {
    return this.rentersService.getDisputeTimeline(req.user.id, disputeId);
  }

  @Get(':disputeId/resolution')
  @ApiOperation({ summary: 'Get dispute resolution' })
  async getResolution(@Request() req, @Param('disputeId') disputeId: string) {
    return this.rentersService.getDisputeResolution(req.user.id, disputeId);
  }

  @Get(':disputeId/messages')
  @ApiOperation({ summary: 'Get dispute messages' })
  async getMessages(@Request() req, @Param('disputeId') disputeId: string) {
    return this.rentersService.getDisputeMessages(req.user.id, disputeId);
  }

  @Post(':disputeId/messages')
  @ApiOperation({ summary: 'Send dispute message' })
  async sendMessage(
    @Request() req,
    @Param('disputeId') disputeId: string,
    @Body() data: any,
  ) {
    return this.rentersService.sendDisputeMessage(req.user.id, disputeId, data);
  }

  @Post(':disputeId/uploads')
  @ApiOperation({ summary: 'Upload chat image' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @Request() req,
    @Param('disputeId') disputeId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const id = `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return this.uploadService.uploadFile(id, file, req.user, true);
  }
}
