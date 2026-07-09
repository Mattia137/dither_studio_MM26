import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

function listInputImages(inputDir) {
  try {
    return fs.readdirSync(inputDir).filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()));
  } catch {
    return [];
  }
}

// Dev server: serves /input/* as static files and exposes GET /__input_list
// (JSON array of filenames) by reading the filesystem live.
// Static build (e.g. GitHub Pages): there's no server to answer that request,
// so `generateBundle` bakes the same file list into a static `__input_list`
// asset and copies the images into dist/input/ — the client-side fetch() in
// main.js is identical in both cases, it just hits a live endpoint in dev and
// a pre-baked file in production.
function inputFolderPlugin() {
  const inputDir = path.resolve(__dirname, 'input');

  return {
    name: 'input-folder',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/__input_list') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(listInputImages(inputDir)));
          return;
        }

        if (req.url && req.url.startsWith('/input/')) {
          const rel = decodeURIComponent(req.url.slice('/input/'.length).split('?')[0]);
          const filePath = path.join(inputDir, rel);
          if (filePath.startsWith(inputDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
            fs.createReadStream(filePath).pipe(res);
            return;
          }
        }

        next();
      });
    },
    generateBundle() {
      const files = listInputImages(inputDir);
      this.emitFile({ type: 'asset', fileName: '__input_list', source: JSON.stringify(files) });
      for (const name of files) {
        this.emitFile({
          type: 'asset',
          fileName: `input/${name}`,
          source: fs.readFileSync(path.join(inputDir, name)),
        });
      }
    },
  };
}

export default defineConfig({
  // Relative base so the build works whether GitHub Pages serves it at the
  // domain root (user/org page) or under /<repo-name>/ (project page) —
  // avoids hardcoding a repo name that could change.
  base: './',
  publicDir: false,
  plugins: [inputFolderPlugin()],
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // input/output hold user-dropped binary files that can be mid-write/locked
      // (Windows EBUSY) — they're served by our own middleware, not the module
      // graph, so they don't need HMR watching. A watch error here crashes the
      // whole dev server process, so keep this list wide.
      ignored: ['**/input/**', '**/output/**'],
    },
  },
});
