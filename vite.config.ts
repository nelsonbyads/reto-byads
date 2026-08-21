import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

function localMediaPlugin(): Plugin {
  return {
    name: 'dadofit-local-media',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawPath = (req.url ?? '').split('?')[0];
        let pathname: string;
        try {
          pathname = decodeURIComponent(rawPath);
        } catch {
          next();
          return;
        }
        const folder = pathname.startsWith('/images/')
          ? 'images'
          : pathname.startsWith('/videos/')
            ? 'videos'
            : null;
        if (!folder) {
          next();
          return;
        }
        const relative = pathname.slice(1);
        const base = path.resolve(projectRoot, folder);
        const filePath = path.resolve(projectRoot, relative);
        if (!filePath.startsWith(`${base}${path.sep}`)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
        fs.stat(filePath, (error, stats) => {
          if (error || !stats.isFile()) {
            next();
            return;
          }
          res.setHeader('Content-Type', folder === 'videos' ? 'image/gif' : 'image/jpeg');
          fs.createReadStream(filePath).pipe(res);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localMediaPlugin()],
  server: { port: 5175, strictPort: false },
  preview: { port: 4173 },
});
