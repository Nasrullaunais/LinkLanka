import {
  Controller,
  Post,
  BadRequestException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as crypto from 'crypto';
import * as path from 'path';

import { JwtAuthGuard } from '../../core/identity/guards/jwt-auth.guard';
import { mediaUploadOptions, MIME_TO_EXT } from '../../core/common/upload';
import { S3StorageService } from '../../core/common/storage';

interface UploadResponse {
  url: string;
}

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  constructor(private readonly s3StorageService: S3StorageService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', mediaUploadOptions()))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadResponse> {
    if (!file?.buffer) {
      throw new BadRequestException('Uploaded file buffer is missing');
    }

    // Derive extension from the validated MIME type — never trust originalname.
    const ext = MIME_TO_EXT[file.mimetype] ?? path.extname(file.originalname);
    const newFileName = `${crypto.randomUUID()}${ext}`;

    const uploaded = await this.s3StorageService.uploadBuffer({
      buffer: file.buffer,
      fileName: newFileName,
      mimeType: file.mimetype,
    });

    return { url: uploaded.url };
  }
}
