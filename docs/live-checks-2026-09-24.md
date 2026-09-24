# Live answers from the upstreams — 2026-09-24

The handoff of 2026-09-16 listed checks to run «once the sandbox network allows the upstream
hosts». This is that run, from a Mac in Tashkent, with the same User-Agent the Functions send
and the same queries (`buildQuery` from `functions/api/_overpass.ts`, the Nominatim URL from
`reverse-geocode.ts`). Raw answers are not kept in the repository.

## Overpass (`overpass-api.de`)

Three points: the mountain point from the handoff (41.3612, 69.9240), the centre of Tashkent
(41.3111, 69.2797) and the sample photo (41.3363, 69.2941). One query each, the v3 query with
three named sets and `[timeout:6]`.

| Call | Answer | Time |
|---|---|---|
| sample | 200, 47 elements: 28 `.poi`, 3 `.cctv`, the rest `.ctx` | 5.4 s |
| city, first | 504 (an HTML page from the front end, not JSON) | 7.6 s |
| city, retry | 504 | 9.5 s |
| city, second retry | 200, 101 KB | 4.0 s |
| mountain, first | 504 | 8.8 s |
| mountain, retry | 200, 2 KB | 3.2 s |
| mountain, second retry | 429 (rate limit) | 11.8 s |
| city on `overpass.kumi.systems` | 200, 99 KB, data from 2026-05 | 20.3 s |

**What it means.** The public server answers the same query in 3–5 s when it has a slot and
504 when it does not, and three calls inside a minute from one address earn a 429. The Function
sends the 504 on as `upstream-504` (502 to the client), the client retries twice with 300–600 ms
between attempts, so a reader in a dense area often sees «не удалось получить» for the three
Overpass cards after ~13 s, and a retry burst can turn a 504 into a 429. Nothing was changed:
the choices are a second instance as fallback (kumi answered, but in 20 s, past both deadlines,
with data five months old), a lighter query (the `.ctx` set asks for `landuse` ways and relations
around 200 m, which is heavy in a city), or a slower client. That is the owner's call; the numbers
are here.

## Nominatim (`reverse?format=jsonv2&zoom=18&addressdetails=1&extratags=1&namedetails=1`)

| Point | category / type / addresstype | Distance | `placeTypeLabel` before | after |
|---|---|---|---|---|
| mountain 41.3612, 69.9240 | highway / path / road, «Лошадиная тропа» | 64 m | road, not «here» | same |
| city 41.3111, 69.2797 | highway / pedestrian / road | 60 m | road, not «here» | same |
| sample 41.3363, 69.2941 | highway / living_street / road, name:en, name:ru, old_name | 26 m | road, not «here» | same |
| 41.3140, 69.2836 | railway / station / railway, «Yunus Rajabiy», name:uz, name:ru, name:fa | 15 m | **null — no type at all** | station |
| 41.2995, 69.2401 | amenity / parking / amenity | 83 m | parking, not «here» | same |

**Changed:** `placeType.ts` now names `railway` / `public_transport` stations and `aeroway`
aerodromes; the metro station in the centre of the city mapped to nothing. `namedetails` carries
`name:uz` / `name:ru` as `localNameOf` expects. No point in this run resolved to a building, so
the house / apartments / hotel branches are still verified by fixtures only.

## Open-Meteo

- Archive (`archive-api.open-meteo.com`, 2026-03-15, `timezone=auto`): 200 in 0.5 s. `hourly`
  carries `temperature_2m`, `precipitation`, `cloudcover`, `windspeed_10m`, `surface_pressure`
  and `weather_code` (`wmo code`, integers — 3 at 10:00–13:00). `timezone: Asia/Tashkent`,
  `utc_offset_seconds`, `elevation: 479` (the grid cell's). The shape `historical-weather.ts`
  parses.
- Elevation (`api.open-meteo.com/v1/elevation`) for the mountain point: `{"elevation":[1280.0]}`,
  0.6 s — the form `elevation.ts` expects.

## Wikipedia (`uz.wikipedia.org`, `list=geosearch`, 1 km, 5)

200 in 0.8 s for the city point: Amir Temur xiyoboni (5.7 m), Toshkent fotosuratlar uyi (246 m),
Temuriylar tarixi davlat muzeyi (287 m), Toshkent politexnika muzeyi (434 m) — `dist` in metres,
`title`, `pageid`; what `landmarks.ts` reads.

## OSM tile (`tile.openstreetmap.org/15/22716/12352.png`)

200, `image/png`, 346 B, 1.1 s with the project User-Agent — the upstream of the new
`/api/tiles` Function.
