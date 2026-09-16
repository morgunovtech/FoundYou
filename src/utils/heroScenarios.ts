import type { MessageKey } from '../i18n';

/** Sharing scenarios rotated in the hero title: where a photo most often goes. */
export const HERO_SCENARIO_KEYS = [
  'heroScenarioColleagues',
  'heroScenarioMessenger',
  'heroScenarioSocial',
  'heroScenarioBuyer'
] as const satisfies readonly MessageKey[];

/** How long each scenario holds before the next one dissolves in. */
export const HERO_SCENARIO_HOLD_MS = 3400;
