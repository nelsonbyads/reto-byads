import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const folder of ['images', 'videos']) {
  const source = path.join(root, folder);
  const destination = path.join(root, 'dist', folder);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.cp(source, destination, { recursive: true });
  console.log(`Copied ${folder}/ -> dist/${folder}/`);
}
