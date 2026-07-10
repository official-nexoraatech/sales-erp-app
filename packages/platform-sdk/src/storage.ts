/* global Buffer */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StorageClientConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  useSSL: boolean;
  bucket: string;
  region?: string;
}

// S3-compatible object storage client — talks to MinIO in dev, AWS S3 in production.
export class StorageClient {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: StorageClientConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: `${config.useSSL ? 'https' : 'http'}://${config.endpoint}`,
      region: config.region ?? 'us-east-1',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true, // required for MinIO
    });
  }

  async uploadFile(
    tenantId: number,
    prefix: string,
    fileName: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<string> {
    const objectKey = `tenant/${tenantId}/${prefix}/${Date.now()}-${fileName}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: mimeType,
      })
    );
    return objectKey;
  }

  async getSignedUrl(objectKey: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: objectKey });
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async deleteFile(objectKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }

  async bucketExists(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
