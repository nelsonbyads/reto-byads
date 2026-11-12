import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

const PART_SIZE = 8 * 1024 * 1024;

function isNotFound(error) {
  return error?.name === 'NotFound' || error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;
}

/**
 * Amazon S3 (or S3-compatible) storage backend (STORAGE_DRIVER=s3). All logical
 * buckets share one S3 bucket: object key = <prefix><bucket>/<name>.
 * Credentials come from the default AWS chain (IAM role of the ECS task / EC2
 * instance in AWS; AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY elsewhere), never
 * from the application config.
 */
export function createS3Backend(options, client = null) {
  const s3 = client ?? new S3Client({
    region: options.region,
    ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    forcePathStyle: options.forcePathStyle,
  });
  const Bucket = options.bucket;
  const key = (bucket, name) => `${options.prefix}${bucket}/${name}`;

  return {
    driver: 's3',
    client: s3,
    async ensureBuckets() {
      // The S3 bucket is provisioned with the infrastructure; only check access.
      await this.ping();
    },
    async ping() {
      await s3.send(new HeadBucketCommand({ Bucket }));
    },
    async exists(bucket, name) {
      return (await this.size(bucket, name)) !== null;
    },
    async size(bucket, name) {
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket, Key: key(bucket, name) }));
        return Number(head.ContentLength ?? 0);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async put(bucket, name, source, contentType) {
      const upload = new Upload({
        client: s3,
        params: {
          Bucket,
          Key: key(bucket, name),
          Body: source,
          ContentType: contentType,
          ...(options.serverSideEncryption ? { ServerSideEncryption: options.serverSideEncryption } : {}),
        },
        partSize: PART_SIZE,
        queueSize: 2,
        leavePartsOnError: false,
      });
      await upload.done();
    },
    async read(bucket, name, range) {
      const response = await s3.send(new GetObjectCommand({
        Bucket,
        Key: key(bucket, name),
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }));
      return response.Body;
    },
    async remove(bucket, name) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key(bucket, name) }));
    },
  };
}
