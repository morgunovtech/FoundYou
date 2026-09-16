import { parseWallClock, wallClockAsUtcDate } from '../format';
import { isWeekend, isWorkingHour, photoAge, timeOfDay } from '../timeProfile';

type Lang = 'ru' | 'en' | 'uz';

export type Severity = 'low' | 'medium' | 'high';

export interface TemporalInsight {
  fact: string;
  inference: string;
  severity: Severity;
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return `${n} ${few}`;
  return `${n} ${many}`;
}

/**
 * Temporal heuristics from the camera wall-clock, as ready sentences for the story and the
 * report. The classification itself (time of day, weekend, age) lives in `timeProfile.ts`,
 * which the «Time and habits» card renders in full; this keeps the two in step.
 *
 * @param shotDateLocal `StructuredMetadata.shotDateLocal` — the wall-clock exactly as written
 *   by the camera (`YYYY-MM-DDTHH:mm:ss`; the EXIF `YYYY:MM:DD HH:MM:SS` form is accepted too).
 *   Hour and weekday are read from these digits directly, so the result does not depend on the
 *   viewer's time zone. A zoned ISO string is tolerated: its zone suffix is ignored and the digits
 *   are taken as-is — pass the wall-clock whenever you have it.
 */
export function analyzeDateTime(shotDateLocal: string | undefined, lang: Lang): TemporalInsight[] {
  if (!shotDateLocal) return [];

  const parts = parseWallClock(shotDateLocal);
  if (!parts) return [];

  const asUtc = wallClockAsUtcDate(parts);
  const hour = parts.hour;
  const dayOfWeek = asUtc.getUTCDay();
  const insights: TemporalInsight[] = [];

  // Time of day
  const period = timeOfDay(hour);
  if (period === 'night') {
    insights.push({
      fact: lang === 'ru' ? `Ночное фото (${hour}:00)` : lang === 'uz' ? `Tungi foto (${hour}:00)` : `Night photo (${hour}:00)`,
      inference: lang === 'ru' ? 'Вы бодрствовали глубокой ночью' : lang === 'uz' ? 'Siz tunda uyg\'oq edingiz' : 'You were awake late at night',
      severity: 'medium',
    });
  } else if (period === 'earlyMorning') {
    insights.push({
      fact: lang === 'ru' ? `Раннее утро (${hour}:00)` : lang === 'uz' ? `Erta tong (${hour}:00)` : `Early morning (${hour}:00)`,
      inference: lang === 'ru' ? 'Ранний подъём — привычка, спорт, или перелёт' : lang === 'uz' ? 'Erta turish — odat, sport yoki parvoz' : 'Early rise — habit, sports, or travel',
      severity: 'low',
    });
  } else if (period === 'lunch') {
    insights.push({
      fact: lang === 'ru' ? 'Обеденное время' : lang === 'uz' ? 'Tushlik vaqti' : 'Lunchtime',
      inference: lang === 'ru' ? 'Вероятно, обеденный перерыв' : lang === 'uz' ? 'Ehtimol tushlik tanaffusi' : 'Probably a lunch break',
      severity: 'low',
    });
  }

  // Day of week + work hours
  if (isWeekend(dayOfWeek)) {
    insights.push({
      fact: lang === 'ru' ? 'Выходной день' : lang === 'uz' ? 'Dam olish kuni' : 'Weekend',
      inference: lang === 'ru' ? 'Личное время — отдых, семья, хобби' : lang === 'uz' ? 'Shaxsiy vaqt — dam olish, oila' : 'Personal time — rest, family, hobbies',
      severity: 'low',
    });
  } else if (isWorkingHour(hour)) {
    insights.push({
      fact: lang === 'ru' ? 'Будний день, рабочие часы' : lang === 'uz' ? 'Ish kuni, ish soatlari' : 'Weekday, working hours',
      inference: lang === 'ru' ? 'Вы фотографировали в рабочее время' : lang === 'uz' ? 'Siz ish vaqtida suratga oldingiz' : 'You took a photo during working hours',
      severity: 'medium',
    });
  }

  // Photo age (see `photoAge` for why the wall-clock is compared as if it were UTC).
  const age = photoAge(asUtc, new Date());

  if (age.kind === 'future') {
    insights.push({
      fact: lang === 'ru' ? 'Дата в будущем' : lang === 'uz' ? 'Kelajakdagi sana' : 'Future date',
      inference: lang === 'ru' ? 'Часы на устройстве были настроены неправильно' : lang === 'uz' ? 'Qurilma soati noto\'g\'ri sozlangan' : 'Device clock was set incorrectly',
      severity: 'low',
    });
  } else if (age.kind === 'fresh') {
    insights.push({
      fact: lang === 'ru' ? 'Фото сделано сегодня или вчера' : lang === 'uz' ? 'Foto bugun yoki kecha olingan' : 'Photo taken today or yesterday',
      inference: lang === 'ru' ? 'Свежее фото — геолокация актуальна' : lang === 'uz' ? 'Yangi foto — geolokatsiya dolzarb' : 'Fresh photo — geolocation is current',
      severity: 'high',
    });
  } else if (age.kind === 'years') {
    const ageYears = age.value;
    const ageStr = lang === 'ru'
      ? pluralRu(ageYears, 'год', 'года', 'лет')
      : `${ageYears} year${ageYears > 1 ? 's' : ''}`;
    insights.push({
      fact: lang === 'ru' ? `Фото сделано ~${ageStr} назад` : lang === 'uz' ? `Foto ~${ageYears} yil oldin olingan` : `Photo taken ~${ageStr} ago`,
      inference: lang === 'ru' ? 'Старое фото — но метаданные всё ещё содержат информацию' : lang === 'uz' ? 'Eski foto — lekin metadata hali ham ma\'lumot saqlaydi' : 'Old photo — but metadata still contains information',
      severity: 'medium',
    });
  } else if (age.kind === 'months') {
    const ageMonths = age.value;
    insights.push({
      fact: lang === 'ru' ? `Фото сделано ~${ageMonths} мес. назад` : lang === 'uz' ? `Foto ~${ageMonths} oy oldin olingan` : `Photo taken ~${ageMonths} months ago`,
      inference: '',
      severity: 'low',
    });
  }

  return insights;
}
