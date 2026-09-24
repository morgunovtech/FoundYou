/*
 * What each endpoint's `data` must look like before the page is allowed to use it.
 *
 * `useAPIFetch<T>` used to hand `body.data` straight to the caller with `T` asserted, so a
 * malformed answer reached the components as if it were the real type. One wrong shape —
 * `{ items: [...] }` where an array was expected — threw `items.filter is not a function`
 * inside `dedupeByNameAndDistance` and the ErrorBoundary blanked the whole of section 02.
 *
 * The guards are deliberately loose: they check what the page actually reads and nothing else,
 * so an endpoint may add fields, and an optional field the upstream did not fill (a POI without
 * a name, a weather answer from before `weatherCode` existed) still passes. Anything that would
 * make the page throw — the wrong container, a missing coordinate, a name that is not a string —
 * is rejected, and the card shows its ordinary «не удалось получить» state with a retry.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isOptionalString = (value: unknown): boolean => value === undefined || typeof value === 'string';
const isOptionalNumber = (value: unknown): boolean => value === undefined || value === null || isFiniteNumber(value);

/** One nearby place: the list renders its name or its category, and always its distance. */
function isPoi(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return isOptionalString(value.name) && typeof value.category === 'string' && isFiniteNumber(value.distance);
}

export function isPoiList(data: unknown): boolean {
  return Array.isArray(data) && data.every(isPoi);
}

/**
 * Deliberately loose, like the others: only the fields the card reads. `landuse`, the place name
 * and the population are all optional — OSM has them for some points and not for others, and a
 * missing one must not throw the whole usable answer away as `invalid-shape`.
 */
export function isPlaceContext(data: unknown): boolean {
  if (!isRecord(data)) return false;
  if (!Array.isArray(data.sensitive) || !Array.isArray(data.transport)) return false;
  const isItem = (item: unknown) =>
    isRecord(item) && typeof item.kind === 'string' && typeof item.name === 'string' && isFiniteNumber(item.distance);
  // The card prints `landuse` through its label table, `placeName` as text and `population`
  // through a number formatter: each is optional, but when present it must be what the card reads.
  return (
    data.sensitive.every(isItem) &&
    data.transport.every(isItem) &&
    ['landuse', 'placeName', 'placeKind'].every((key) => isOptionalString(data[key])) &&
    isOptionalNumber(data.population)
  );
}

export function isLandmarkList(data: unknown): boolean {
  return (
    Array.isArray(data) &&
    data.every(
      (item) =>
        isRecord(item) && typeof item.title === 'string' && isFiniteNumber(item.distance) && typeof item.lang === 'string'
    )
  );
}

/**
 * `address` and `country` are optional: the endpoint no longer invents them for a point Nominatim
 * cannot geocode. `neighbourhood` and `localName` are rendered as JSX children, so an object in
 * either would throw inside React and blank the section — which is why they are checked here.
 */
export function isReverseGeocode(data: unknown): boolean {
  if (!isRecord(data)) return false;
  if (!isFiniteNumber(data.lat) || !isFiniteNumber(data.lon)) return false;
  return (
    [
      'address',
      'country',
      'countryCode',
      'city',
      'state',
      'district',
      'neighbourhood',
      'localName',
      'road',
      'houseNumber',
      'category',
      'type',
      'addressType',
      'name'
    ].every((key) => isOptionalString(data[key])) &&
    ['placeRank', 'buildingLevels', 'precisionMeters', 'distanceMeters'].every((key) => isOptionalNumber(data[key]))
  );
}

export function isHistoricalWeather(data: unknown): boolean {
  if (!isRecord(data)) return false;
  /*
   * Only the temperature must be a number. The endpoint fills each field from its own hourly
   * series and writes `null` where the upstream has a gap, and every reader already copes —
   * `skyKey` uses `precipitation ?? 0`, `describeWeather` returns null without a temperature and
   * skips the rest field by field. Demanding all five made one missing hour of wind throw the
   * whole answer away as `invalid-shape`, so the card said «не удалось получить» over a reading
   * it had.
   */
  return (
    isFiniteNumber(data.temperature) &&
    ['precipitation', 'cloudCover', 'windSpeed', 'pressure'].every((key) => isOptionalNumber(data[key])) &&
    isOptionalNumber(data.weatherCode) &&
    isOptionalString(data.timezone)
  );
}

export function isElevation(data: unknown): boolean {
  return isRecord(data) && isFiniteNumber(data.elevation) && isFiniteNumber(data.resolutionMeters);
}

export function isHolidays(data: unknown): boolean {
  if (!isRecord(data)) return false;
  if (typeof data.isHoliday !== 'boolean' || !Array.isArray(data.holidays)) return false;
  return data.holidays.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.date === 'string' &&
      typeof entry.localName === 'string' &&
      typeof entry.name === 'string'
  );
}
