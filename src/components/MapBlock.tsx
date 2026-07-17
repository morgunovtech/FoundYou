import React, { useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import type { FeatureCollection, Polygon } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';

interface MapBlockProps {
  lat: number;
  lon: number;
  accuracy?: number;
}

// Демо-стиль maplibre содержит только контуры стран — на zoom 15 карта была
// пустой. Растровые тайлы OSM дают реальную картографию без API-ключа.
const OSM_RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors'
    }
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
} as unknown as maplibregl.StyleSpecification;

export const MapBlock: React.FC<MapBlockProps> = ({ lat, lon, accuracy }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  // Флаг готовности: карта создаётся асинхронно, и эффекты центра/точности
  // должны сработать после её инициализации, а не только при смене пропсов.
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    let map: maplibregl.Map | null = null;
    let marker: maplibregl.Marker | null = null;
    let cancelled = false;

    const setup = async () => {
      if (!containerRef.current) return;
      try {
        const maplibre = await import('maplibre-gl');
        if (cancelled || !containerRef.current) return;
        map = new maplibre.Map({
          container: containerRef.current,
          style: OSM_RASTER_STYLE,
          center: [lon, lat],
          zoom: 15,
          attributionControl: true
        });
        mapRef.current = map;
        map.addControl(new maplibre.NavigationControl({ visualizePitch: true }));
        marker = new maplibre.Marker({ color: '#38bdf8' }).setLngLat([lon, lat]).addTo(map);
        markerRef.current = marker;
        map.on('load', () => {
          if (!cancelled) {
            setMapReady(true);
          }
        });
      } catch (error) {
        console.warn('maplibre-init', error);
        mapRef.current = null;
      }
    };

    setup();

    return () => {
      cancelled = true;
      marker?.remove();
      if (map) {
        clearAccuracy(map);
        map.remove();
      }
      mapRef.current = null;
      markerRef.current = null;
      setMapReady(false);
    };
    // Карта инициализируется один раз; центр и точность обновляют эффекты ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    mapRef.current.setCenter([lon, lat]);
    markerRef.current?.setLngLat([lon, lat]);
  }, [mapReady, lat, lon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    applyAccuracy(map, lat, lon, accuracy);
  }, [mapReady, lat, lon, accuracy]);

  return <div ref={containerRef} className="map-container" />;
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
  map.addSource(ACCURACY_SOURCE, {
    type: 'geojson',
    data
  });
  map.addLayer({
    id: ACCURACY_LAYER,
    type: 'fill',
    source: ACCURACY_SOURCE,
    paint: {
      'fill-color': '#38bdf8',
      'fill-opacity': 0.18
    }
  });
  map.addLayer({
    id: ACCURACY_OUTLINE_LAYER,
    type: 'line',
    source: ACCURACY_SOURCE,
    paint: {
      'line-color': '#38bdf8',
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
    const offsetLon = (radiusMeters / earthRadius) * Math.cos(angle) / Math.cos(centerLatRad);
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
