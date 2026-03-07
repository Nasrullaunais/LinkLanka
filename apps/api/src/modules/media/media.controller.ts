import {
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { JwtAuthGuard } from '../../core/identity/guards/jwt-auth.guard';
import { mediaUploadOptions, MIME_TO_EXT } from '../../core/common/upload';

interface UploadResponse {
  url: string;
}

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', mediaUploadOptions('./uploads')))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadResponse> {
    // Derive extension from the validated MIME type — never trust originalname.
    const ext = MIME_TO_EXT[file.mimetype] ?? path.extname(file.originalname);
    const newFileName = `${crypto.randomUUID()}${ext}`;
    const newPath = path.join('./uploads', newFileName);

    await fs.promises.rename(file.path, newPath);

    const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
    return { url: `${baseUrl}/uploads/${newFileName}` };
  }
}
