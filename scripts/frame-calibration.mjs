#!/usr/bin/env node
/**
 * Calibration bench for the «Проверка кадра» pixel checks.
 *
 * It runs the page's own code — `frameBlockData` from `src/utils/frameChecks.ts`, imported
 * live from the dev server, so the numbers come from the real canvas decode and the real
 * block statistics, not from a re-implementation — over a folder of pictures and prints the
 * per-image grain statistics a detector would have to separate.
 *
 *   npm run dev                                  # in another terminal
 *   node scripts/frame-calibration.mjs <dir> [--json out.json]
 *
 * Layout: `<dir>/edited/*` and `<dir>/untouched/*` label the two classes (anything else in
 * `<dir>` is listed without a label). With both classes present the run ends with a
 * separability table: the best threshold on each statistic and how many pictures it would
 * mislabel. That table is the thing to look at before writing any «here it was erased»
 * verdict — see `docs/frame-calibration-2026-09-19.md` for the first run and its result.
 *
 * Uses playwright-core with the browser already on the machine (Chrome by default,
 * CALIBRATION_BROWSER=/path/to/chromium to point elsewhere), like `scripts/smoke.mjs`.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

/* global createImageBitmap */ // the `page.evaluate` callback below runs inside the browser page

const url = process.env.SMOKE_URL ?? 'http://localhost:5173';
const executablePath = process.env.CALIBRATION_BROWSER ?? null;
const PICTURES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp']);

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonPath = jsonAt >= 0 ? args[jsonAt + 1] : null;
const roots = args.filter((arg, index) => !arg.startsWith('--') && (jsonAt < 0 || index !== jsonAt + 1));
if (roots.length === 0) {
  console.error('usage: node scripts/frame-calibration.mjs <dir> [--json out.json]');
  process.exit(2);
}

/** Every picture under `dir`, labelled by the `edited` / `untouched` folder it sits in. */
function collect(dir, label = null) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      const nested = entry === 'edited' || entry === 'untouched' ? entry : label;
      out.push(...collect(path, nested));
      continue;
    }
    if (PICTURES.has(extname(entry).toLowerCase())) out.push({ path, label });
  }
  return out;
}

const files = roots.flatMap((root) => (statSync(root).isDirectory() ? collect(root) : [{ path: root, label: null }]));
if (files.length === 0) {
  console.error('no pictures found');
  process.exit(2);
}

/**
 * Per-image statistics, computed in the page from `frameBlockData`:
 * the grain of every block against the 30th percentile of its texture group (the same
 * reference `judgeNoise` uses), then the connected regions of blocks that fall below it.
 */
async function measure(page, dataUrl) {
  return page.evaluate(async (src) => {
    const { frameBlockData } = await import('/src/utils/frameChecks.ts');
    const blob = await (await fetch(src)).blob();
    const bitmap = await createImageBitmap(blob);
    let data;
    try {
      data = await frameBlockData(bitmap);
    } finally {
      bitmap.close();
    }
    const pct = (sorted, p) =>
      sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))];
    const { noise, noiseTexture, noiseGrid } = data;
    // `judgeNoise`'s own gate and reference, kept in step with it by hand: flat blocks, blocks
    // that are all edges and blocks JPEG flattened carry no grain to compare.
    const usable = noise.map((value, i) => noiseTexture[i] >= 1.5 && noiseTexture[i] <= 60 && value >= 0.05);
    const order = noiseTexture.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const groups = new Array(noise.length).fill(0);
    order.forEach(({ index }, rank) => {
      groups[index] = Math.min(5, Math.floor((rank / Math.max(1, noise.length)) * 6));
    });
    const refs = Array.from({ length: 6 }, (_, g) =>
      Math.max(
        pct(
          noise.filter((_, i) => usable[i] && groups[i] === g).sort((a, b) => a - b),
          0.3
        ),
        0.01
      )
    );
    const ratios = noise.map((value, i) => value / refs[groups[i]]);
    const { cols, rows } = noiseGrid;
    const regions = [];
    const seen = new Uint8Array(noise.length);
    for (let i = 0; i < noise.length; i++) {
      if (seen[i] || !usable[i] || ratios[i] >= 0.9) continue;
      const stack = [i];
      seen[i] = 1;
      const members = [];
      while (stack.length > 0) {
        const b = stack.pop();
        members.push(b);
        const bx = b % cols;
        const by = Math.floor(b / cols);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ]) {
          const nx = bx + dx;
          const ny = by + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nb = ny * cols + nx;
          if (seen[nb] || !usable[nb] || ratios[nb] >= 0.9) continue;
          seen[nb] = 1;
          stack.push(nb);
        }
      }
      regions.push({
        size: members.length,
        median: pct(
          members.map((b) => ratios[b]).sort((a, b) => a - b),
          0.5
        )
      });
    }
    regions.sort((a, b) => b.size - a.size);
    const used = ratios.filter((_, i) => usable[i]).sort((a, b) => a - b);
    return {
      width: bitmap.width,
      height: bitmap.height,
      blocks: noise.length,
      judged: used.length,
      ratioP10: pct(used, 0.1),
      ratioMedian: pct(used, 0.5),
      shareBelow05: used.filter((r) => r < 0.5).length / Math.max(1, used.length),
      biggestRegion: regions[0]?.size ?? 0,
      biggestRegionMedian: regions[0]?.median ?? 1,
      deepestRegion: regions.reduce((best, r) => (r.size >= 6 && r.median < best ? r.median : best), 1)
    };
  }, dataUrl);
}

/** Best single threshold on one statistic and how many pictures it still gets wrong. */
function separability(rows, key, direction) {
  const edited = rows.filter((row) => row.label === 'edited').map((row) => row.stats[key]);
  const untouched = rows.filter((row) => row.label === 'untouched').map((row) => row.stats[key]);
  if (edited.length === 0 || untouched.length === 0) return null;
  const candidates = [...edited, ...untouched].sort((a, b) => a - b);
  let best = null;
  for (const threshold of candidates) {
    const hit = (value) => (direction === 'above' ? value >= threshold : value <= threshold);
    const errors = edited.filter((value) => !hit(value)).length + untouched.filter((value) => hit(value)).length;
    if (!best || errors < best.errors) best = { threshold, errors };
  }
  return { ...best, total: edited.length + untouched.length };
}

const browser = await chromium.launch(
  executablePath ? { executablePath, args: ['--no-sandbox'] } : { channel: 'chrome' }
);
const rows = [];
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(120_000);
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false,"error":"upstream-failed"}' })
  );
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  for (const file of files) {
    const bytes = readFileSync(file.path);
    const mime = extname(file.path).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
    const stats = await measure(page, `data:${mime};base64,${bytes.toString('base64')}`);
    rows.push({ ...file, stats });
    const name = file.path.split('/').pop().slice(0, 28).padEnd(28);
    console.log(
      `${name} ${String(file.label ?? '—').padEnd(9)} judged=${String(stats.judged).padStart(5)}` +
        `  ratio p10=${stats.ratioP10.toFixed(2)} median=${stats.ratioMedian.toFixed(2)}` +
        `  below0.5=${(100 * stats.shareBelow05).toFixed(1)}%` +
        `  biggest deficit region=${String(stats.biggestRegion).padStart(3)}@${stats.biggestRegionMedian.toFixed(2)}`
    );
  }
} finally {
  await browser.close();
}

const checks = [
  ['biggestRegion', 'above'],
  ['shareBelow05', 'above'],
  ['ratioP10', 'below'],
  ['deepestRegion', 'below']
];
const table = checks.map(([key, direction]) => [key, separability(rows, key, direction)]).filter(([, value]) => value);
if (table.length > 0) {
  console.log('\nSeparability (best single threshold, edited vs untouched):');
  for (const [key, value] of table) {
    console.log(`  ${key.padEnd(20)} threshold ${value.threshold.toFixed(3)} → ${value.errors}/${value.total} misread`);
  }
  console.log('A statistic that misreads a third of the set cannot carry a verdict; it can only mark the map.');
}

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify(rows, null, 2));
  console.log(`\nraw numbers → ${jsonPath}`);
}
