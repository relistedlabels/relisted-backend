import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { userEntity } from '../auth/auth.types';
import { ClosetService } from './closet.service';
import { CreateClosetDto } from './dto/create-closet.dto';
import { UpdateClosetDto } from './dto/update-closet.dto';

@ApiTags('Closets')
@ApiBearerAuth()
@Controller('closet')
export class ClosetController {
  constructor(private readonly closetService: ClosetService) {}

  @Auth()
  @Post()
  @ApiOperation({ summary: 'Create a closet (authenticated owner)' })
  @ApiUnauthorizedResponse()
  create(@Body() dto: CreateClosetDto, @AuthUser() user: userEntity) {
    return this.closetService.create(dto, user);
  }

  @Auth()
  @Get()
  @ApiOperation({ summary: 'List closets for the current user' })
  @ApiUnauthorizedResponse()
  listMine(@AuthUser() user: userEntity) {
    return this.closetService.listMine(user);
  }

  @Auth()
  @Get(':id')
  @ApiOperation({ summary: 'Get one closet (owner only)' })
  @ApiParam({ name: 'id', description: 'Closet ID' })
  @ApiUnauthorizedResponse()
  @ApiNotFoundResponse()
  findOne(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.closetService.findOneForOwner(id, user);
  }

  @Auth()
  @Patch(':id')
  @ApiOperation({ summary: 'Update closet (owner only)' })
  @ApiParam({ name: 'id', description: 'Closet ID' })
  @ApiUnauthorizedResponse()
  @ApiNotFoundResponse()
  update(
    @Param('id') id: string,
    @Body() dto: UpdateClosetDto,
    @AuthUser() user: userEntity,
  ) {
    return this.closetService.update(id, dto, user);
  }

  @Auth()
  @Delete(':id')
  @ApiOperation({
    summary: 'Deactivate closet (owner only); products keep closet link',
  })
  @ApiParam({ name: 'id', description: 'Closet ID' })
  @ApiUnauthorizedResponse()
  @ApiNotFoundResponse()
  deactivate(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.closetService.deactivate(id, user);
  }
}
