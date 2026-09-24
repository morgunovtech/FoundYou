/**
 * The installed versions of the packages whose files are served as runtime assets. Read from
 * `node_modules/<pkg>/package.json`, never from the ranges in our own `package.json`, because the
 * path has to name the bytes actually copied. Used by `prepare-assets.mjs` (where to write) and
 * `vite.config.ts` (`__ASSET_VERSIONS__`, where the page asks for them).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PACKAGES = {
  ocr: 'tesseract.js',
  mediapipe: '@mediapipe/tasks-vision',
  c2pa: 'c2pa',
  zxing: 'zxing-wasm'
};

/** @param {string} root project root (the directory holding node_modules) */
export function readVersions(root) {
  const versions = {};
  for (const [key, pkg] of Object.entries(PACKAGES)) {
    const file = path.join(root, 'node_modules', pkg, 'package.json');
    let version;
    try {
      version = JSON.parse(readFileSync(file, 'utf8')).version;
    } catch (err) {
      throw new Error(`Cannot read ${pkg}'s version from ${file} — run \`npm install\` first`, { cause: err });
    }
    if (typeof version !== 'string' || !/^[0-9A-Za-z.+-]+$/.test(version)) {
      throw new Error(`${pkg}: unexpected version «${version}»`);
    }
    versions[key] = version;
  }
  return versions;
}
