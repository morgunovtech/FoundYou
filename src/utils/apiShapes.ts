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

export function isReverseGeocode(data: unknown): boolean {
  if (!isRecord(data)) return false;
  if (!isFiniteNumber(data.lat) || !isFiniteNumber(data.lon)) return false;
  if (typeof data.address !== 'string' || typeof data.country !== 'string') return false;
  return (
    ['countryCode', 'city', 'state', 'district', 'road', 'houseNumber', 'category', 'type', 'addressType', 'name'].every(
      (key) => isOptionalString(data[key])
    ) && ['precisionMeters', 'distanceMeters'].every((key) => isOptionalNumber(data[key]))
  );
}

export function isHistoricalWeather(data: unknown): boolean {
  if (!isRecord(data)) return false;
  return (
    ['temperature', 'precipitation', 'cloudCover', 'windSpeed', 'pressure'].every((key) => isFiniteNumber(data[key])) &&
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
