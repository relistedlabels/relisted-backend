import { Controller, Get, Post, Body, UseGuards, Request, Query, Param, Delete } from '@nestjs/common';
import { RentersService } from './renters.service';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Renters Favorites')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.RENTER)
@Controller('api/renters/favorites')
export class RentersFavoritesController {
  constructor(private readonly rentersService: RentersService) {}

  @Get()
  @ApiOperation({ summary: 'Get favorite items' })
  async getFavorites(@Request() req, @Query() query: any) {
    return this.rentersService.getFavorites(req.user.id, query);
  }

  @Post(':productId')
  @ApiOperation({ summary: 'Add favorite item' })
  async addFavorite(@Request() req, @Param('productId') productId: string) {
    return this.rentersService.addFavorite(req.user.id, productId);
  }

  @Delete(':productId')
  @ApiOperation({ summary: 'Remove favorite item' })
  async removeFavorite(@Request() req, @Param('productId') productId: string) {
    return this.rentersService.removeFavorite(req.user.id, productId);
  }
}
