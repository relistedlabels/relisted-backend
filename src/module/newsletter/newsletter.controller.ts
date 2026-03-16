import { Controller, Post, Body } from '@nestjs/common';
import { NewsletterService } from './newsletter.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

class SubscribeDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

@ApiTags('Newsletter')
@Controller('api/newsletter')
export class NewsletterController {
  constructor(private readonly newsletterService: NewsletterService) {}

  @Post('subscribe')
  @ApiOperation({ summary: 'Subscribe to newsletter' })
  @ApiResponse({ status: 201, description: 'Subscribed successfully' })
  async subscribe(@Body() dto: SubscribeDto) {
    await this.newsletterService.subscribe(dto.email);
    return {
      success: true,
      message: 'Successfully subscribed to newsletter',
    };
  }

  @Post('unsubscribe')
  @ApiOperation({ summary: 'Unsubscribe from newsletter' })
  @ApiResponse({ status: 201, description: 'Unsubscribed successfully' })
  async unsubscribe(@Body() dto: SubscribeDto) {
    await this.newsletterService.unsubscribe(dto.email);
    return {
      success: true,
      message: 'Successfully unsubscribed from newsletter',
    };
  }
}
