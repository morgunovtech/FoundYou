import type { MessageKey } from '../i18n';

/**
 * Prevention beats cleanup: once the photo shows GPS, tell the owner how to switch geotags
 * off on the very device that wrote them. The camera make/model from EXIF picks the recipe.
 */
const RULES: Array<[RegExp, MessageKey]> = [
  [/apple|iphone|ipad/i, 'geotagTipApple'],
  [/samsung/i, 'geotagTipSamsung'],
  [/google|pixel/i, 'geotagTipGoogle'],
  [/xiaomi|redmi|poco/i, 'geotagTipXiaomi'],
  [/huawei|honor/i, 'geotagTipHuawei'],
  [/oneplus|oppo|realme|vivo/i, 'geotagTipBbk'],
  [/sony|canon|nikon|fujifilm|olympus|om digital|panasonic|leica|ricoh|pentax|hasselblad|dji|gopro|insta360/i, 'geotagTipCamera']
];

export function geotagTipKey(make?: string | null, model?: string | null, platform?: string | null): MessageKey {
  const haystack = [make, model].filter(Boolean).join(' ').trim();
  if (haystack) {
    for (const [pattern, key] of RULES) {
      if (pattern.test(haystack)) return key;
    }
    return 'geotagTipAndroid';
  }
  if (platform && /apple|iphone|ios/i.test(platform)) return 'geotagTipApple';
  return 'geotagTipGeneric';
}
