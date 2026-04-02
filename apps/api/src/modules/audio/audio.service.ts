import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { S3StorageService } from '../../core/common/storage';

@Injectable()
export class AudioService {
  constructor(private readonly s3StorageService: S3StorageService) {}

  async saveAudioBuffer(base64Data: string, mimeType: string): Promise<string> {
    const cleanBase64: string = base64Data.includes(',')
      ? base64Data.split(',')[1]
      : base64Data;

    const buffer: Buffer = Buffer.from(cleanBase64, 'base64');

    const extension: string = this.getExtensionFromMimeType(mimeType);
    const fileName: string = `${randomUUID()}${extension}`;

    const uploaded = await this.s3StorageService.uploadBuffer({
      buffer,
      fileName,
      mimeType,
    });

    return uploaded.url;
  }

  private getExtensionFromMimeType(mimeType: string): string {
    const mimeMap: Record<string, string> = {
      'audio/webm': '.webm',
      'audio/mpeg': '.mp3',
      'audio/mp3': '.mp3',
      'audio/mp4': '.m4a',
      'audio/m4a': '.m4a',
      'audio/ogg': '.ogg',
      'audio/wav': '.wav',
      'audio/x-wav': '.wav',
      'audio/aac': '.aac',
      'audio/flac': '.flac',
      'audio/3gpp': '.3gp',
      'audio/3gpp2': '.3g2',
    };

    return mimeMap[mimeType] ?? '.webm';
  }
}
