# Can «Проверка кадра» catch an on-device generative edit? — measured 2026-09-19

Short answer: **no, and not by tuning thresholds.** Three variants of a grain-deficit detector
were measured against the pictures at hand; none separates an erased patch from the smooth
places an ordinary photograph has anyway. This file records the numbers so the next attempt
starts from them instead of from intuition.

## Why the question

A photo edited with the iPhone's built-in Clean Up (a car removed) passed all three checks
clean: the error map read `uniform`, the compression history found no dips, the noise map read
`uniform`. The cause is structural, not a threshold: the three checks look for a region
compressed _differently_ from the rest of the frame, and an on-device generative editor
repaints and re-compresses the whole frame at once, so no such region exists.

The measurable trace it does leave is the other way round: the repainted patch is **smoother**
than its surroundings. On the sample, the patch sat at ~0.83 of the grain of blocks with the
same texture while the rest of the frame sat at ~1.13 — a real, consistent shift. The question
was whether that shift can carry a verdict.

## Bench

`scripts/frame-calibration.mjs`, run against the dev server. It imports `frameBlockData` from
`src/utils/frameChecks.ts` live, so the numbers come from the page's own canvas decode and the
page's own block statistics — not from a re-implementation that can drift. Per block it takes
the grain against the 30th percentile of its texture group (the reference `judgeNoise` uses),
then the connected regions of blocks below it.

```bash
npm run dev
node scripts/frame-calibration.mjs <dir>     # <dir>/edited/*, <dir>/untouched/*
```

## Set

Eight pictures, and this is the weakest part of the result:

- one real positive — the Clean Up photo itself;
- three synthetic positives — a box-blurred patch (160, 320, 480 px) in an untouched photo of
  the same scene, re-encoded at quality 92, i.e. _cruder_ than what Clean Up produces;
- four negatives — the untouched original and re-encodes of it at quality 92 and 85.

Every source had already been through one re-encode by the transport that delivered it, so
some grain was gone before the bench saw it. That applies to positives and negatives alike.

## Variant 1 — deficit against the texture group (the shipped reference)

| picture       | class     | judged | grain p10 | share < 0.5 | biggest deficit region |
| ------------- | --------- | ------ | --------- | ----------- | ---------------------- |
| blur 160 px   | edited    | 618    | 0.82      | 3.2 %       | 28 blocks @ 0.69       |
| blur 320 px   | edited    | 618    | 0.82      | 3.1 %       | 18 @ 0.77              |
| blur 480 px   | edited    | 626    | 0.79      | 2.9 %       | 28 @ 0.72              |
| real Clean Up | edited    | 678    | 0.86      | 2.5 %       | 31 @ 0.74              |
| original, q85 | untouched | 615    | 0.81      | 4.2 %       | 17 @ 0.73              |
| original, q92 | untouched | 618    | 0.80      | 3.2 %       | 29 @ 0.66              |
| original      | untouched | 612    | 0.80      | 4.1 %       | 30 @ 0.67              |

Best single threshold on any of these statistics misreads 2 of 8 pictures. The untouched
original carries a deficit region of 30 blocks at 0.67 — larger and deeper than the real
edited photo's 31 @ 0.74. The share of marked blocks is _higher_ on the untouched pictures
(4.1 %) than on the edited one (2.5 %).

## Variant 2 — deficit against the spatial neighbourhood

The idea: a smooth sky has smooth neighbours (ratio ≈ 1), an inpainted patch sits inside grain.
Each block compared with the median grain of the blocks within 2–3 blocks of it, the whole
frame at 2048 px.

Top regions, radius 3, ratio < 0.6: blurred 320 px → `19 @ 0.42`; untouched q92 → `19 @ 0.42`.
Identical. The synthetic patch does not even reach the top three regions of its own picture.

## Variant 3 — boundary contrast

The idea with the best physical grounding: for each deficit region, the grain inside against
the grain in a two-block ring around it. A gradient fades, an inpainted island has an edge.

The highest-contrast region in **every** picture — edited or not — is the same patch of sky
(blocks x38–47, y3–6), contrast 8.4–10.6. The untouched original scores 10.62, higher than any
positive. The blurred patch never ranks first.

## What this rules out

- No automatic «здесь затёрли» verdict on any of these statistics.
- No two-sided marking of «smooth» blocks on the map either: the untouched photograph marks a
  larger share than the edited one, so the marks would be read as evidence while carrying none.
  A map that invites «the orange square is near the car, so it found it» is worse than no map.
- Raising the noise pass to native resolution was not measured as a fix; it makes the map
  finer, not the statistic separable, and costs about 4× the time. Not worth shipping alone.

## What would change the answer

1. **A real set.** 30–50 of your own photos as they come off the phone (not through a
   messenger), each with a Clean Up edit of known location, plus negatives that include the
   hard cases: heavy bokeh, night shots with strong denoising, sky and water. The bench prints
   a separability table for exactly this.
2. **Ground truth per pixel**, not per picture: the edit mask, so a feature is scored by how
   much of the patch it marks against how much of the rest it marks, instead of one threshold
   on one number.
3. **A different feature class** once 1 and 2 exist — the spectral profile per block (a
   diffusion patch cuts the high end differently from JPEG) or a learned detector. Both need
   the set first; without it, any threshold is fitted to a single picture.

Until then the card says plainly what these checks cannot see (`frameChecksLimit`), which is
the honest state: they catch a paste from another file and a second save, and they do not
catch a phone's own generative editor.
