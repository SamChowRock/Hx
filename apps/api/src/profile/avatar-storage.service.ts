import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationShutdown,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

import { ENVIRONMENT, type Environment } from '../../../../libs/platform/src/config';

export const AVATAR_S3_CLIENT = Symbol('AVATAR_S3_CLIENT');
export const maximumAvatarInputBytes = 5 * 1024 * 1024;
const maximumAvatarOutputBytes = 1024 * 1024;
const allowedInputFormats = new Set(['jpeg', 'png', 'webp']);

type ProviderError = Error & {
  $metadata?: { httpStatusCode?: number };
  Code?: string;
  code?: string;
};

type TransformableBody = {
  transformToByteArray(): Promise<Uint8Array>;
};

@Injectable()
export class AvatarStorageService implements OnApplicationShutdown {
  private readonly logger = new Logger(AvatarStorageService.name);
  private bucketReady: Promise<void> | undefined;

  constructor(
    @Inject(AVATAR_S3_CLIENT) private readonly client: S3Client,
    @Inject(ENVIRONMENT) private readonly environment: Environment,
  ) {}

  onApplicationShutdown(): void {
    this.client.destroy();
  }

  async store(userId: string, input: Buffer): Promise<string> {
    if (input.length === 0) throw new BadRequestException('An avatar image is required.');
    if (input.length > maximumAvatarInputBytes) {
      throw new PayloadTooLargeException('Avatar images cannot exceed 5 MiB.');
    }

    let output: Buffer;
    try {
      const image = sharp(input, { failOn: 'error', limitInputPixels: 25_000_000 });
      const metadata = await image.metadata();
      if (!metadata.format || !allowedInputFormats.has(metadata.format)) {
        throw new BadRequestException('Avatar must be a JPEG, PNG, or WebP image.');
      }
      if ((metadata.pages ?? 1) !== 1) {
        throw new BadRequestException('Animated or multi-page avatars are not supported.');
      }
      output = await image
        .rotate()
        .resize(512, 512, { fit: 'cover', position: 'attention' })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Avatar contains invalid or unsupported image data.');
    }
    if (output.length > maximumAvatarOutputBytes) {
      throw new PayloadTooLargeException('The processed avatar is too large.');
    }

    await this.ensureBucket();
    const key = `avatars/${userId}/${randomUUID()}.webp`;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.environment.OBJECT_STORAGE_BUCKET,
          Key: key,
          Body: output,
          ContentType: 'image/webp',
          ContentLength: output.length,
          CacheControl: 'private, max-age=300',
        }),
      );
      return key;
    } catch {
      throw new ServiceUnavailableException('Avatar storage is unavailable.');
    }
  }

  async load(key: string): Promise<{ bytes: Buffer; etag?: string }> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.environment.OBJECT_STORAGE_BUCKET, Key: key }),
      );
      if (
        (result.ContentLength !== undefined && result.ContentLength > maximumAvatarOutputBytes) ||
        !this.isTransformableBody(result.Body)
      ) {
        throw new ServiceUnavailableException('Stored avatar is invalid.');
      }
      const bytes = Buffer.from(await result.Body.transformToByteArray());
      if (bytes.length > maximumAvatarOutputBytes) {
        throw new ServiceUnavailableException('Stored avatar is invalid.');
      }
      return { bytes, etag: result.ETag };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      if (this.isNotFound(error)) throw new NotFoundException('Avatar was not found.');
      throw new ServiceUnavailableException('Avatar storage is unavailable.');
    }
  }

  async deleteBestEffort(key: string | null | undefined): Promise<void> {
    if (!key) return;
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.environment.OBJECT_STORAGE_BUCKET, Key: key }),
      );
    } catch {
      this.logger.warn('Unable to remove an unreferenced avatar object.');
    }
  }

  private async ensureBucket(): Promise<void> {
    this.bucketReady ??= this.verifyBucket().catch((error: unknown) => {
      this.bucketReady = undefined;
      throw error;
    });
    return this.bucketReady;
  }

  private async verifyBucket(): Promise<void> {
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.environment.OBJECT_STORAGE_BUCKET }),
      );
      return;
    } catch (error) {
      if (!this.isNotFound(error)) {
        throw new ServiceUnavailableException('Avatar storage is unavailable.');
      }
    }

    if (this.environment.NODE_ENV !== 'development' && this.environment.NODE_ENV !== 'test') {
      throw new ServiceUnavailableException('Avatar storage bucket is not provisioned.');
    }
    try {
      await this.client.send(
        new CreateBucketCommand({ Bucket: this.environment.OBJECT_STORAGE_BUCKET }),
      );
    } catch (error) {
      if (!this.isBucketAlreadyOwned(error)) {
        throw new ServiceUnavailableException('Avatar storage is unavailable.');
      }
    }
  }

  private isTransformableBody(body: unknown): body is TransformableBody {
    return (
      typeof body === 'object' &&
      body !== null &&
      'transformToByteArray' in body &&
      typeof body.transformToByteArray === 'function'
    );
  }

  private isNotFound(error: unknown): error is ProviderError {
    return (
      error instanceof Error &&
      (error.name === 'NotFound' ||
        error.name === 'NoSuchBucket' ||
        error.name === 'NoSuchKey' ||
        (error as ProviderError).$metadata?.httpStatusCode === 404)
    );
  }

  private isBucketAlreadyOwned(error: unknown): error is ProviderError {
    if (!(error instanceof Error)) return false;
    const providerError = error as ProviderError;
    return (
      error.name === 'BucketAlreadyOwnedByYou' ||
      providerError.Code === 'BucketAlreadyOwnedByYou' ||
      providerError.code === 'BucketAlreadyOwnedByYou'
    );
  }
}
