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

interface UploadResponse {
  url: string;
}

@Controller('media')
@UseGuards(JwtAuthGuard)
export class MediaController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { dest: './uploads' }))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UploadResponse> {
    const ext = path.extname(file.originalname);
    const newFileName = `${crypto.randomUUID()}${ext}`;
    const newPath = path.join('./uploads', newFileName);

    await fs.promises.rename(file.path, newPath);

    const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
    return { url: `${baseUrl}/uploads/${newFileName}` };
  }
}
