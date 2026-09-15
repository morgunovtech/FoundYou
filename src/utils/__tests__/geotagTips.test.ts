import { describe, expect, it } from 'vitest';
import { geotagTipKey } from '../geotagTips';

describe('geotagTipKey', () => {
  it('picks the recipe by camera make and model', () => {
    expect(geotagTipKey('Apple', 'iPhone 15 Pro')).toBe('geotagTipApple');
    expect(geotagTipKey('samsung', 'SM-S918B')).toBe('geotagTipSamsung');
    expect(geotagTipKey('Google', 'Pixel 8')).toBe('geotagTipGoogle');
    expect(geotagTipKey('Xiaomi', '2201123G')).toBe('geotagTipXiaomi');
    expect(geotagTipKey(undefined, 'Redmi Note 12')).toBe('geotagTipXiaomi');
    expect(geotagTipKey('HUAWEI', 'P60')).toBe('geotagTipHuawei');
    expect(geotagTipKey('OnePlus', 'CPH2449')).toBe('geotagTipBbk');
    expect(geotagTipKey('SONY', 'ILCE-7M4')).toBe('geotagTipCamera');
    expect(geotagTipKey('DJI', 'FC3582')).toBe('geotagTipCamera');
  });

  it('falls back to the Android recipe for an unknown phone and to the generic one for no device at all', () => {
    expect(geotagTipKey('Nothing', 'A063')).toBe('geotagTipAndroid');
    expect(geotagTipKey(null, null)).toBe('geotagTipGeneric');
    expect(geotagTipKey('', '')).toBe('geotagTipGeneric');
  });

  it('uses the filename platform when EXIF has no device', () => {
    expect(geotagTipKey(null, null, 'iPhone')).toBe('geotagTipApple');
    expect(geotagTipKey(null, null, 'Telegram')).toBe('geotagTipGeneric');
  });
});
