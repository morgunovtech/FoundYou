import React, { useEffect, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import type { FeatureCollection, Polygon } from 'geojson';
import { useT } from '../i18n';
import { Explainer } from './Explainer';

interface MapBlockProps {
  lat: number;
  lon: number;
  accuracy?: number;
  /** Compass heading of the camera from the file, degrees clockwise from north; the view cone is drawn from it. */
  heading?: number | null;
  /** Horizontal field of view in degrees (`stance.fovDegrees`), the cone's opening. */
  fieldOfView?: number | null;
}

/** How far the drawn cone reaches: enough to show the direction at zoom 15 without claiming a range. */
const CONE_RADIUS_METERS = 150;

/** Brand accent read from the design-system tokens, so the marker follows the theme. */
function accentColor(): string {
  if (typeof document === 'undefined') return '#d9531e';
  const value = getComputedStyle(document.documentElement).getPropertyValue('--v4-orange').trim();
  return value || '#d9531e';
}

/**
 * maplibre-gl 6 requires WebGL2 and does not ship `supported()`; probing a canvas ourselves is
 * the only way to know before the Map constructor throws (and leaves an empty box behind).
 */
function hasWebGl2(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

/**
 * The map itself. Mounted only once the reader has pressed the button in `MapBlock`, because
 * mounting it is what fetches the tiles.
 */
const MapCanvas: React.FC<MapBlockProps> = ({ lat, lon, accuracy, heading, fieldOfView }) => {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  // Latest props for the async setup: the chunk may still be downloading when they change.
  // Declared before the setup effect so it is current by the time setup awaits the import.
  const latestRef = useRef({ lat, lon, accuracy, heading, fieldOfView });
  useEffect(() => {
    latestRef.current = { lat, lon, accuracy, heading, fieldOfView };
  }, [lat, lon, accuracy, heading, fieldOfView]);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let map: maplibregl.Map | null = null;
    let marker: maplibregl.Marker | null = null;
    let cancelled = false;

    const setup = async () => {
      if (!containerRef.current) return;
      if (!hasWebGl2()) {
        setUnavailable(true);
        return;
      }
      try {
        // Both the library and its stylesheet are only needed when a photo
        // carries GPS — keep them out of the critical path.
        const [maplibre, worker] = await Promise.all([
          import('maplibre-gl'),
          import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'),
          import('maplibre-gl/dist/maplibre-gl.css')
        ]);
        if (cancelled || !containerRef.current) return;
        /*
         * maplibre 6 runs its sources in a module worker it loads from `./maplibre-gl-worker.mjs`
         * next to its own script at run time. Vite bundles the script into `assets/` and does not
         * carry the worker file along, so the URL answered 404 and every GeoJSON layer — the
         * accuracy circle, now the view cone — silently never rendered, in production and on the
         * dev server alike (found 2026-09-24: `map.getSource('accuracy-circle').loaded()` stayed
         * false with no error event). The `?worker&url` import makes Vite emit the worker as its
         * own chunk under the site's origin; CSP `worker-src 'self'` covers it.
         */
        maplibre.setWorkerUrl(worker.default);
        const { lat: initLat, lon: initLon } = latestRef.current;
        map = new maplibre.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: {
              osm: {
                type: 'raster',
                // Through this project's own Function (functions/api/tiles), never straight from
                // OSM: the tile server would otherwise see the reader's IP and the squares they asked for.
                tiles: [`${window.location.origin}/api/tiles/{z}/{x}/{y}.png`],
                tileSize: 256,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              }
            },
            layers: [
              {
                id: 'osm-tiles',
                type: 'raster',
                source: 'osm',
                minzoom: 0,
                maxzoom: 19
              }
            ]
          },
          center: [initLon, initLat],
          zoom: 15,
          // A tile cache is a history of places (CLAUDE.md, invariant 2). maplibre keeps none of
          // its own, but the browser's HTTP cache would keep every tile it was asked for; ask it
          // not to.
          transformRequest: (url) => ({ url, cache: 'no-store' })
        });
        mapRef.current = map;
        if (import.meta.env.DEV) (window as unknown as { __fyMap?: maplibregl.Map }).__fyMap = map; // for the dev-server checks only
        map.addControl(new maplibre.NavigationControl({ visualizePitch: true }));
        marker = new maplibre.Marker({ color: accentColor() }).setLngLat([initLon, initLat]).addTo(map);
        markerRef.current = marker;
        // The accuracy circle needs the style, so draw it on `load` — with whatever the props
        // are by then. Later prop changes are handled by the effect below.
        const loadedMap = map;
        map.once('load', () => {
          if (cancelled) return;
          const current = latestRef.current;
          applyAccuracy(loadedMap, current.lat, current.lon, current.accuracy);
          applyCone(loadedMap, current.lat, current.lon, current.heading, current.fieldOfView);
        });
      } catch (error) {
        console.warn('maplibre-init', error);
        mapRef.current = null;
        if (!cancelled) setUnavailable(true);
      }
    };

    void setup();

    return () => {
      cancelled = true;
      marker?.remove();
      markerRef.current = null;
      if (map) {
        try {
          clearAccuracy(map);
          clearCone(map);
        } catch {
          // Style may never have loaded; removal below is what matters.
        }
        map.remove();
      }
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.setCenter([lon, lat]);
    }
    if (markerRef.current) {
      markerRef.current.setLngLat([lon, lat]);
    }
  }, [lat, lon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return; // first draw happens in setup's `load` handler
    const draw = () => {
      applyAccuracy(map, lat, lon, accuracy);
      applyCone(map, lat, lon, heading, fieldOfView);
    };
    if (map.isStyleLoaded()) {
      draw();
      return;
    }
    map.once('load', draw);
    return () => {
      map.off('load', draw);
    };
  }, [lat, lon, accuracy, heading, fieldOfView]);

  if (unavailable) {
    return (
      <div className="fy-map fy-map--unavailable" role="note">
        <p className="fy-hint">{t('mapUnavailable')}</p>
      </div>
    );
  }

  return (
    <>
      <div ref={containerRef} className="fy-map" role="application" aria-label={t('mapLabel')} />
      {heading != null && Number.isFinite(heading) ? <p className="fy-hint">{t('mapConeHint')}</p> : null}
    </>
  );
};

/**
 * The map behind a button, with the reason for the button next to it.
 *
 * Until 2026-09-24 the reason was a third party: maplibre fetched raster tiles straight from
 * tile.openstreetmap.org, so OSM saw the reader's IP address and which tiles they asked for. The
 * tiles now come through this project's own Function (`functions/api/tiles`), OSM sees only
 * Cloudflare, and the browser is told not to keep them. What the button still buys is
 * disclosure: the map is the one element that keeps asking the server as the reader pans and
 * zooms — every other request is made once and listed under the card — and about twenty tile
 * requests per view is worth a sentence before they happen. The reader decides.
 *
 * The state is per mount: a new photo means a new decision, because it is a new place.
 */
export const MapBlock: React.FC<MapBlockProps> = ({ lat, lon, accuracy, heading, fieldOfView }) => {
  const t = useT();
  const [shown, setShown] = useState(false);

  if (shown) return <MapCanvas lat={lat} lon={lon} accuracy={accuracy} heading={heading} fieldOfView={fieldOfView} />;

  return (
    <div className="fy-map-gate">
      <Explainer title={t('mapGateTitle')}>
        <p>{t('mapGateBody')}</p>
        <p>{t('mapGateRisk')}</p>
      </Explainer>
      <button type="button" className="v4-btn fy-btn-sm" onClick={() => setShown(true)}>
        {t('mapGateButton')}
      </button>
    </div>
  );
};

const ACCURACY_SOURCE = 'accuracy-circle';
const ACCURACY_LAYER = 'accuracy-circle-fill';
const ACCURACY_OUTLINE_LAYER = 'accuracy-circle-outline';

function applyAccuracy(map: maplibregl.Map, lat: number, lon: number, accuracy?: number) {
  if (!accuracy || accuracy <= 0) {
    clearAccuracy(map);
    return;
  }
  const data = createCircleGeoJson(lat, lon, accuracy);
  const existingSource = map.getSource(ACCURACY_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (existingSource) {
    existingSource.setData(data);
    return;
  }
  const color = accentColor();
  map.addSource(ACCURACY_SOURCE, {
    type: 'geojson',
    data
  });
  map.addLayer({
    id: ACCURACY_LAYER,
    type: 'fill',
    source: ACCURACY_SOURCE,
    paint: {
      'fill-color': color,
      'fill-opacity': 0.18
    }
  });
  map.addLayer({
    id: ACCURACY_OUTLINE_LAYER,
    type: 'line',
    source: ACCURACY_SOURCE,
    paint: {
      'line-color': color,
      'line-width': 1.5,
      'line-opacity': 0.6
    }
  });
}

function clearAccuracy(map: maplibregl.Map) {
  if (map.getLayer(ACCURACY_LAYER)) {
    map.removeLayer(ACCURACY_LAYER);
  }
  if (map.getLayer(ACCURACY_OUTLINE_LAYER)) {
    map.removeLayer(ACCURACY_OUTLINE_LAYER);
  }
  if (map.getSource(ACCURACY_SOURCE)) {
    map.removeSource(ACCURACY_SOURCE);
  }
}

const CONE_SOURCE = 'view-cone';
const CONE_LAYER = 'view-cone-fill';
const CONE_OUTLINE_LAYER = 'view-cone-outline';

/**
 * The sector the camera looked into: the file's compass heading, opened by the lens's field of
 * view (the same two numbers the stance sketch draws), reaching `CONE_RADIUS_METERS` from the
 * point. It says where the camera pointed, not how far the picture reaches.
 */
function applyCone(map: maplibregl.Map, lat: number, lon: number, heading?: number | null, fieldOfView?: number | null) {
  if (heading == null || !Number.isFinite(heading)) {
    clearCone(map);
    return;
  }
  const fov = fieldOfView != null && Number.isFinite(fieldOfView) && fieldOfView > 0 ? Math.min(fieldOfView, 170) : 70;
  const data = createSectorGeoJson(lat, lon, CONE_RADIUS_METERS, heading, fov);
  const existingSource = map.getSource(CONE_SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (existingSource) {
    existingSource.setData(data);
    return;
  }
  const color = accentColor();
  map.addSource(CONE_SOURCE, { type: 'geojson', data });
  map.addLayer({
    id: CONE_LAYER,
    type: 'fill',
    source: CONE_SOURCE,
    paint: { 'fill-color': color, 'fill-opacity': 0.22 }
  });
  map.addLayer({
    id: CONE_OUTLINE_LAYER,
    type: 'line',
    source: CONE_SOURCE,
    paint: { 'line-color': color, 'line-width': 1.5, 'line-opacity': 0.8 }
  });
}

function clearCone(map: maplibregl.Map) {
  if (map.getLayer(CONE_LAYER)) map.removeLayer(CONE_LAYER);
  if (map.getLayer(CONE_OUTLINE_LAYER)) map.removeLayer(CONE_OUTLINE_LAYER);
  if (map.getSource(CONE_SOURCE)) map.removeSource(CONE_SOURCE);
}

/** A sector from the point: the apex, then the arc from `heading − fov/2` to `heading + fov/2`, closed. */
export function createSectorGeoJson(lat: number, lon: number, radiusMeters: number, headingDegrees: number, fovDegrees: number): FeatureCollection<Polygon> {
  const steps = 24;
  const earthRadius = 6_371_000;
  const centerLatRad = (lat * Math.PI) / 180;
  const coordinates: [number, number][] = [[lon, lat]];
  const start = headingDegrees - fovDegrees / 2;
  for (let i = 0; i <= steps; i += 1) {
    const bearing = ((start + (fovDegrees * i) / steps) * Math.PI) / 180;
    // Bearings run clockwise from north: north is +lat, east is +lon.
    const offsetLat = (radiusMeters / earthRadius) * Math.cos(bearing);
    const offsetLon = ((radiusMeters / earthRadius) * Math.sin(bearing)) / Math.cos(centerLatRad);
    coordinates.push([lon + (offsetLon * 180) / Math.PI, lat + (offsetLat * 180) / Math.PI]);
  }
  coordinates.push([lon, lat]);
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coordinates] } }]
  };
}

function createCircleGeoJson(lat: number, lon: number, radiusMeters: number): FeatureCollection<Polygon> {
  const steps = 64;
  const coordinates: [number, number][] = [];
  const earthRadius = 6_371_000;
  const centerLatRad = (lat * Math.PI) / 180;
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    const offsetLat = (radiusMeters / earthRadius) * Math.sin(angle);
    const offsetLon = ((radiusMeters / earthRadius) * Math.cos(angle)) / Math.cos(centerLatRad);
    const pointLat = lat + (offsetLat * 180) / Math.PI;
    const pointLon = lon + (offsetLon * 180) / Math.PI;
    coordinates.push([pointLon, pointLat]);
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [coordinates]
        }
      }
    ]
  };
}
