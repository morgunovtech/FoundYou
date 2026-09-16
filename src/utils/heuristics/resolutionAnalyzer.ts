type Lang = 'ru' | 'en' | 'uz';

export interface ResolutionAnalysis {
  possibleDevices: string[];
  contentType: string;
  contentHint: string;
  isScreenshot: boolean;
}

interface ResEntry {
  devices: string[];
  type: 'photo' | 'screenshot';
}

const KNOWN: Record<string, ResEntry> = {
  // iPhone cameras
  '4032x3024': { devices: ['iPhone 12/13/14/15'], type: 'photo' },
  '3024x4032': { devices: ['iPhone (portrait)'], type: 'photo' },
  '4290x2856': { devices: ['iPhone 15 Pro Max (48MP)'], type: 'photo' },
  '3264x2448': { devices: ['iPhone 6/7/8, iPad'], type: 'photo' },

  // Pixel
  '4080x3072': { devices: ['Google Pixel 7/8'], type: 'photo' },
  '12032x9024': { devices: ['Google Pixel 7 Pro (50MP)'], type: 'photo' },

  // Samsung
  '4000x3000': { devices: ['Samsung Galaxy S21/S22/S23'], type: 'photo' },
  '4080x3060': { devices: ['Samsung Galaxy S24'], type: 'photo' },

  // iPhone screenshots
  '1170x2532': { devices: ['iPhone 12/13/14'], type: 'screenshot' },
  '1179x2556': { devices: ['iPhone 14 Pro/15/15 Pro'], type: 'screenshot' },
  '1206x2622': { devices: ['iPhone 16 Pro'], type: 'screenshot' },
  '1290x2796': { devices: ['iPhone 14/15 Pro Max'], type: 'screenshot' },
  '1320x2868': { devices: ['iPhone 16 Pro Max'], type: 'screenshot' },
  '1125x2436': { devices: ['iPhone X/XS/11 Pro'], type: 'screenshot' },
  '750x1334': { devices: ['iPhone 6/7/8/SE2/SE3'], type: 'screenshot' },
  '1284x2778': { devices: ['iPhone 12/13 Pro Max'], type: 'screenshot' },
  '1242x2688': { devices: ['iPhone XS Max/11 Pro Max'], type: 'screenshot' },
  '828x1792': { devices: ['iPhone XR/11'], type: 'screenshot' },
  '1080x2340': { devices: ['Xiaomi, Realme, Oppo'], type: 'screenshot' },
  '2048x2732': { devices: ['iPad Pro 12.9"'], type: 'screenshot' },
  '1640x2360': { devices: ['iPad Air/10th gen'], type: 'screenshot' },
  '1620x2160': { devices: ['iPad 9th gen'], type: 'screenshot' },
  '1668x2388': { devices: ['iPad Pro 11"/Air'], type: 'screenshot' },

  // Android screenshots
  '1080x2400': { devices: ['Samsung Galaxy S21/S22, OnePlus 9'], type: 'screenshot' },
  '1440x3120': { devices: ['Google Pixel 7 Pro'], type: 'screenshot' },
  '1440x3200': { devices: ['Samsung Galaxy S21/S22 Ultra'], type: 'screenshot' },
  '1440x3088': { devices: ['Samsung Galaxy S23/S24 Ultra'], type: 'screenshot' },
  '1080x2408': { devices: ['Xiaomi, Redmi, Samsung A-series'], type: 'screenshot' },
  '1080x2280': { devices: ['Samsung Galaxy S10/A50'], type: 'screenshot' },
  '720x1600': { devices: ['Budget Android'], type: 'screenshot' },
  '1440x2960': { devices: ['Samsung Galaxy S8/S9'], type: 'screenshot' },

  // Desktop screenshots
  '2560x1440': { devices: ['QHD monitor / iMac 27"'], type: 'screenshot' },
  '1920x1080': { devices: ['FullHD monitor'], type: 'screenshot' },
  '2880x1800': { devices: ['MacBook Pro 15"/16" (Retina)'], type: 'screenshot' },
  '3024x1964': { devices: ['MacBook Pro 14" M1/M2/M3'], type: 'screenshot' },
  '3456x2234': { devices: ['MacBook Pro 16" M1/M2/M3'], type: 'screenshot' },
  '2560x1600': { devices: ['MacBook Air/Pro 13" (Retina)'], type: 'screenshot' },
  '2560x1664': { devices: ['MacBook Air 13" M2/M3'], type: 'screenshot' },
  '3072x1920': { devices: ['MacBook Air 15" M2/M3'], type: 'screenshot' },
  '3840x2160': { devices: ['4K monitor'], type: 'screenshot' },
  '1366x768': { devices: ['Laptop (HD)'], type: 'screenshot' },
  '1536x864': { devices: ['Laptop (FullHD at 125%)'], type: 'screenshot' },
  '1440x900': { devices: ['MacBook Air (non-Retina), monitor'], type: 'screenshot' },
  '1680x1050': { devices: ['Monitor (WSXGA+)'], type: 'screenshot' },
  '1280x800': { devices: ['MacBook (non-Retina), tablet'], type: 'screenshot' },
};

const CONTENT_TYPES: Record<Lang, Record<string, string>> = {
  ru: {
    social_crop: 'Instagram / аватар (1:1)',
    video_frame: '16:9 — кадр из видео / скриншот',
    stories: '~9:16 — Stories / Reels / TikTok',
    standard_photo: '4:3 — стандартная фотография',
    dslr_photo: '3:2 — зеркальная/беззеркальная камера',
    panorama: 'Панорама',
  },
  en: {
    social_crop: 'Instagram / avatar (1:1)',
    video_frame: '16:9 — video frame / screenshot',
    stories: '~9:16 — Stories / Reels / TikTok',
    standard_photo: '4:3 — standard photo',
    dslr_photo: '3:2 — DSLR / mirrorless camera',
    panorama: 'Panorama',
  },
  uz: {
    social_crop: 'Instagram / avatar (1:1)',
    video_frame: '16:9 — video kadr / skrinshot',
    stories: '~9:16 — Stories / Reels / TikTok',
    standard_photo: '4:3 — standart foto',
    dslr_photo: '3:2 — DSLR kamera',
    panorama: 'Panorama',
  },
};

function detectContentType(width: number, height: number, lang: Lang): { type: string; hint: string } {
  const ratio = Math.max(width, height) / (Math.min(width, height) || 1);
  const labels = CONTENT_TYPES[lang];

  if (ratio > 2.5) return { type: 'panorama', hint: labels.panorama };
  if (Math.abs(ratio - 1.0) < 0.02) return { type: 'social_crop', hint: labels.social_crop };
  if (Math.abs(ratio - 1.778) < 0.03) return { type: 'video_frame', hint: labels.video_frame };
  if (Math.abs(ratio - 2.0) < 0.2 && height > width) return { type: 'stories', hint: labels.stories };
  if (Math.abs(ratio - 1.333) < 0.03) return { type: 'standard_photo', hint: labels.standard_photo };
  if (Math.abs(ratio - 1.5) < 0.03) return { type: 'dslr_photo', hint: labels.dslr_photo };
  return { type: 'unknown', hint: '' };
}

export function analyzeResolution(width: number, height: number, lang: Lang): ResolutionAnalysis {
  const key = `${width}x${height}`;
  const keyFlipped = `${height}x${width}`;
  const match = KNOWN[key] ?? KNOWN[keyFlipped];
  const content = detectContentType(width, height, lang);

  return {
    possibleDevices: match?.devices ?? [],
    contentType: content.type,
    contentHint: content.hint,
    isScreenshot: match?.type === 'screenshot',
  };
}
