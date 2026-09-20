import { useEffect, useState } from 'react';

/**
 * The time zone of the place the photo was taken, worked out on the device.
 *
 * Until now this came from one place only: the `timezone` field of the weather answer, which
 * Open-Meteo fills because the request asks for `timezone=auto`. That made a fact about the
 * photograph — «камера стояла на час впереди места съёмки» — depend on a network call
 * succeeding, and on a weather endpoint at that. With no network, a failed upstream or simply
 * no capture date to ask the weather for, the row read «не записан» although the file had
 * everything needed to answer it.
 *
 * `@photostructure/tz-lookup` carries the zone boundaries with it, so the answer comes from the
 * coordinates alone. It costs about 100 KB, which is why it is `import()`-ed only once a photo
 * with GPS is open, and never on the first screen.
 *
 * Nothing is sent anywhere: this replaces a network dependency rather than adding one.
 */

/** Over open water the library answers `Etc/GMT…`, which is a placeholder, not a place. */
function usable(zone: string | null | undefined): zone is string {
  return typeof zone === 'string' && zone.length > 0 && !zone.startsWith('Etc/');
}

export function usePlaceTimezone(lat: number | null | undefined, lon: number | null | undefined): string | null {
  const [zone, setZone] = useState<string | null>(null);

  useEffect(() => {
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      setZone(null);
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        const module = await import('@photostructure/tz-lookup');
        if (cancelled) return;
        const lookup = (module.default ?? module) as (lat: number, lon: number) => string | null;
        const found = lookup(lat, lon);
        setZone(usable(found) ? found : null);
      } catch (error) {
        // A missing chunk must not cost the card its other rows: the weather answer is still
        // there as a fallback, and a zone of `null` is what the profile already copes with.
        console.warn('tz-lookup', error);
        if (!cancelled) setZone(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lon]);

  return zone;
}
