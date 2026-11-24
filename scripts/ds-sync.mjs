#!/usr/bin/env node
/**
 * ds-sync.mjs — keeps the vendored morgunov.tech design system equal to its origin.
 *
 *   public/ds/v1/*.css, USAGE.md   the layer, byte for byte as https://s.morgunov.tech/ds/v1/ serves it
 *   public/fonts/*.woff2, OFL.txt  IBM Plex, the same files the origin serves under /fonts/
 *   index.html, 404.html           the three critical token lines (:root, dark, high-contrast),
 *                                  minified from tokens.css so the first paint is themed
 *
 * `ds.json` at the repo root is the manifest: every file with the first 8 hex characters of
 * its SHA-1 — the same number the origin stamps as `?v=` (about-me-page scripts/version-stamp.py),
 * so an entry reads «synced to tokens.css fa7fc139».
 *
 *   node scripts/ds-sync.mjs --check   offline: every file hashes as the manifest says and the
 *                                      critical lines are what tokens.css produces; exit 1 otherwise.
 *                                      CI runs it, so a hand edit of a copy fails the build.
 *   node scripts/ds-sync.mjs --write   online: fetch every file from the origin, write what changed,
 *                                      update the manifest, regenerate the critical lines. The last
 *                                      line, `summary: …`, is the commit message of the weekly PR
 *                                      (.github/workflows/ds-sync.yml).
 *
 * Node >= 22.13 (the `engines` field in package.json), ESM, no deps. The pure functions are
 * exported for src/__tests__/build/dsSync.test.ts; the CLI runs only when the file is executed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The critical lines index.html and 404.html carry, in the order tokens.css declares the blocks. */
export const CRITICAL_SELECTORS = [':root', '[data-theme="dark"]', '[data-theme="high-contrast"]'];

/** The pages that carry the critical lines. */
export const CRITICAL_PAGES = ['index.html', '404.html'];

const FETCH_TIMEOUT_MS = 30_000;

/** @param {Uint8Array | string} bytes */
export function shortHash(bytes) {
  return createHash('sha1').update(bytes).digest('hex').slice(0, 8);
}

/**
 * The top-level blocks of a stylesheet: `[{ selector, body }]` in file order, comments stripped,
 * nested blocks (`@media …`) skipped whole. Enough for tokens.css; not a CSS parser.
 * @param {string} css
 */
function topLevelBlocks(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  let depth = 0;
  let selector = '';
  let body = '';
  for (const ch of text) {
    if (ch === '{') {
      depth += 1;
      if (depth === 1) continue;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        blocks.push({ selector: selector.trim(), body });
        selector = '';
        body = '';
        continue;
      }
    }
    if (depth === 0) selector += ch;
    else body += ch;
  }
  return blocks;
}

/**
 * One minified line per critical selector, e.g. `:root{--v4-bg:#edeae5;…;color-scheme:light dark}`:
 * the declarations in file order, each value as the canon writes it, whitespace collapsed, no
 * space after a comma. Throws when tokens.css lacks one of the blocks.
 * @param {string} tokensCss
 * @returns {Record<string, string>} selector → line
 */
export function criticalLines(tokensCss) {
  const blocks = topLevelBlocks(tokensCss);
  const lines = {};
  for (const selector of CRITICAL_SELECTORS) {
    const block = blocks.find((b) => b.selector === selector);
    if (!block) throw new Error(`tokens.css has no top-level ${selector} block`);
    const declarations = block.body
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const colon = d.indexOf(':');
        if (colon < 0) throw new Error(`tokens.css: no «:» in «${d}» under ${selector}`);
        const prop = d.slice(0, colon).trim();
        const value = d
          .slice(colon + 1)
          .replace(/\s+/g, ' ')
          .replace(/\s*,\s*/g, ',')
          .trim();
        return `${prop}:${value}`;
      });
    lines[selector] = `${selector}{${declarations.join(';')}}`;
  }
  return lines;
}

/**
 * The page with its critical lines replaced. A line is the one whose trimmed text starts with
 * `<selector>{`; the indentation stays. Exactly one such line per selector, or an error that
 * names the page and the selector.
 * @param {string} html
 * @param {Record<string, string>} lines selector → line, as criticalLines returns
 * @param {string} name the page, for the error
 */
export function replaceCriticalLines(html, lines, name = 'page') {
  const out = html.split('\n');
  for (const selector of CRITICAL_SELECTORS) {
    const prefix = `${selector}{`;
    const at = out.map((l, i) => (l.trimStart().startsWith(prefix) ? i : -1)).filter((i) => i >= 0);
    if (at.length !== 1) {
      throw new Error(`${name}: expected one critical line starting with «${prefix}», found ${at.length}`);
    }
    const indent = out[at[0]].slice(0, out[at[0]].length - out[at[0]].trimStart().length);
    out[at[0]] = indent + lines[selector];
  }
  return out.join('\n');
}

/**
 * What `--check` reports: one line per difference between the manifest and the tree, none when
 * the copy is in sync. `read` answers a repo-relative path with bytes, or null when absent.
 * @param {{ origin: string, root: string, files: Record<string, string> }} manifest
 * @param {(relPath: string) => Uint8Array | null} read
 * @returns {string[]}
 */
export function findings(manifest, read) {
  const out = [];
  for (const [file, expected] of Object.entries(manifest.files)) {
    const rel = path.posix.join(manifest.root, file);
    const bytes = read(rel);
    if (bytes === null) {
      out.push(`${file}: missing under ${manifest.root}/ (run --write)`);
      continue;
    }
    const actual = shortHash(bytes);
    if (actual !== expected)
      out.push(`${file}: manifest ${expected}, file ${actual} (run --write, or fix the manifest)`);
  }
  const tokens = read(path.posix.join(manifest.root, 'ds/v1/tokens.css'));
  if (tokens === null) return out;
  let lines;
  try {
    lines = criticalLines(Buffer.from(tokens).toString('utf8'));
  } catch (err) {
    out.push(err instanceof Error ? err.message : String(err));
    return out;
  }
  for (const page of CRITICAL_PAGES) {
    const html = read(page);
    if (html === null) {
      out.push(`${page}: missing`);
      continue;
    }
    const text = Buffer.from(html).toString('utf8');
    for (const selector of CRITICAL_SELECTORS) {
      if (!text.split('\n').some((l) => l.trim() === lines[selector])) {
        out.push(`${page}: the critical ${selector} line differs from ds/v1/tokens.css (run --write)`);
      }
    }
  }
  return out;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'ds.json');

function readManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  for (const key of ['origin', 'root', 'files']) {
    if (!(key in manifest)) throw new Error(`ds.json: no «${key}»`);
  }
  return manifest;
}

/** @param {string} relPath */
function readRepoFile(relPath) {
  const file = path.join(ROOT, relPath);
  return existsSync(file) ? readFileSync(file) : null;
}

function check() {
  const problems = findings(readManifest(), readRepoFile);
  for (const line of problems) console.error(line);
  if (problems.length) {
    console.error(`ds-sync: ${problems.length} difference(s) between ds.json and the tree`);
    return 1;
  }
  console.log('ds-sync: the vendored design system matches ds.json');
  return 0;
}

/**
 * @param {string} url
 * @returns {Promise<Uint8Array>}
 */
async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'error' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function write() {
  const manifest = readManifest();
  const changed = [];
  for (const [file, before] of Object.entries(manifest.files)) {
    const bytes = await download(`${manifest.origin}/${file}`);
    const after = shortHash(bytes);
    const target = path.join(ROOT, manifest.root, file);
    const same = existsSync(target) && shortHash(readFileSync(target)) === after;
    if (!same) {
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
    if (after === before && same) {
      console.log(`${file}: ${before} (unchanged)`);
    } else {
      console.log(`${file}: ${before} → ${after}`);
      changed.push(`${file} ${before}→${after}`);
      manifest.files[file] = after;
    }
  }
  // The critical lines follow tokens.css; they are named in the summary only when no file
  // moved (a stale hand-minified line), otherwise they are a consequence of the file above.
  const lines = criticalLines(readFileSync(path.join(ROOT, manifest.root, 'ds/v1/tokens.css'), 'utf8'));
  const pages = [];
  for (const page of CRITICAL_PAGES) {
    const file = path.join(ROOT, page);
    const html = readFileSync(file, 'utf8');
    const next = replaceCriticalLines(html, lines, page);
    if (next !== html) {
      writeFileSync(file, next);
      console.log(`${page}: critical token lines regenerated`);
      pages.push(`${page} critical lines`);
    }
  }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  const summary = changed.length ? changed : pages;
  console.log(`summary: ${summary.length ? summary.join(', ') : 'no change'}`);
  return 0;
}

async function main() {
  const mode = process.argv[2];
  if (mode === '--check') return check();
  if (mode === '--write') return write();
  console.error('usage: node scripts/ds-sync.mjs --check | --write');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }
  );
}
