import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, constants, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * Local-volume storage backend (STORAGE_DRIVER=disk, the default): one folder
 * per bucket. Writes go to a temporary file that is renamed into place only
 * after the whole upload was accepted.
 */
export function createDiskBackend(dir) {
  const root = path.resolve(dir);

  function resolve(bucket, name) {
    const target = path.resolve(root, bucket, name);
    if (!target.startsWith(path.join(root, bucket) + path.sep)) throw new Error('invalid object path');
    return target;
  }

  return {
    driver: 'disk',
    async ensureBuckets(buckets) {
      for (const bucket of buckets) await mkdir(path.join(root, bucket), { recursive: true });
    },
    async ping() {
      await access(root, constants.W_OK);
    },
    async exists(bucket, name) {
      return (await this.size(bucket, name)) !== null;
    },
    async size(bucket, name) {
      try {
        const info = await stat(resolve(bucket, name));
        return info.isFile() ? info.size : null;
      } catch {
        return null;
      }
    },
    async put(bucket, name, source) {
      const target = resolve(bucket, name);
      await mkdir(path.dirname(target), { recursive: true });
      const temp = `${target}.${randomUUID()}.part`;
      try {
        await pipeline(source, createWriteStream(temp, { flags: 'wx' }));
        await rename(temp, target);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    },
    async read(bucket, name, range) {
      return createReadStream(resolve(bucket, name), range ?? {});
    },
    async remove(bucket, name) {
      await rm(resolve(bucket, name), { force: true });
    },
  };
}
