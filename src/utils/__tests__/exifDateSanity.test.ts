import { describe, expect, it } from 'vitest';
import { findDateFault, findShotDateFault } from '../exifDateSanity';

describe('findDateFault', () => {
  it('passes a date that describes a real moment', () => {
    expect(findDateFault('2026:09:17 18:30:12')).toBeNull();
    expect(findDateFault('2024:02:29 00:00:00')).toBeNull(); // a leap day
    expect(findDateFault('2026-09-17T18:30:12')).toBeNull();
    expect(findDateFault('2026:06:30 23:59:60')).toBeNull(); // a leap second is legal
  });

  it('catches the value that used to be shown as «3 марта 2031, 02:02»', () => {
    // 30 February plus a 25th hour and a 61st minute: `new Date(2031, 1, 30, 25, 61, 61)` rolls
    // every overflow forward and hands back a date that is in no file.
    expect(findDateFault('2031:02:30 25:61:61')).toEqual({ reason: 'out-of-range', raw: '2031:02:30 25:61:61' });
  });

  it('catches each field on its own', () => {
    expect(findDateFault('2026:13:01 10:00:00')?.reason).toBe('out-of-range'); // month
    expect(findDateFault('2025:02:29 10:00:00')?.reason).toBe('out-of-range'); // 2025 is not a leap year
    expect(findDateFault('2026:04:31 10:00:00')?.reason).toBe('out-of-range'); // April has 30 days
    expect(findDateFault('2026:09:17 24:00:00')?.reason).toBe('out-of-range'); // hour
    expect(findDateFault('2026:09:17 10:60:00')?.reason).toBe('out-of-range'); // minute
    expect(findDateFault('2026:09:17 10:00:61')?.reason).toBe('out-of-range'); // second
    expect(findDateFault('1799:09:17 10:00:00')?.reason).toBe('out-of-range'); // before photography
    expect(findDateFault('3200:09:17 10:00:00')?.reason).toBe('out-of-range');
  });

  it('names the all-zero placeholder for what it is', () => {
    expect(findDateFault('0000:00:00 00:00:00')).toEqual({ reason: 'placeholder', raw: '0000:00:00 00:00:00' });
    // Nikon and Canon write the field blank rather than zeroed; same meaning, same verdict.
    expect(findDateFault('    :  :     :  :  ')?.reason).toBe('placeholder');
  });

  it('says nothing about a tag that holds no date', () => {
    expect(findDateFault(undefined)).toBeNull();
    expect(findDateFault('')).toBeNull();
    expect(findDateFault('   ')).toBeNull();
    expect(findDateFault(1758133812)).toBeNull();
    expect(findDateFault(new Date())).toBeNull();
    // Not date-shaped: exifr will not revive it either, so nothing can invent a moment from it.
    expect(findDateFault('yesterday afternoon')).toBeNull();
  });
});

describe('findShotDateFault', () => {
  it('judges the tag the capture time would come from', () => {
    expect(findShotDateFault({ DateTimeOriginal: '2031:02:30 25:61:61' })?.reason).toBe('out-of-range');
    expect(findShotDateFault({ CreateDate: '2026:13:01 10:00:00' })?.reason).toBe('out-of-range');
  });

  it('a sound DateTimeOriginal wins over a broken tag further down the list', () => {
    expect(
      findShotDateFault({ DateTimeOriginal: '2026:09:17 18:30:12', CreateDate: '2031:02:30 25:61:61' })
    ).toBeNull();
    // ModifyDate is a later save, not the capture time: a broken one is not this card's business.
    expect(findShotDateFault({ DateTimeOriginal: '2026:09:17 18:30:12', ModifyDate: '2026:13:45 99:99:99' })).toBeNull();
  });

  it('falls through empty tags to the first one that carries a value', () => {
    expect(findShotDateFault({ DateTimeOriginal: '', CreateDate: '2031:02:30 10:00:00' })?.reason).toBe('out-of-range');
  });

  it('no dates at all is not a fault', () => {
    expect(findShotDateFault(undefined)).toBeNull();
    expect(findShotDateFault({})).toBeNull();
    expect(findShotDateFault({ ModifyDate: '2026:09:17 18:30:12' })).toBeNull();
  });
});
