import {
  Controller,
  Post,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guard/authGuard';
import { RoleGuard } from '../auth/guard/roleGuard';
import { Roles } from '../auth/decorator/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProductAvailabilityNotifyService } from '../../services/product-availability-notify/product-availability-notify.service';

@ApiTags('Renters Products')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(Role.RENTER)
@Controller('api/renters/products')
export class RentersProductNotifyController {
  constructor(
    private readonly productAvailabilityNotifyService: ProductAvailabilityNotifyService,
  ) {}

  @Post(':productId/notify-when-available')
  @ApiOperation({
    summary:
      'Subscribe to email when a rented product becomes available again',
  })
  async subscribeWhenAvailable(
    @Request() req: { user: { id: string } },
    @Param('productId') productId: string,
  ) {
    return this.productAvailabilityNotifyService.subscribe(
      req.user.id,
      productId,
    );
  }
}
