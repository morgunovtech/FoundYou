import type { BoundingBox } from '../types/detection';

/**
 * Indoors or outdoors, and — indoors — what kind of room.
 *
 * EfficientDet names 80 things and says nothing about the place they are in, yet the things
 * themselves answer it: a bed and a television are a home, a laptop with several chairs is an
 * office, a toilet and a sink are a bathroom, a traffic light and a car are a street. This
 * matters to a reader because the setting is the part a photograph gives away without any
 * metadata at all — a geotag can be stripped, a bed cannot.
 *
 * It is a reading of the objects, not a measurement, and the card says so. Nothing here leaves
 * the device: the detections were made in the browser.
 */

export type Setting = 'home' | 'workplace' | 'bathroom' | 'kitchen' | 'transport' | 'street' | 'nature';

export interface SettingReading {
  setting: Setting;
  indoors: boolean;
  /** The COCO labels that carried the verdict, for the card to show its working. */
  evidence: string[];
  /** Total weight of the evidence — the margin over the runner-up decided the verdict. */
  score: number;
}

/**
 * Object → setting, with a weight. A weight says how much that object alone narrows the place
 * down: a toilet is nearly conclusive, a chair is barely a hint, because chairs are everywhere.
 */
const SIGNALS: Record<string, Array<[Setting, number]>> = {
  bed: [['home', 5]],
  couch: [['home', 4]],
  tv: [['home', 2]],
  'potted plant': [['home', 1]],
  vase: [['home', 1]],
  'teddy bear': [['home', 2]],
  book: [['home', 1]],
  remote: [['home', 2]],
  clock: [['home', 1]],

  laptop: [['workplace', 3]],
  keyboard: [['workplace', 3]],
  mouse: [['workplace', 3]],
  chair: [['workplace', 1], ['home', 1]],
  'dining table': [['home', 1], ['workplace', 1]],

  toilet: [['bathroom', 5]],
  sink: [['bathroom', 3], ['kitchen', 2]],
  'hair drier': [['bathroom', 3]],
  toothbrush: [['bathroom', 4]],

  refrigerator: [['kitchen', 4]],
  oven: [['kitchen', 4]],
  microwave: [['kitchen', 4]],
  toaster: [['kitchen', 4]],
  bowl: [['kitchen', 1]],
  fork: [['kitchen', 2]],
  knife: [['kitchen', 2]],
  spoon: [['kitchen', 2]],
  'wine glass': [['kitchen', 1]],

  'traffic light': [['street', 5]],
  'stop sign': [['street', 5]],
  'fire hydrant': [['street', 4]],
  'parking meter': [['street', 4]],
  car: [['street', 2]],
  bus: [['street', 3]],
  truck: [['street', 2]],
  motorcycle: [['street', 2]],
  bicycle: [['street', 1]],
  bench: [['street', 1]],

  train: [['transport', 4]],
  airplane: [['transport', 4]],
  boat: [['transport', 3]],

  cow: [['nature', 3]],
  sheep: [['nature', 3]],
  horse: [['nature', 2]],
  bear: [['nature', 4]],
  elephant: [['nature', 4]],
  zebra: [['nature', 4]],
  giraffe: [['nature', 4]],
  bird: [['nature', 1]],
  skis: [['nature', 3]],
  snowboard: [['nature', 3]],
  surfboard: [['nature', 3]],
  kite: [['nature', 2]]
};

const INDOORS: Record<Setting, boolean> = {
  home: true,
  workplace: true,
  bathroom: true,
  kitchen: true,
  transport: false,
  street: false,
  nature: false
};

/** Below this the objects do not agree enough to name a place at all. */
export const SETTING_MIN_SCORE = 4;
/** And the winner has to be ahead of the runner-up by this much, or it is a guess between two. */
export const SETTING_MIN_MARGIN = 2;
/** A detection this uncertain does not get a vote: the scene narrative already calls it «возможно». */
export const SETTING_MIN_CONFIDENCE = 0.4;

/**
 * The setting the objects point to, or `null` when they do not agree. Refusing to answer is the
 * common case and the correct one: most photographs contain a person and nothing else that says
 * where they are.
 */
export function readSetting(detections: readonly BoundingBox[]): SettingReading | null {
  const scores = new Map<Setting, number>();
  const evidence = new Map<Setting, Set<string>>();

  for (const detection of detections) {
    if ((detection.score ?? 0) < SETTING_MIN_CONFIDENCE) continue;
    const signals = SIGNALS[detection.label];
    if (!signals) continue;
    for (const [setting, weight] of signals) {
      scores.set(setting, (scores.get(setting) ?? 0) + weight);
      const bag = evidence.get(setting) ?? new Set<string>();
      bag.add(detection.label);
      evidence.set(setting, bag);
    }
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  const [setting, score] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;
  if (score < SETTING_MIN_SCORE || score - runnerUp < SETTING_MIN_MARGIN) return null;

  return { setting, indoors: INDOORS[setting], evidence: [...(evidence.get(setting) ?? [])], score };
}
