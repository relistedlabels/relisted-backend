import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { RentersService } from './renters.service';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Renters Security')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.RENTER)
@Controller('api/renters/security')
export class RentersSecurityController {
  constructor(private readonly rentersService: RentersService) {}

  @Post('password')
  @ApiOperation({ summary: 'Change password' })
  async changePassword(@Request() req, @Body() data: any) {
    return this.rentersService.changePassword(req.user.id, data);
  }
}
