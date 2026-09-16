import { describe, expect, it } from 'vitest';
import { capitalize, describeWeather, skyKey, temperatureKey } from '../weather';

const t = (key: string, params?: Record<string, string | number>) =>
  params
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key;

const base = { temperature: 26, precipitation: 0, cloudCover: 5, windSpeed: 10, pressure: 1013 };

describe('skyKey', () => {
  it('maps WMO codes to the sky phrase', () => {
    expect(skyKey({ ...base, weatherCode: 0 })).toBe('weatherSkyClear');
    expect(skyKey({ ...base, weatherCode: 1 })).toBe('weatherSkyMainlyClear');
    expect(skyKey({ ...base, weatherCode: 2 })).toBe('weatherSkyPartlyCloudy');
    expect(skyKey({ ...base, weatherCode: 3 })).toBe('weatherSkyOvercast');
    expect(skyKey({ ...base, weatherCode: 45 })).toBe('weatherSkyFog');
    expect(skyKey({ ...base, weatherCode: 53 })).toBe('weatherSkyDrizzle');
    expect(skyKey({ ...base, weatherCode: 61 })).toBe('weatherSkyRain');
    expect(skyKey({ ...base, weatherCode: 80 })).toBe('weatherSkyRain');
    expect(skyKey({ ...base, weatherCode: 65 })).toBe('weatherSkyHeavyRain');
    expect(skyKey({ ...base, weatherCode: 82 })).toBe('weatherSkyHeavyRain');
    expect(skyKey({ ...base, weatherCode: 73 })).toBe('weatherSkySnow');
    expect(skyKey({ ...base, weatherCode: 86 })).toBe('weatherSkySnow');
    expect(skyKey({ ...base, weatherCode: 95 })).toBe('weatherSkyThunderstorm');
  });

  it('falls back to cloud cover and precipitation when the code is missing (older cached answers)', () => {
    expect(skyKey({ ...base, cloudCover: 10 })).toBe('weatherSkyClear');
    expect(skyKey({ ...base, cloudCover: 50 })).toBe('weatherSkyPartlyCloudy');
    expect(skyKey({ ...base, cloudCover: 90 })).toBe('weatherSkyOvercast');
    expect(skyKey({ ...base, cloudCover: 90, precipitation: 2 })).toBe('weatherSkyRain');
    expect(skyKey({ ...base, cloudCover: 90, precipitation: 2, temperature: -3 })).toBe('weatherSkySnow');
    expect(skyKey({ ...base, weatherCode: null, cloudCover: 10 })).toBe('weatherSkyClear');
  });
});

describe('temperatureKey', () => {
  it('bands the temperature', () => {
    expect(temperatureKey(-5)).toBe('weatherTempFrost');
    expect(temperatureKey(0)).toBe('weatherTempCold');
    expect(temperatureKey(9.9)).toBe('weatherTempCold');
    expect(temperatureKey(15)).toBe('weatherTempCool');
    expect(temperatureKey(26)).toBe('weatherTempWarm');
    expect(temperatureKey(28)).toBe('weatherTempHot');
  });
});

describe('describeWeather', () => {
  it('returns null without a temperature', () => {
    expect(describeWeather(null, t, 'ru')).toBeNull();
    expect(describeWeather({ ...base, temperature: null as unknown as number }, t, 'ru')).toBeNull();
  });

  it('builds the line: sky, band, degrees, precipitation, wind', () => {
    expect(describeWeather({ ...base, weatherCode: 0 }, t, 'en')).toBe(
      'weatherSkyClear, weatherTempWarm, 26 °C, weatherNoPrecipitation, weatherLightWind(speed=10)'
    );
  });

  it('names rain, precipitation amount and wind strength', () => {
    expect(
      describeWeather(
        { temperature: 12, precipitation: 2.34, cloudCover: 100, windSpeed: 20, pressure: 1000, weatherCode: 63 },
        t,
        'en'
      )
    ).toBe('weatherSkyRain, weatherTempCool, 12 °C, weatherPrecipitation(mm=2.3), weatherWind(speed=20)');
    expect(describeWeather({ ...base, windSpeed: 1 }, t, 'en')).toContain('weatherCalm');
    expect(describeWeather({ ...base, windSpeed: 40 }, t, 'en')).toContain('weatherStrongWind(speed=40)');
  });

  it('leaves pressure out and survives missing series', () => {
    const line = describeWeather(
      {
        temperature: 30,
        precipitation: null as unknown as number,
        cloudCover: 0,
        windSpeed: null as unknown as number,
        pressure: 1013
      },
      t,
      'en'
    );
    expect(line).toBe('weatherSkyClear, weatherTempHot, 30 °C');
    expect(line).not.toContain('1013');
  });

  it('uses the locale for numbers', () => {
    expect(describeWeather({ ...base, precipitation: 1.5, weatherCode: 61 }, t, 'ru')).toContain(
      'weatherPrecipitation(mm=1,5)'
    );
  });
});

describe('capitalize', () => {
  it('upper-cases the first letter only', () => {
    expect(capitalize('ясно, тепло')).toBe('Ясно, тепло');
    expect(capitalize('')).toBe('');
  });
});
