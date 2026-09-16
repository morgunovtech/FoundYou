import type { MessageKey } from '../i18n';
import type { HistoricalWeatherResult } from '../types/api';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export type SkyKey =
  | 'weatherSkyClear'
  | 'weatherSkyMainlyClear'
  | 'weatherSkyPartlyCloudy'
  | 'weatherSkyOvercast'
  | 'weatherSkyFog'
  | 'weatherSkyDrizzle'
  | 'weatherSkyRain'
  | 'weatherSkyHeavyRain'
  | 'weatherSkySnow'
  | 'weatherSkyThunderstorm';

export type TemperatureKey =
  'weatherTempFrost' | 'weatherTempCold' | 'weatherTempCool' | 'weatherTempWarm' | 'weatherTempHot';

/**
 * Sky phrase from the WMO 4677 code Open-Meteo returns as `weather_code`.
 * Answers cached before the code was requested fall back to cloud cover and
 * precipitation, which is what the code is derived from anyway.
 */
export function skyKey(
  weather: Pick<HistoricalWeatherResult, 'weatherCode' | 'cloudCover' | 'precipitation' | 'temperature'>
): SkyKey {
  const code = weather.weatherCode;
  if (code != null && Number.isFinite(code)) {
    if (code === 0) return 'weatherSkyClear';
    if (code === 1) return 'weatherSkyMainlyClear';
    if (code === 2) return 'weatherSkyPartlyCloudy';
    if (code === 3) return 'weatherSkyOvercast';
    if (code === 45 || code === 48) return 'weatherSkyFog';
    if (code >= 51 && code <= 57) return 'weatherSkyDrizzle';
    if (code === 65 || code === 67 || code === 82) return 'weatherSkyHeavyRain';
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'weatherSkyRain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'weatherSkySnow';
    if (code >= 95) return 'weatherSkyThunderstorm';
  }
  const precipitation = weather.precipitation ?? 0;
  if (precipitation >= 0.1) {
    return (weather.temperature ?? 10) <= 0 ? 'weatherSkySnow' : 'weatherSkyRain';
  }
  const cloud = weather.cloudCover ?? 0;
  if (cloud < 25) return 'weatherSkyClear';
  if (cloud < 70) return 'weatherSkyPartlyCloudy';
  return 'weatherSkyOvercast';
}

export function temperatureKey(celsius: number): TemperatureKey {
  if (celsius < 0) return 'weatherTempFrost';
  if (celsius < 10) return 'weatherTempCold';
  if (celsius < 18) return 'weatherTempCool';
  if (celsius < 28) return 'weatherTempWarm';
  return 'weatherTempHot';
}

/**
 * One human line for the hour of the photo, lowercase so it can sit inside a
 * sentence: «ясно, тепло, 26 °C, без осадков, ветер 10 км/ч». Pressure is
 * left out on purpose: nothing visible in a photo can be checked against it,
 * whereas sky, precipitation and wind can.
 */
export function describeWeather(
  weather: HistoricalWeatherResult | null | undefined,
  t: Translate,
  locale: string
): string | null {
  if (!weather || weather.temperature == null || !Number.isFinite(weather.temperature)) return null;
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const fine = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const parts: string[] = [
    t(skyKey(weather)),
    t(temperatureKey(weather.temperature)),
    `${whole.format(Math.round(weather.temperature))} °C`
  ];

  const precipitation = weather.precipitation;
  if (precipitation != null && Number.isFinite(precipitation)) {
    parts.push(
      precipitation < 0.1 ? t('weatherNoPrecipitation') : t('weatherPrecipitation', { mm: fine.format(precipitation) })
    );
  }

  const wind = weather.windSpeed;
  if (wind != null && Number.isFinite(wind)) {
    const speed = whole.format(Math.round(wind));
    if (wind < 2) parts.push(t('weatherCalm'));
    else if (wind < 12) parts.push(t('weatherLightWind', { speed }));
    else if (wind < 30) parts.push(t('weatherWind', { speed }));
    else parts.push(t('weatherStrongWind', { speed }));
  }
  return parts.join(', ');
}

/** First letter up, for the start of a line; the rest of the phrase is already lowercase. */
export function capitalize(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
