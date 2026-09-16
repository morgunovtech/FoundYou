#!/usr/bin/env node
/**
 * Smoke test of the whole flow in a real browser: the hero renders, a JPEG with EXIF (drawn on
 * a canvas, then extended by the fixture script) goes through the file input, the three
 * sections appear, the facts are gathered, the «metadata only» export produces a file the
 * page verifies as «0 fields left» and that carries neither an Exif segment nor the Samsung
 * trailer the fixture had.
 *
 * Runs against an already running server (the Vite dev server by default):
 *
 *   npm run dev            # in another terminal
 *   npm run smoke          # SMOKE_URL=http://localhost:5173 by default
 *
 * Uses playwright-core with the Chrome already installed on the machine (channel "chrome"), so
 * nothing is downloaded. Every /api/* request is answered locally with an upstream error, so
 * the run needs no network and sends nothing anywhere.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

/* global document */ // the `page.evaluate` callback below runs inside the browser page

const url = process.env.SMOKE_URL ?? 'http://localhost:5173';
const here = fileURLToPath(new URL('.', import.meta.url));
const timeout = Number(process.env.SMOKE_TIMEOUT_MS ?? 120_000);

function fail(message) {
  console.error(`SMOKE FAIL: ${message}`);
  process.exit(1);
}

/** A 640×480 JPEG drawn in the browser (a sky, a wall, a sign with text for the OCR pass). */
async function drawBaseJpeg(page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    ctx.fillStyle = '#9db9d8';
    ctx.fillRect(0, 0, 640, 240);
    ctx.fillStyle = '#b08a5a';
    ctx.fillRect(0, 240, 640, 240);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(160, 300, 320, 90);
    ctx.fillStyle = '#111111';
    ctx.font = 'bold 48px sans-serif';
    ctx.fillText('AMIR TEMUR 12', 180, 362);
    return canvas.toDataURL('image/jpeg', 0.9);
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

function buildFixture(baseJpeg) {
  const dir = mkdtempSync(join(tmpdir(), 'found-you-smoke-'));
  const base = join(dir, 'base.jpg');
  const out = join(dir, 'fixture.jpg');
  writeFileSync(base, baseJpeg);
  const args = [
    join(here, 'make-exif-fixture.mjs'),
    base,
    out,
    ...['--lat', '41.36123', '--lon', '69.92395', '--heading', '312', '--speed', '0.4'],
    ...['--offset', '+05:00', '--gps-time', '08:20:03', '--make', 'Apple', '--model', 'iPhone 15 Pro'],
    ...['--software', '17.6', '--samsung-mcc', '434']
  ];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  if (result.status !== 0) fail(`fixture script: ${result.stderr || result.stdout}`);
  return readFileSync(out);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  page.setDefaultTimeout(timeout);
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  // No upstream calls: every Function answers as if the upstream failed, the UI shows «unavailable».
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'upstream-failed' }) })
  );

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#hero-title').waitFor();
  const fixture = buildFixture(await drawBaseJpeg(page));

  await page.locator('input[type="file"]').setInputFiles({ name: 'IMG_0042.jpg', mimeType: 'image/jpeg', buffer: fixture });
  await page.locator('#sec-scene').waitFor();
  await page.locator('#sec-story').waitFor();
  await page.locator('#sec-cleanup').waitFor();

  // The facts arrive once detection has settled: the «Откуда файл» card names the device from EXIF.
  await page.getByText('iPhone 15 Pro', { exact: false }).first().waitFor();

  // «Metadata only» keeps the picture bytes; the export must still verify as clean.
  await page.locator('[data-smoke="metadata-only"]').click();
  const download = page.waitForEvent('download');
  await page.locator('[data-smoke="download"]').click();
  const file = await download;
  const path = await file.path();
  if (!path) fail('no download path');
  const bytes = readFileSync(path);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('the download is not a JPEG');
  if (bytes.includes(Buffer.from('Exif\0\0', 'latin1'))) fail('an Exif segment survived the export');
  if (bytes.includes(Buffer.from('SEFT', 'latin1'))) fail('the Samsung trailer survived the export');
  // The lossless path keeps the scan bytes: the export ends with the same entropy data as the fixture.
  const tail = fixture.subarray(fixture.lastIndexOf(Buffer.from([0xff, 0xd9])) - 64, fixture.lastIndexOf(Buffer.from([0xff, 0xd9])) + 2);
  if (!bytes.includes(tail)) fail('the picture bytes were re-encoded on the metadata-only path');

  const verify = page.locator('.fy-verify');
  await verify.waitFor();
  const text = (await verify.textContent()) ?? '';
  if (!/осталось 0|0 left|0 ta|0 qoldi/.test(text)) fail(`unexpected verification text: ${text}`);

  if (errors.length > 0) fail(`page errors: ${errors.join('; ')}`);
  console.log(`SMOKE PASS: ${bytes.length} bytes exported; "${text.trim()}"`);
} finally {
  await browser.close();
}
