import React, { useEffect, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import type { FeatureCollection, Polygon } from 'geojson';
import { useT } from '../i18n';
import { Explainer } from './Explainer';

interface MapBlockProps {
  lat: number;
  lon: number;
  accuracy?: number;
}

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
const MapCanvas: React.FC<MapBlockProps> = ({ lat, lon, accuracy }) => {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  // Latest props for the async setup: the chunk may still be downloading when they change.
  // Declared before the setup effect so it is current by the time setup awaits the import.
  const latestRef = useRef({ lat, lon, accuracy });
  useEffect(() => {
    latestRef.current = { lat, lon, accuracy };
  }, [lat, lon, accuracy]);
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
        const [maplibre] = await Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]);
        if (cancelled || !containerRef.current) return;
        const { lat: initLat, lon: initLon } = latestRef.current;
        map = new maplibre.Map({
          container: containerRef.current,
          style: {
            version: 8,
            sources: {
              osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
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
          zoom: 15
        });
        mapRef.current = map;
        map.addControl(new maplibre.NavigationControl({ visualizePitch: true }));
        marker = new maplibre.Marker({ color: accentColor() }).setLngLat([initLon, initLat]).addTo(map);
        markerRef.current = marker;
        // The accuracy circle needs the style, so draw it on `load` — with whatever the props
        // are by then. Later prop changes are handled by the effect below.
        const loadedMap = map;
        map.once('load', () => {
          if (cancelled) return;
          const { lat: currentLat, lon: currentLon, accuracy: currentAccuracy } = latestRef.current;
          applyAccuracy(loadedMap, currentLat, currentLon, currentAccuracy);
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
    if (map.isStyleLoaded()) {
      applyAccuracy(map, lat, lon, accuracy);
      return;
    }
    const handler = () => applyAccuracy(map, lat, lon, accuracy);
    map.once('load', handler);
    return () => {
      map.off('load', handler);
    };
  }, [lat, lon, accuracy]);

  if (unavailable) {
    return (
      <div className="fy-map fy-map--unavailable" role="note">
        <p className="fy-hint">{t('mapUnavailable')}</p>
      </div>
    );
  }

  return <div ref={containerRef} className="fy-map" role="application" aria-label={t('mapLabel')} />;
};

/**
 * The map behind a button, with the reason for the button next to it.
 *
 * Every other number on the page is computed on the device, and the only thing that leaves it
 * is a pair of coordinates rounded to four decimals, sent to this project's own Functions. The
 * map is the one exception: maplibre fetches raster tiles straight from tile.openstreetmap.org,
 * so OSM sees the reader's IP address and which tiles they asked for — that is roughly the place
 * the photo was taken, unrounded, and it is a third party learning it, not us. Loading that
 * automatically would quietly undo the promise the rest of the page keeps, so the reader decides.
 *
 * The state is per mount: a new photo means a new decision, because it is a new place.
 */
export const MapBlock: React.FC<MapBlockProps> = ({ lat, lon, accuracy }) => {
  const t = useT();
  const [shown, setShown] = useState(false);

  if (shown) return <MapCanvas lat={lat} lon={lon} accuracy={accuracy} />;

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
