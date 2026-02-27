import { Controller, Get, Put, Post, Body, UseGuards, Request, UploadedFile, UseInterceptors, Param } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RentersService } from './renters.service';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';

@ApiTags('Renters Profile')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.RENTER)
@Controller('api/renters/profile')
export class RentersProfileController {
  constructor(private readonly rentersService: RentersService) {}

  @Get()
  @ApiOperation({ summary: 'Get renter profile' })
  async getProfile(@Request() req) {
    return this.rentersService.getProfile(req.user.id);
  }

  @Put()
  @ApiOperation({ summary: 'Update renter profile' })
  async updateProfile(@Request() req, @Body() updateData: any) {
    return this.rentersService.updateProfile(req.user.id, updateData);
  }

  @Get('addresses')
  @ApiOperation({ summary: 'Get renter addresses' })
  async getAddresses(@Request() req) {
    return this.rentersService.getAddresses(req.user.id);
  }

  @Post('addresses')
  @ApiOperation({ summary: 'Add renter address' })
  async addAddress(@Request() req, @Body() addressData: any) {
    return this.rentersService.addAddress(req.user.id, addressData);
  }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('avatar'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        avatar: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Upload profile avatar' })
  async uploadAvatar(@Request() req, @UploadedFile() file: Express.Multer.File) {
    return this.rentersService.uploadAvatar(req.user.id, file);
  }

  @Get('verifications/status')
  @ApiOperation({ summary: 'Get verification status' })
  async getVerificationStatus(@Request() req) {
    return this.rentersService.getVerificationStatus(req.user.id);
  }

  @Post('verifications/id-document')
  @UseInterceptors(FileInterceptor('idDocument'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        idDocument: {
          type: 'string',
          format: 'binary',
        },
        idType: {
          type: 'string',
          enum: ['national_id', 'passport', 'drivers_license'],
        },
      },
    },
  })
  @ApiOperation({ summary: 'Upload ID document for verification' })
  async uploadIdDocument(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
  ) {
    return this.rentersService.uploadIdDocument(req.user.id, {
      idDocument: file,
      idType: body.idType || 'national_id',
    });
  }
}
