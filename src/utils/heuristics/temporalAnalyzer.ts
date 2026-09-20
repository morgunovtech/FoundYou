import { formatMessage, type MessageKey } from '../../i18n';
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
 * Temporal facts from the camera wall-clock, as ready sentences for the raw data table. The
 * classification itself (time of day, weekend, age) lives in `timeProfile.ts`, which the «When
 * the photo was taken» card renders in full; this keeps the two in step. Only facts: what the
 * owner did at that hour (slept, worked, rested) is not inferred from a single photo.
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
  /*
   * The dictionary, as `generateDigitalProfile` reaches it. Two of these strings used to have no
   * Uzbek branch and served English instead; a key cannot go missing without `MessageKey`
   * catching it. The Russian plural forms stay as code below — a plural rule is not a flat string.
   */
  const t = (key: MessageKey, params?: Record<string, string | number>) => formatMessage(lang, key, params);

  // Time of day
  const period = timeOfDay(hour);
  if (period === 'night') {
    insights.push({
      fact: t('temporalNight', { hour }),
      inference: '',
      severity: 'medium',
    });
  } else if (period === 'earlyMorning') {
    insights.push({
      fact: t('temporalEarlyMorning', { hour }),
      inference: '',
      severity: 'low',
    });
  } else if (period === 'lunch') {
    insights.push({
      fact: t('temporalLunch'),
      inference: '',
      severity: 'low',
    });
  }

  // Day of week + work hours
  if (isWeekend(dayOfWeek)) {
    insights.push({
      fact: t('temporalWeekend'),
      inference: '',
      severity: 'low',
    });
  } else if (isWorkingHour(hour)) {
    insights.push({
      fact: t('temporalWorkingHours'),
      inference: '',
      severity: 'medium',
    });
  }

  // Photo age (see `photoAge` for why the wall-clock is compared as if it were UTC).
  const age = photoAge(asUtc, new Date());

  if (age.kind === 'future') {
    insights.push({
      fact: t('temporalFuture'),
      inference: t('temporalFutureWhy'),
      severity: 'low',
    });
  } else if (age.kind === 'today' || age.kind === 'yesterday') {
    const today = age.kind === 'today';
    insights.push({
      fact: t(today ? 'temporalToday' : 'temporalYesterday'),
      inference: t('temporalFresh'),
      severity: 'high',
    });
  } else if (age.kind === 'years') {
    const ageYears = age.value;
    // Russian needs three plural forms; the other two dictionaries carry a plain template.
    const ageStr = lang === 'ru' ? pluralRu(ageYears, 'год', 'года', 'лет') : t('temporalYearsUnit', { years: ageYears });
    insights.push({
      fact: t('temporalYearsAgo', { age: ageStr }),
      inference: t('temporalOld'),
      severity: 'medium',
    });
  } else if (age.kind === 'months') {
    const ageMonths = age.value;
    insights.push({
      fact: t('temporalMonthsAgo', { months: ageMonths }),
      inference: '',
      severity: 'low',
    });
  }

  return insights;
}
