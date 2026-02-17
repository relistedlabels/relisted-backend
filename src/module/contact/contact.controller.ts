import { Controller, Post, Body } from '@nestjs/common';
import { ContactService } from './contact.service';
import { CreateContactSubmissionDto } from './dto/create-contact-submission.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBadRequestResponse } from '@nestjs/swagger';

@ApiTags('Public - Contact')
@Controller('api/public/contact-us')
export class ContactController {
  constructor(private readonly contactService: ContactService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a contact form message' })
  @ApiResponse({
    status: 201,
    description: 'Contact message submitted successfully',
    schema: {
      example: {
        success: true,
        message: 'Your message has been received. We will get back to you within 24 hours.',
        data: {
          ticketId: 'uuid',
          submittedAt: '2026-02-08T14:30:00Z',
          status: 'RECEIVED',
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Missing required fields' })
  create(@Body() createContactSubmissionDto: CreateContactSubmissionDto) {
    return this.contactService.create(createContactSubmissionDto);
  }
}
