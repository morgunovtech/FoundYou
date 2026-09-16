import type { MessageKey } from '../../i18n';
import type { TimeProfile } from '../../utils/timeProfile';
import { wallClockAsUtcDate } from '../../utils/format';
import { AGE_KEYS, DAY_KIND_KEYS, TIME_OF_DAY_KEYS } from './storyKeys';

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Headline of the «Когда сделан снимок» card, one line: how long ago, the date, the weekday,
 * weekday / weekend / holiday, the time of day and the camera clock to the second, e.g.
 * «Сегодня или вчера, 16 сентября 2026 г., среда, будний день, вечер, 22:06:41». The wall-clock
 * digits are formatted as UTC so no zone shifts them.
 */
export function timeHeadline(tp: TimeProfile, locale: string, t: Translate): string {
  const date = wallClockAsUtcDate(tp.parts);
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date);
  const dayKind =
    tp.dayKind === 'holiday' ? t('dayHoliday', { names: tp.holidayNames.join(', ') }) : t(DAY_KIND_KEYS[tp.dayKind]);
  const line = [
    t(AGE_KEYS[tp.age.kind], { count: tp.age.value }),
    format({ day: 'numeric', month: 'long', year: 'numeric' }),
    format({ weekday: 'long' }),
    dayKind,
    t(TIME_OF_DAY_KEYS[tp.timeOfDay]),
    tp.wallClock.slice(11, 19)
  ].join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}
