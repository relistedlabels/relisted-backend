import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ListersService } from './listers.service';

@ApiTags('Public Lister Response')
@Controller('api/public/lister-response')
export class ListersAvailabilityPublicController {
  constructor(private readonly listersService: ListersService) {}

  @Get(':token')
  @ApiOperation({
    summary: 'One-tap lister YES/NO via email or WhatsApp magic link',
  })
  respond(
    @Param('token') token: string,
    @Query('action') action: 'accept' | 'reject',
  ) {
    return this.listersService.respondToAvailabilityViaToken(token, action);
  }
}
