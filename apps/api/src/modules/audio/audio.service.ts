import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

@Injectable()
export class AudioService {
  private readonly uploadsDir: string = join(process.cwd(), 'uploads');

  async saveAudioBuffer(
    base64Data: string,
    mimeType: string,
  ): Promise<string> {
    const cleanBase64: string = base64Data.includes(',')
      ? base64Data.split(',')[1]
      : base64Data;

    const buffer: Buffer = Buffer.from(cleanBase64, 'base64');

    const extension: string = this.getExtensionFromMimeType(mimeType);
    const fileName: string = `${randomUUID()}${extension}`;

    await mkdir(this.uploadsDir, { recursive: true });

    const filePath: string = join(this.uploadsDir, fileName);
    await writeFile(filePath, buffer);

    const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
    return `${baseUrl}/uploads/${fileName}`;
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
