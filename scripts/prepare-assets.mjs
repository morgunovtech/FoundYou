#!/usr/bin/env node
/**
 * prepare-assets.mjs — self-hosts the heavy runtime assets so the app never
 * loads anything from third-party CDNs at run time:
 *
 *   public/ocr/                tesseract.js worker + tesseract.js-core wasm builds
 *   public/ocr/lang/           rus / eng traineddata (LSTM "4.0.0_best_int" variant)
 *   public/mediapipe/wasm/     @mediapipe/tasks-vision runtime (SIMD and no-SIMD loader + wasm)
 *   public/mediapipe/models/   BlazeFace short-range (faces) + EfficientDet-Lite2 (COCO objects)
 *
 * Idempotent: a copy is skipped when the destination already has the source's
 * size; a download is skipped when the destination exists with the pinned size
 * and MD5. Fails loudly on missing sources, HTTP errors, or a size/hash
 * mismatch. Node >= 20, ESM, no deps.
 *
 * Wired into `npm run build` so Cloudflare Pages regenerates the assets on
 * every deploy — nothing produced here is committed (see .gitignore).
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIN_NODE_MAJOR = 20;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE_MODULES = path.join(ROOT, 'node_modules');
const PUBLIC_DIR = path.join(ROOT, 'public');

const OCR_DIR = path.join(PUBLIC_DIR, 'ocr');
const OCR_LANG_DIR = path.join(OCR_DIR, 'lang');

const MEDIAPIPE_DIR = path.join(PUBLIC_DIR, 'mediapipe');
const MEDIAPIPE_WASM_DIR = path.join(MEDIAPIPE_DIR, 'wasm');
const MEDIAPIPE_MODEL_DIR = path.join(MEDIAPIPE_DIR, 'models');
const C2PA_DIR = path.join(PUBLIC_DIR, 'c2pa');

/** Output of the previous detection stack (tfjs COCO-SSD); removed so stale weights never ship. */
const STALE_OUTPUT_DIRS = [path.join(PUBLIC_DIR, 'models')];

/** Languages requested by src/hooks/useOCR.ts — createWorker('rus+eng', OEM.LSTM_ONLY). */
const OCR_LANGS = ['rus', 'eng'];

/**
 * tesseract.js v7 fetches `${langPath}/${lang}.traineddata.gz`. With OEM.LSTM_ONLY and
 * no explicit langPath it would default to `@tesseract.js-data/${lang}/4.0.0_best_int`
 * on jsDelivr (node_modules/tesseract.js/src/worker-script/index.js), so we mirror
 * exactly that variant from the npm data packages.
 */
const OCR_LANG_VARIANT = '4.0.0_best_int';

/**
 * The browser worker (node_modules/tesseract.js/src/worker-script/browser/getCore.js)
 * treats `corePath` as a directory and picks one of these by SIMD support + OEM:
 *   tesseract-core[-relaxedsimd|-simd][-lstm].wasm.js
 * The `.wasm.js` builds embed the wasm binary as base64 (Emscripten SINGLE_FILE), so
 * the standalone `.wasm` files are never requested. Set PREPARE_ASSETS_RAW_WASM=1 to
 * copy them anyway (+~19 MB).
 */
const CORE_FILE_PATTERN = /^tesseract-core(-relaxedsimd|-simd)?-lstm\.wasm\.js$/; // OEM 1 (LSTM only) never loads the legacy-engine builds
const RAW_WASM_PATTERN = /^tesseract-core.*\.wasm$/;
const INCLUDE_RAW_WASM = process.env.PREPARE_ASSETS_RAW_WASM === '1';

/**
 * `FilesetResolver.forVisionTasks(basePath)` (node_modules/@mediapipe/tasks-vision/vision_bundle.mjs)
 * requests `${basePath}/vision_wasm_internal.js` + `.wasm`, or the `_nosimd_` pair when the
 * browser lacks WebAssembly SIMD. The `vision_wasm_module_*` builds are only used with the
 * `useModule = true` argument, which src/hooks/useImageAnalysis.ts never passes.
 */
const MEDIAPIPE_WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm'
];

/**
 * Model files from the MediaPipe model bucket, pinned to version directory `1` (byte-identical
 * to `latest` as of 2026-09-15) and verified by size + MD5 (GCS exposes the MD5 as the ETag /
 * `x-goog-hash`). To move to a newer revision, bump the URL, size and hash here deliberately;
 * the runtime itself only ever fetches from /mediapipe/models on the app's own origin.
 */
const MEDIAPIPE_MODELS_BASE_URL = 'https://storage.googleapis.com/mediapipe-models/';
const MEDIAPIPE_MODELS = [
  {
    file: 'blaze_face_short_range.tflite',
    url: `${MEDIAPIPE_MODELS_BASE_URL}face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`,
    size: 229_746,
    md5: 'a3dd6ec31725290770b97cec0cbf94c9'
  },
  {
    // The far pass: BlazeFace full range sees faces that are small in the frame (a group photo),
    // which the short-range model misses entirely; the short-range one owns the close-up it
    // cannot see. Both are loaded, see `useImageAnalysis`.
    file: 'blaze_face_full_range.tflite',
    url: `${MEDIAPIPE_MODELS_BASE_URL}face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite`,
    size: 1_083_786,
    md5: '5de376fcc855273c5c720766d36523a0'
  },
  {
    // Lite2 (448×448 input) over Lite0 (320×320): noticeably better on small and partly hidden
    // objects such as a dog behind two people, at 12 MB instead of 7 MB and a slower pass.
    file: 'efficientdet_lite2.tflite',
    url: `${MEDIAPIPE_MODELS_BASE_URL}object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite`,
    size: 12_138_859,
    md5: '3c5d155842c308a5f6d07bf5513d3c12'
  }
];

/* ── helpers ───────────────────────────────────────────────── */

const rel = (p) => path.relative(ROOT, p);

function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${n} B`;
}

/** Size of a regular file, or -1 when it does not exist. */
async function fileSize(p) {
  try {
    const s = await stat(p);
    return s.isFile() ? s.size : -1;
  } catch {
    return -1;
  }
}

function md5(buf) {
  return createHash('md5').update(buf).digest('hex');
}

async function copyIfNeeded(src, dest, summary) {
  const srcSize = await fileSize(src);
  if (srcSize < 0) {
    throw new Error(`Missing source ${rel(src)} — run \`npm install\` first`);
  }
  if ((await fileSize(dest)) === srcSize) {
    summary.push({ file: rel(dest), size: srcSize, action: 'kept' });
    return;
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(src, dest);
  summary.push({ file: rel(dest), size: srcSize, action: 'copied' });
}

/**
 * Downloads `url` to `dest` unless a file with the expected size and MD5 is already there.
 * A wrong size or hash (truncated earlier run, upstream change) is re-fetched once and, if
 * still wrong, aborts the build — better than shipping a model that will not load.
 */
async function downloadIfNeeded({ url, size, md5: expectedMd5 }, dest, summary) {
  if ((await fileSize(dest)) === size && md5(await readFile(dest)) === expectedMd5) {
    summary.push({ file: rel(dest), size, action: 'kept' });
    return;
  }
  if ((await fileSize(dest)) >= 0) {
    console.warn(`[prepare-assets] ${rel(dest)} has an unexpected size or hash; re-downloading`);
    await rm(dest, { force: true });
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} while fetching ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength !== size) {
    throw new Error(`${url}: expected ${size} bytes, got ${buf.byteLength} — pinned model changed upstream?`);
  }
  const actualMd5 = md5(buf);
  if (actualMd5 !== expectedMd5) {
    throw new Error(`${url}: MD5 ${actualMd5} does not match pinned ${expectedMd5}`);
  }
  // Write to a temp name and rename so an interrupted run never leaves a
  // truncated file behind under the final name.
  const tmp = `${dest}.part`;
  await writeFile(tmp, buf);
  await rename(tmp, dest);
  summary.push({ file: rel(dest), size: buf.byteLength, action: 'downloaded' });
}

/* ── tesseract.js runtime ──────────────────────────────────── */

async function prepareTesseract(summary) {
  await copyIfNeeded(
    path.join(NODE_MODULES, 'tesseract.js', 'dist', 'worker.min.js'),
    path.join(OCR_DIR, 'worker.min.js'),
    summary
  );

  const coreDir = path.join(NODE_MODULES, 'tesseract.js-core');
  const entries = await readdir(coreDir).catch(() => {
    throw new Error(`Missing ${rel(coreDir)} — run \`npm install\` first`);
  });
  const coreFiles = entries
    .filter((f) => CORE_FILE_PATTERN.test(f) || (INCLUDE_RAW_WASM && RAW_WASM_PATTERN.test(f)))
    .sort();
  if (coreFiles.length === 0) {
    throw new Error(`No tesseract-core*.wasm.js files found in ${rel(coreDir)}`);
  }
  for (const f of coreFiles) {
    await copyIfNeeded(path.join(coreDir, f), path.join(OCR_DIR, f), summary);
  }

  for (const lang of OCR_LANGS) {
    const fileName = `${lang}.traineddata.gz`;
    await copyIfNeeded(
      path.join(NODE_MODULES, '@tesseract.js-data', lang, OCR_LANG_VARIANT, fileName),
      path.join(OCR_LANG_DIR, fileName),
      summary
    );
  }
}

/* ── MediaPipe Tasks Vision runtime + models ───────────────── */

async function prepareMediaPipe(summary) {
  const wasmSrcDir = path.join(NODE_MODULES, '@mediapipe', 'tasks-vision', 'wasm');
  for (const f of MEDIAPIPE_WASM_FILES) {
    await copyIfNeeded(path.join(wasmSrcDir, f), path.join(MEDIAPIPE_WASM_DIR, f), summary);
  }
  await Promise.all(
    MEDIAPIPE_MODELS.map((model) => downloadIfNeeded(model, path.join(MEDIAPIPE_MODEL_DIR, model.file), summary))
  );
}

/* ── Content Credentials (c2pa) toolkit: worker + WASM ─────── */

async function prepareC2pa(summary) {
  const dist = path.join(NODE_MODULES, 'c2pa', 'dist');
  await copyIfNeeded(path.join(dist, 'c2pa.worker.min.js'), path.join(C2PA_DIR, 'c2pa.worker.min.js'), summary);
  await copyIfNeeded(path.join(dist, 'assets', 'wasm', 'toolkit_bg.wasm'), path.join(C2PA_DIR, 'toolkit_bg.wasm'), summary);
}

/* ── main ──────────────────────────────────────────────────── */

async function removeStaleOutputs() {
  for (const dir of STALE_OUTPUT_DIRS) {
    try {
      await stat(dir);
    } catch {
      continue;
    }
    await rm(dir, { recursive: true, force: true });
    console.log(`[prepare-assets] removed stale ${rel(dir)}/`);
  }
}

function printSummary(summary) {
  const byDir = new Map();
  for (const entry of summary) {
    const dir = path.dirname(entry.file);
    const acc = byDir.get(dir) ?? { files: 0, bytes: 0 };
    acc.files += 1;
    acc.bytes += entry.size;
    byDir.set(dir, acc);
  }
  const width = Math.max(...summary.map((s) => s.file.length));
  console.log('\n[prepare-assets] files:');
  for (const entry of [...summary].sort((a, b) => a.file.localeCompare(b.file))) {
    console.log(`  ${entry.file.padEnd(width)}  ${formatBytes(entry.size).padStart(10)}  ${entry.action}`);
  }
  console.log('\n[prepare-assets] totals:');
  let total = 0;
  for (const [dir, acc] of [...byDir.entries()].sort()) {
    total += acc.bytes;
    console.log(`  ${dir.padEnd(width)}  ${formatBytes(acc.bytes).padStart(10)}  (${acc.files} files)`);
  }
  console.log(`  ${'all'.padEnd(width)}  ${formatBytes(total).padStart(10)}  (${summary.length} files)`);
  const counts = summary.reduce((acc, s) => ({ ...acc, [s.action]: (acc[s.action] ?? 0) + 1 }), {});
  console.log(`\n[prepare-assets] done: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}\n`);
}

async function main() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    throw new Error(`Node >= ${MIN_NODE_MAJOR} is required (running ${process.versions.node})`);
  }
  await removeStaleOutputs();
  const summary = [];
  await Promise.all([prepareTesseract(summary), prepareMediaPipe(summary), prepareC2pa(summary)]);
  printSummary(summary);
}

main().catch((err) => {
  console.error(`\n[prepare-assets] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
