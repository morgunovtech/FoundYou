/// <reference types="vitest/config" />
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react-swc';
// The real extension: Vite's future native config loader resolves imports as Node does.
import { stampDsVersions } from './src/build/dsVersionStamp.ts';
import { renderLlmsFull, renderLocalePage, renderSitemap, type BuildInfo } from './src/site/renderStatic.ts';
import type { Language } from './src/i18n/messages.ts';
import { readVersions } from './scripts/asset-versions.mjs';

/**
 * Short commit hash for the footer «build» line. Cloudflare Pages exposes the
 * commit as CF_PAGES_COMMIT_SHA; locally we ask git; anything else is `dev`.
 */
function buildId(): string {
  const fromCi = process.env.CF_PAGES_COMMIT_SHA;
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim() || 'dev';
  } catch {
    return 'dev';
  }
}

/** The date of the commit being built, `YYYY-MM-DD`: the footer's «обновлено» and the JSON-LD `dateModified`. */
function buildDate(): string {
  const today = new Date().toISOString().slice(0, 10);
  if (process.env.CF_PAGES_COMMIT_SHA) return today;
  try {
    return execSync('git log -1 --format=%cs', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || today;
  } catch {
    return today;
  }
}

const PACKAGE_VERSION: string = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version;
const BUILD: BuildInfo = { version: PACKAGE_VERSION, date: buildDate(), id: buildId() };

/** Which of the three pages an HTML entry is, by its path under the root; null for 404.html. */
const PAGE_LANGUAGES: Record<string, Language> = { 'index.html': 'ru', 'en/index.html': 'en', 'uz/index.html': 'uz' };

/**
 * One page per language from the one template. `index.html` is the template (the Russian page
 * is rendered from it too); `en/index.html` and `uz/index.html` are stubs whose only role is to
 * be Vite entries at those paths. The `pre` hook replaces each entry's HTML with the rendered
 * page before Vite collects its scripts, in the dev server and in the build alike, so `/en/` on
 * localhost is the same page Cloudflare serves. The sitemap and llms-full.txt come from the same
 * dictionary: emitted into dist at build, served by a middleware in dev.
 */
function localePages(): Plugin {
  const template = () => readFileSync(path.resolve(__dirname, 'index.html'), 'utf8');
  return {
    name: 'locale-pages',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const entry = path.relative(__dirname, ctx.filename).split(path.sep).join('/');
        const lang = PAGE_LANGUAGES[entry];
        return lang ? renderLocalePage(template(), lang, BUILD) : html;
      }
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (pathname === '/sitemap.xml') {
          res.setHeader('Content-Type', 'application/xml; charset=utf-8');
          res.end(renderSitemap(BUILD.date));
        } else if (pathname === '/llms-full.txt') {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(renderLlmsFull(BUILD));
        } else {
          next();
        }
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: renderSitemap(BUILD.date) });
      this.emitFile({ type: 'asset', fileName: 'llms-full.txt', source: renderLlmsFull(BUILD) });
    }
  };
}

/**
 * The design-system stylesheets live in public/ds/v1 and are linked from
 * index.html and 404.html with `?v=dev`. At build time the stamp becomes a content hash
 * (`src/build/dsVersionStamp.ts`, tested there), so a DS update busts the
 * cache while unchanged files keep theirs. A stylesheet index.html links but
 * public/ds/v1 does not hold fails the build rather than shipping `?v=dev`.
 */
function dsVersionStamp() {
  const dsDir = path.resolve(__dirname, 'public/ds/v1');
  return {
    name: 'ds-version-stamp',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return stampDsVersions(html, (name) => readFileSync(path.join(dsDir, name)));
    }
  };
}

function functionsDevProxy() {
  const apiDir = path.resolve(__dirname, 'functions/api');

  return {
    name: 'cloudflare-functions-dev-proxy',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) {
          next();
          return;
        }

        const requestUrl = new URL(url, 'http://localhost');
        const apiPath = requestUrl.pathname.replace(/^\/api\//, '');
        if (!/^[a-z0-9-]+(?:\/[a-z0-9.-]+)*$/i.test(apiPath)) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        // `/api/<name>` → functions/api/<name>.ts; `/api/<name>/a/b` → functions/api/<name>/[[path]].ts
        // with `params.path = ['a', 'b']`, the way Cloudflare routes a catch-all segment.
        const [functionName, ...rest] = apiPath.split('/');
        const modulePath = rest.length === 0 ? `${functionName}.ts` : `${functionName}/[[path]].ts`;
        const filePath = path.join(apiDir, modulePath);
        try {
          await fs.access(filePath);
        } catch {
          next();
          return;
        }

        try {
          // Use Vite's ssrLoadModule to properly transform TypeScript
          const mod = await server.ssrLoadModule(`/functions/api/${modulePath}`);
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

          const fullUrl = new URL(url, `http://${req.headers.host || 'localhost:5173'}`);
          const request = new Request(fullUrl.toString(), {
            method: req.method,
            headers
          });

          const response: Response = await mod.onRequest({
            request,
            env: {},
            params: rest.length === 0 ? {} : { path: rest },
            // Cloudflare-only hook; here we just make sure a rejected
            // background promise (cache put) cannot crash the dev server.
            waitUntil: (p: Promise<unknown>) => {
              void p.catch(() => undefined);
            }
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
          // The same body shape and code `defineHandler` in functions/api/_geo.ts answers with.
          res.end(JSON.stringify({ ok: false, error: 'internal-error' }));
        }
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), functionsDevProxy(), localePages(), dsVersionStamp()],
  define: {
    __BUILD__: JSON.stringify(BUILD.id),
    __VERSION__: JSON.stringify(BUILD.version),
    __BUILD_DATE__: JSON.stringify(BUILD.date),
    // The versioned asset directories `prepare:assets` writes; `src/assetPaths.ts` reads them.
    __ASSET_VERSIONS__: JSON.stringify(readVersions(__dirname))
  },
  build: {
    outDir: 'dist',
    sourcemap: 'hidden',
    // Four HTML entries: the three language pages (localePages) and 404.html, which Cloudflare
    // Pages serves with a 404 status for any path that is not an asset. Without a dist/404.html
    // Pages answers every path with index.html and 200 (the SPA fallback), which a crawler reads
    // as a site where every address exists. All four go through dsVersionStamp.
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        en: path.resolve(__dirname, 'en/index.html'),
        uz: path.resolve(__dirname, 'uz/index.html'),
        notFound: path.resolve(__dirname, '404.html')
      }
    }
  },
  test: {
    include: ['src/**/__tests__/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    // Replaces globalThis.fetch with a guard that throws: no test reaches the network.
    setupFiles: ['src/__tests__/setup.ts']
  }
});
