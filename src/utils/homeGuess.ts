import type { PlaceContextResult } from '../types/api';

/**
 * Is this where the person lives?
 *
 * Every part of the answer is already on the page — the land use, what the point resolved to,
 * whether anything here has a Wikipedia article, the day and the hour — and none of them says
 * it on its own. Put together they usually do, and it is the single question a stranger holding
 * the photograph actually wants answered.
 *
 * It is a guess, and it is marked as one. The signals are listed with it, for and against, so a
 * reader can see it is arithmetic over ordinary facts rather than an oracle. `undecided` is a
 * real outcome and the common one: a photograph in a park on a Tuesday afternoon says nothing.
 */

export type HomeVerdict = 'likely' | 'possible' | 'unlikely' | 'undecided';

export interface HomeSignal {
  /** Dictionary key suffix: the UI prefixes it with `homeSignal_`. */
  id: string;
  /** Positive weights argue for a home, negative ones against it. */
  weight: number;
}

export interface HomeGuess {
  verdict: HomeVerdict;
  score: number;
  for: HomeSignal[];
  against: HomeSignal[];
}

export interface HomeGuessInput {
  /** OSM `landuse` at the point, from `/api/place-context`. */
  landuse?: string;
  /** Nominatim category/type of what the point resolved to. */
  placeCategory?: string;
  placeType?: string;
  /** Did Nominatim answer with something at the point, or with the nearest thing far away? */
  atThePoint: boolean;
  /** How many Wikipedia articles this point has. A known place is not a home. */
  landmarkCount: number;
  /** Weekday / weekend / holiday, from `timeProfile`. */
  dayKind?: 'weekday' | 'weekend' | 'holiday';
  /** Hour of the capture in the camera's own clock, 0–23. */
  hour?: number;
  /** Stations and stops nearby, from `/api/place-context`. */
  transport?: PlaceContextResult['transport'];
  /** Sensitive neighbours nearby, from `/api/place-context`. */
  sensitive?: PlaceContextResult['sensitive'];
}

const RESIDENTIAL_TYPES = new Set([
  'house',
  'residential',
  'apartments',
  'detached',
  'semidetached_house',
  'terrace',
  'bungalow',
  'dormitory',
  'yes'
]);

const NON_RESIDENTIAL_LANDUSE = new Set([
  'industrial',
  'commercial',
  'retail',
  'military',
  'quarry',
  'construction',
  'cemetery',
  'railway'
]);

/** Outside these hours a person is usually at home rather than anywhere else. */
const EVENING_FROM = 19;
const MORNING_UNTIL = 8;

/** Above this the guess is «likely», above the lower one «possible»; below the negative one «unlikely». */
export const HOME_LIKELY = 5;
export const HOME_POSSIBLE = 3;
export const HOME_UNLIKELY = -3;

export function guessHome(input: HomeGuessInput): HomeGuess {
  const forSignals: HomeSignal[] = [];
  const againstSignals: HomeSignal[] = [];
  const add = (id: string, weight: number) => (weight > 0 ? forSignals : againstSignals).push({ id, weight });

  if (input.landuse === 'residential') add('landuseResidential', 3);
  else if (input.landuse && NON_RESIDENTIAL_LANDUSE.has(input.landuse)) add('landuseNotResidential', -3);

  // A building the point actually falls in, of a kind people live in.
  if (input.atThePoint && input.placeCategory === 'building' && RESIDENTIAL_TYPES.has(input.placeType ?? '')) {
    add('residentialBuilding', 3);
  }
  // Nominatim answering with something far away means the point is not at an address at all.
  if (!input.atThePoint) add('noAddressHere', -1);

  // A place with a Wikipedia article is somewhere thousands of people go.
  if (input.landmarkCount > 0) add('landmark', -3);

  if (input.dayKind === 'weekend' || input.dayKind === 'holiday') add('dayOff', 1);
  if (input.hour != null && (input.hour >= EVENING_FROM || input.hour < MORNING_UNTIL)) add('eveningOrNight', 2);
  if (input.dayKind === 'weekday' && input.hour != null && input.hour >= 9 && input.hour <= 18) {
    add('workingHours', -2);
  }

  // A station at the door explains a stranger being here without living here.
  if ((input.transport ?? []).some((item) => item.distance <= 200)) add('transportAtTheDoor', -1);
  // A school or a kindergarten within a couple of streets is where families live.
  if ((input.sensitive ?? []).some((item) => /^(school|kindergarten)$/.test(item.kind) && item.distance <= 400)) {
    add('schoolNearby', 1);
  }

  const score = [...forSignals, ...againstSignals].reduce((sum, signal) => sum + signal.weight, 0);
  const verdict: HomeVerdict =
    score >= HOME_LIKELY ? 'likely' : score >= HOME_POSSIBLE ? 'possible' : score <= HOME_UNLIKELY ? 'unlikely' : 'undecided';

  return { verdict, score, for: forSignals, against: againstSignals };
}
