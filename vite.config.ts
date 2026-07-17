import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

function functionsDevProxy() {
  const apiDir = path.resolve(__dirname, 'functions/api');

  return {
    name: 'cloudflare-functions-dev-proxy',
    configureServer(server: any) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) {
          next();
          return;
        }

        const requestUrl = new URL(url, 'http://localhost');
        const functionName = requestUrl.pathname.replace(/^\/api\//, '');
        if (!/^[a-z0-9-]+$/i.test(functionName)) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        const filePath = path.join(apiDir, `${functionName}.ts`);
        try {
          await fs.access(filePath);
        } catch {
          next();
          return;
        }

        try {
          const moduleUrl = `${pathToFileURL(filePath).href}?t=${Date.now()}`;
          const mod = await import(moduleUrl);
          if (typeof mod.onRequest !== 'function') {
            res.statusCode = 500;
            res.end('Function missing onRequest');
            return;
          }

          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (Array.isArray(value)) {
              value.forEach((entry) => headers.append(key, entry));
            } else if (typeof value === 'string') {
              headers.set(key, value);
            }
          }

          const request = new Request(requestUrl.toString(), {
            method: req.method,
            headers
          });

          const response: Response = await mod.onRequest({
            request,
            env: {},
            params: {}
          });

          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });
          const body = await response.arrayBuffer();
          res.end(Buffer.from(body));
        } catch (error) {
          console.error('functions-dev-proxy', error);
          res.statusCode = 500;
          res.end('Function execution failed');
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), functionsDevProxy()],
  build: {
    outDir: 'dist',
    // Карты исходников не публикуем: 19 МБ в dist и раскрытие исходного кода
    sourcemap: false
  }
});
