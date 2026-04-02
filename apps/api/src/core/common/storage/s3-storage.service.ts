import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface UploadBufferParams {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  folder?: string;
}

export interface UploadBufferResult {
  key: string;
  url: string;
}

@Injectable()
export class S3StorageService {
  private readonly bucket: string;
  private readonly region: string;
  private readonly prefix: string;
  private readonly signedReadUrlTtlSeconds: number;
  private readonly client: S3Client;

  constructor(private readonly configService: ConfigService) {
    this.bucket = (
      this.configService.get<string>('AWS_S3_BUCKET') ?? ''
    ).trim();
    this.region =
      (
        this.configService.get<string>('AWS_S3_REGION') ??
        this.configService.get<string>('AWS_REGION') ??
        'ap-south-1'
      ).trim() || 'ap-south-1';
    this.prefix = this.normalizePrefix(
      this.configService.get<string>('AWS_S3_PREFIX') ?? 'linklanka/',
    );
    this.signedReadUrlTtlSeconds = this.resolveSignedReadUrlTtlSeconds(
      this.configService.get<string>('AWS_S3_SIGNED_URL_TTL_SECONDS'),
    );

    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'AWS_SECRET_ACCESS_KEY',
    );
    const sessionToken = this.configService.get<string>('AWS_SESSION_TOKEN');

    this.client = new S3Client({
      region: this.region,
      ...(accessKeyId && secretAccessKey
        ? {
            credentials: {
              accessKeyId,
              secretAccessKey,
              ...(sessionToken ? { sessionToken } : {}),
            },
          }
        : {}),
    });
  }

  async uploadBuffer(params: UploadBufferParams): Promise<UploadBufferResult> {
    this.assertConfigured();

    const key = this.buildObjectKey(params.fileName, params.folder);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: params.buffer,
        ContentType: params.mimeType,
      }),
    );

    return {
      key,
      url: this.buildPublicUrl(key),
    };
  }

  async downloadBufferByKey(key: string): Promise<Buffer> {
    this.assertConfigured();

    const normalizedKey = key.replace(/^\/+/, '');
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: normalizedKey,
      }),
    );

    if (!response.Body) {
      throw new InternalServerErrorException('S3 object has no body');
    }

    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async downloadBufferFromUrl(fileUrl: string): Promise<Buffer> {
    const trimmed = fileUrl.trim();
    if (!trimmed) {
      throw new InternalServerErrorException('Media URL is empty');
    }

    if (!/^https?:\/\//i.test(trimmed)) {
      return this.downloadBufferByKey(trimmed.replace(/^\/+/, ''));
    }

    const s3Key = this.extractKeyFromS3Url(trimmed);
    if (s3Key) {
      return this.downloadBufferByKey(s3Key);
    }

    return this.fetchBufferWithRetry(trimmed);
  }

  buildPublicUrl(key: string): string {
    const host =
      this.region === 'us-east-1'
        ? `${this.bucket}.s3.amazonaws.com`
        : `${this.bucket}.s3.${this.region}.amazonaws.com`;

    const encodedKey = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');

    return `https://${host}/${encodedKey}`;
  }

  async createSignedReadUrl(
    fileUrlOrKey: string,
    expiresInSeconds?: number,
  ): Promise<string> {
    this.assertConfigured();

    const trimmed = fileUrlOrKey.trim();
    if (!trimmed) {
      return fileUrlOrKey;
    }

    let key: string | null = this.extractKeyFromS3Url(trimmed);
    if (!key && !/^https?:\/\//i.test(trimmed)) {
      key = trimmed.replace(/^\/+/, '');
    }

    if (!key) {
      return fileUrlOrKey;
    }

    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
      {
        expiresIn: this.normalizeSignedReadUrlTtl(expiresInSeconds),
      },
    );
  }

  private buildObjectKey(fileName: string, folder?: string): string {
    const safeFileName = fileName.replace(/^\/+|\/+$/g, '');
    const safeFolder = folder ? folder.replace(/^\/+|\/+$/g, '') : '';

    const pathParts = [
      this.prefix.replace(/\/+$/g, ''),
      safeFolder,
      safeFileName,
    ]
      .filter((part) => part.length > 0)
      .join('/');

    return pathParts.replace(/\/{2,}/g, '/');
  }

  private extractKeyFromS3Url(fileUrl: string): string | null {
    try {
      const parsed = new URL(fileUrl);
      const host = parsed.hostname.toLowerCase();
      const pathname = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');

      if (!pathname) {
        return null;
      }

      const virtualHost = this.bucket.toLowerCase();
      if (
        host.startsWith(`${virtualHost}.s3.`) ||
        host.startsWith(`${virtualHost}.s3-`)
      ) {
        return pathname;
      }

      if (
        host.includes('amazonaws.com') &&
        pathname.startsWith(`${this.bucket}/`)
      ) {
        return pathname.slice(this.bucket.length + 1);
      }

      return null;
    } catch {
      return null;
    }
  }

  private async fetchBufferWithRetry(url: string): Promise<Buffer> {
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) {
          if (
            attempt < maxAttempts &&
            this.isRetryableStatusCode(response.status)
          ) {
            await this.delay(attempt * 250);
            continue;
          }

          throw new InternalServerErrorException(
            `Failed to fetch media from URL: ${response.status}`,
          );
        }

        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        if (attempt < maxAttempts && this.isRetryableFetchError(error)) {
          await this.delay(attempt * 250);
          continue;
        }

        if (error instanceof InternalServerErrorException) {
          throw error;
        }

        throw new InternalServerErrorException(
          `Failed to fetch media from URL: ${String(error)}`,
        );
      }
    }

    throw new InternalServerErrorException('Failed to fetch media from URL');
  }

  private isRetryableStatusCode(statusCode: number): boolean {
    return (
      statusCode === 408 ||
      statusCode === 425 ||
      statusCode === 429 ||
      (statusCode >= 500 && statusCode <= 504)
    );
  }

  private isRetryableFetchError(error: unknown): boolean {
    if (!error) {
      return false;
    }

    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : typeof error === 'string'
          ? error.toLowerCase()
          : '';

    return (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('enotfound') ||
      message.includes('eai_again') ||
      message.includes('network')
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalizePrefix(prefix: string): string {
    const normalized = prefix.replace(/^\/+|\/+$/g, '');
    return normalized.length > 0 ? `${normalized}/` : '';
  }

  private resolveSignedReadUrlTtlSeconds(rawValue: string | undefined): number {
    const parsed = Number.parseInt(rawValue ?? '', 10);
    if (!Number.isFinite(parsed)) {
      return 3600;
    }

    return this.normalizeSignedReadUrlTtl(parsed);
  }

  private normalizeSignedReadUrlTtl(seconds: number | undefined): number {
    const fallback = this.signedReadUrlTtlSeconds || 3600;
    const candidate =
      typeof seconds === 'number' && Number.isFinite(seconds)
        ? Math.floor(seconds)
        : fallback;

    // AWS SigV4 presigned URL max is 7 days.
    return Math.min(604_800, Math.max(60, candidate));
  }

  private assertConfigured(): void {
    if (!this.bucket) {
      throw new InternalServerErrorException('AWS_S3_BUCKET is not configured');
    }
  }
}
