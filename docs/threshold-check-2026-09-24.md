# Thresholds against real files — measured 2026-09-24

The audit of 2026-09-15 and the Craft overview of 2026-09-19 both said the same thing: the
«Проверка кадра» thresholds, the screenshot score and the JPEG-table rule were calibrated on a
handful of synthetic fixtures, and the rule «an iPhone in EXIF with libjpeg tables means the file
was saved by something else» had never met a real iPhone JPEG. This is the first run over real
files. The set is what this Mac happened to hold; it is not the 30–50-file corpus the plan asks
for, and it holds no Android original at all.

## Set

Copied into git-ignored `public/test/bench/` with `mdfind` (Spotlight: `public.jpeg` with an
acquisition make; `kMDItemIsScreenCapture`), then served by the dev server and measured in
Chromium through the same modules the page uses.

| Group | Files | What they are |
|---|---|---|
| camera | 76 | 65 iPhone originals (X, 11, 12 mini, 13, 13 Pro, 15 Pro Max), 9 Sony ILCE-7M3, 1 Canon EOS 90D via Lightroom, 1 Canon MF4400 scan |
| messenger | 43 | Telegram `photo_*.jpeg`: 24 photographs from 2022 (960×1280), 19 files from 2026 that are decks and app screenshots sent through Telegram, one `tg_image` |
| screens | 16 | 12 Mac captures (CleanShot / screencapture, two of them full-page captures 33–38 thousand px tall), 4 phone-size PNGs |

## JPEG tables (`jpegQuant.judgeCompression`)

`scripts`-free run: `parseJpegSignals` over the first 4 MB of every file plus exifr for `Make`.

| Group | `custom` | IJG exact | Conflicts raised |
|---|---|---|---|
| iPhone originals (65) | 64 | 1 (quality 100, 4:4:4) | 1 — the quality-100 file |
| Sony / Canon (11) | 10 | 1 (the scanner, IJG 70) | 0 |
| Telegram 2022 (24) | 24 | 0 | 0 |
| Telegram 2026 (19) | 1 | 18 (IJG 72, 75, 80; two at 100) | 0 |

**Result.** Every iPhone camera original writes its own tables, so the Apple rule holds on real
files. The one conflict was `IMG_0732.JPG` (iPhone 13 Pro, iOS 16.0.2, 1696×2428 — a re-saved,
downscaled copy) at exact IJG quality 100: at 100 the IJG table is all ones, which every encoder
writes at its top setting, so the match is not evidence of libjpeg. **Fixed:** the Apple
conflict is no longer raised at quality 100 (`jpegQuant.ts`, test added).

**Side finding.** Telegram writes IJG tables at 72–80: 18 of 19 recent files are exact IJG 72,
75 or 80. That is the «messenger by the tables, not by the file name» idea from the Craft
backlog, measured: the tables alone name the messenger. Not implemented here.

**Not verified.** No Samsung, Pixel or Xiaomi original on this machine, so the `android-low`
rule (a libjpeg quality under 90 on those makers) is still unmeasured.

## Screenshot score: `measureFlatness`

The share of pixels equal to their right-hand neighbour, at ≤ 1024 px, as `useFrameStats`
computes it.

| Group | Min | Median | Max | Above 0.55 | Above 0.50 |
|---|---|---|---|---|---|
| iPhone originals | 0.012 | 0.03 | 0.144 | 0 | 0 |
| Sony / Canon | 0.035 | 0.13 | 0.20 | 0 | 0 |
| the two oddities | 0.345 (scan), 0.451 (480 px iCloud thumbnail) | | | 0 | 0 |
| Telegram 2022 photographs | 0.134 | 0.30 | 0.408 | 0 | 0 |
| Telegram 2026 screenshots / decks | 0.509 | 0.70 | 0.768 | 12 of 13 | 13 of 13 |
| screens | 0.394 | 0.75 | 0.932 | 12 of 16 | 13 of 16 |

**Result.** `FLAT_SCREENSHOT` was 0.55: it flagged no photograph and missed four real
screenshots — the two full-page captures (0.394, 0.427: mostly anti-aliased text), an app home
screen full of pictures (0.438) and a Mac capture with a photo in it (0.505) — plus one Telegram
screenshot at 0.509. **Changed to 0.50:** two more caught, still no photograph over the bar
(the nearest is the 480 px thumbnail at 0.451). The remaining misses at 0.39–0.44 fall in the
existing middle band (0.30–0.50 earns one point instead of three).

`FLAT_PHOTO` = 0.12 («below this the picture has sensor noise everywhere»): every iPhone original
is under it; the Sony files sit at 0.08–0.18, so five of nine get no «photo-pixels» point — their
camera EXIF carries them anyway. Left as is.

## «Проверка кадра» (`runFrameChecks`)

26 camera originals (every third), 10 Telegram files, all 16 screens. 1.4–2.7 s per camera JPEG
in Chromium on this Mac.

| Group | ELA `spots` | Noise `spots` | Ghosts |
|---|---|---|---|
| camera originals (26) | 0 of 26 (ratio 1.4–3.8; one file with 8 hot blocks, under the bar) | 1 of 26 — the quality-100 re-save above (13 % of blocks); the rest 0–1.9 % | 26 × `insensitive` (quality 94–96, above `GHOST_BLIND_QUALITY`), as designed |
| Telegram 2026, IJG 75 (6) | 0 | 4 of 6 (6–18 %) — they are screenshots, not photographs | 6 × `single` at 74: the method sees Telegram's save |
| Telegram 2022 photographs (2) | 0 | 0 | one `insensitive` (custom 94), one `double` (dip at 72 under a save at 94) |
| screens (16) | 3 of 16 (UI edges — the documented blind spot) | 2 app screens with photographs (11 %, 27 %); the rest flat or uniform | `not-applicable` / `unreliable`, as designed |

**Result.** On untouched camera files the automatic reading stays clean: no false «spots» on
ELA, none on the noise map except a file that really was re-saved, and the ghost curve declines
to answer above quality 85 exactly as the card says. Nothing to change. What the run does not
say: whether a realistic paste in one of these files would be caught — the 2026-09-19 bench
already answered that (no), and no labelled positives were added here.

## What changed in code

- `jpegQuant.ts`: no Apple conflict at quality 100.
- `screenshot.ts`: `FLAT_SCREENSHOT` 0.55 → 0.50.

## Still open

- Android originals (Samsung, Pixel, Xiaomi) for the `android-low` rule.
- A labelled set with real edits (Clean Up, Magic Editor, a paste) for the frame checks.
- iOS Safari: the pixelate fallback and the 16 MP cap on a real iPhone.
