import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { UploadService } from './upload.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { userEntity } from '../auth/auth.types';
import { Auth, AuthUser } from '../auth/decorator/auth.decorator';
import { bad } from 'src/utils/error';
import { ApiBearerAuth, ApiResponse,ApiConsumes, ApiBody, ApiCookieAuth } from '@nestjs/swagger';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}
  @ApiCookieAuth("access_token")
  @Auth()
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data') 
  @ApiBody({
    description: 'File to upload',
    required: true,
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' }, // Swagger shows a file picker
      },
    },
  })
  @ApiResponse({ status: 201, description: 'File uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async upload(
    // @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @AuthUser() user: userEntity,
  
  ) {
    
    return await this.uploadService.uploadFile(file, user);
  }

  @Post('bulk')
  async uploadIds(@Body('ids') ids: string[]) {
    return await this.uploadService.uploadIds(ids);
  }

  @Get(':id')
  async downloadUpload(@Param('id') id: string) {
    return await this.uploadService.download(id);
  }

  @Auth()
  @Delete()
  async cleanUp(
    @Body('ids') ids: string | string[],
    @AuthUser() user: userEntity,
  ) {
    if (typeof ids === 'string') {
      // (/,\s*/g)
      ids.split(/,\s*/g);
    }
    if (!Array.isArray(ids)) bad('not an array');

    return await this.uploadService.deleteUpload(ids, user);
  }
}
