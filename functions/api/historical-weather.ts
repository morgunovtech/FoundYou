import type { PagesEventContext } from './_types';
import {
  fetchUpstream,
  forbiddenResponse,
  jsonResponse,
  originAllowed,
  parseCoordinates,
  upstreamErrorResponse
} from './_shared';

export async function onRequest({ request }: PagesEventContext): Promise<Response> {
  if (!originAllowed(request)) {
    return forbiddenResponse();
  }
  const url = new URL(request.url);
  const coords = parseCoordinates(url);
  const timestamp = url.searchParams.get('timestamp');
  if (!coords || !timestamp) {
    return jsonResponse({ ok: false, error: 'invalid-parameters' });
  }
  const { lat, lon } = coords;

  // EXIF-дата — локальное время места съёмки. Клиент передаёт её «как есть»
  // (без часового пояса), а Open-Meteo с timezone=auto отдаёт часы в локальном
  // времени точки — сопоставляем напрямую, без пересчёта через пояс браузера.
  const naiveMatch = timestamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})/);
  let dateStr: string;
  let hour: number;
  if (naiveMatch && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(timestamp)) {
    dateStr = naiveMatch[1];
    hour = Number(naiveMatch[2]);
  } else {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return jsonResponse({ ok: false, error: 'invalid-timestamp' });
    }
    dateStr = date.toISOString().split('T')[0];
    hour = date.getUTCHours();
  }
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    return jsonResponse({ ok: false, error: 'invalid-timestamp' });
  }
  const timezone = naiveMatch && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(timestamp) ? 'auto' : 'UTC';

  const apiUrl =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${dateStr}&end_date=${dateStr}` +
    `&hourly=temperature_2m,precipitation,cloudcover,wind_speed_10m,pressure_msl&timezone=${timezone}`;

  try {
    const response = await fetchUpstream(apiUrl, {
      cf: { cacheTtl: 86_400, cacheEverything: true }
    });
    if (!response.ok) {
      return jsonResponse({ ok: false, error: `upstream-${response.status}` });
    }
    const payload = (await response.json()) as any;
    const times: string[] = payload.hourly?.time ?? [];
    const index = times.findIndex((time) => time.endsWith(`T${hour.toString().padStart(2, '0')}:00`));
    if (index === -1) {
      return jsonResponse({ ok: false, error: 'no-hourly-data' });
    }
    const temperature = payload.hourly.temperature_2m?.[index];
    const precipitation = payload.hourly.precipitation?.[index];
    const cloudcover = payload.hourly.cloudcover?.[index];
    const wind = payload.hourly.wind_speed_10m?.[index];
    const pressure = payload.hourly.pressure_msl?.[index];

    // Архив отдаёт null для свежих дат (лаг ~5 дней) и пробелов реанализа —
    // это отсутствие данных, а не «0°C и штиль».
    if (temperature == null) {
      return jsonResponse({ ok: false, error: 'no-hourly-data' });
    }

    return jsonResponse(
      {
        ok: true,
        data: {
          temperature: Number(temperature),
          precipitation: Number(precipitation ?? 0),
          cloudCover: Number(cloudcover ?? 0),
          windSpeed: Number(wind ?? 0),
          pressure: Number(pressure ?? 0)
        }
      },
      { cacheSeconds: 86_400 }
    );
  } catch (error) {
    return upstreamErrorResponse(error);
  }
}
