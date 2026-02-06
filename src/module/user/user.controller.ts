import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiParam,
  ApiBearerAuth,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { Role } from '@prisma/client';
import { userEntity } from '../auth/auth.types';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  // Get all users with pagination (Admin only)
  @Auth([Role.ADMIN])
  @Get('all')
  @ApiOperation({
    summary: 'Get all users with pagination (Admin only)',
    description:
      'Returns paginated list of users with name, email, total rentals, date joined, and suspension status',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiResponse({
    status: 200,
    description: 'Users retrieved successfully',
    schema: {
      example: {
        success: true,
        data: {
          users: [
            {
              id: 'uuid',
              name: 'John Doe',
              email: 'john@example.com',
              totalRentals: 5,
              dateJoined: '2026-01-15T10:00:00.000Z',
              isSuspended: false,
              role: 'RENTER',
            },
          ],
          pagination: {
            page: 1,
            limit: 10,
            total: 50,
            totalPages: 5,
            hasNext: true,
            hasPrevious: false,
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Not an admin' })
  getAllUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @AuthUser() user?: userEntity,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.userService.getAllUsers(pageNum, limitNum);
  }

  // Suspend user (Admin only)
  @Auth([Role.ADMIN])
  @Patch(':id/suspend')
  @ApiOperation({ summary: 'Suspend a user (Admin only)' })
  @ApiParam({ name: 'id', description: 'User ID', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'User suspended successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Not an admin' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiBadRequestResponse({ description: 'User already suspended' })
  suspendUser(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.userService.suspendUser(id, user);
  }

  // Unsuspend user (Admin only)
  @Auth([Role.ADMIN])
  @Patch(':id/unsuspend')
  @ApiOperation({ summary: 'Unsuspend a user (Admin only)' })
  @ApiParam({ name: 'id', description: 'User ID', example: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'User unsuspended successfully',
  })
  @ApiUnauthorizedResponse({ description: 'Unauthorized' })
  @ApiForbiddenResponse({ description: 'Forbidden: Not an admin' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiBadRequestResponse({ description: 'User is not suspended' })
  unsuspendUser(@Param('id') id: string, @AuthUser() user: userEntity) {
    return this.userService.unsuspendUser(id, user);
  }

  @Get()
  findAll() {
    return this.userService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.userService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.update(+id, updateUserDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.userService.remove(+id);
  }
}
